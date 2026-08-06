// The AgentSync reference hub: HTTP (dashboard + REST) + WebSocket coordination.
// Plain Node so it runs identically on a laptop, a VPS, or any container host.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import { Store } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = join(__dirname, "../dashboard/index.html");

const OFFLINE_AFTER = 30_000; // no heartbeat for 30s → shown offline
const RELEASE_AFTER = 90_000; // offline for 90s → auto-release their claims (locks never leak)

export function startHub({ port = 7777, token = "", logPath }) {
  const store = new Store(logPath);
  const clients = new Map(); // ws -> memberId

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, members: store.members.size }));
    }
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(store.snapshot()));
    }
    // dashboard (root)
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(existsSync(DASHBOARD) ? readFileSync(DASHBOARD) : "<h1>AgentSync hub</h1>");
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of clients.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }
  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
  // Fold an event into state + push it to everyone as a live update.
  function emit(type, payload, actor) {
    const ev = store.record(type, payload, actor);
    broadcast({ type: "event", event: ev });
    return ev;
  }

  wss.on("connection", (ws) => {
    send(ws, { type: "welcome", state: store.snapshot() });

    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: "error", message: "bad json" });
      }
      handle(ws, m);
    });

    ws.on("close", () => {
      const id = clients.get(ws);
      clients.delete(ws);
      // only flip offline if this member has no other live socket
      if (id && ![...clients.values()].includes(id)) {
        emit("member.presence", { memberId: id, online: false }, id);
      }
    });
  });

  function handle(ws, m) {
    switch (m.type) {
      case "register": {
        if (token && m.token !== token) return send(ws, { type: "error", message: "bad token" });
        clients.set(ws, m.member.id);
        emit("member.register", { member: m.member }, m.member.id);
        send(ws, { type: "registered", member: m.member, state: store.snapshot() });
        break;
      }
      case "heartbeat": {
        const id = clients.get(ws);
        if (id) {
          const mem = store.members.get(id);
          if (mem) {
            if (!mem.online) emit("member.presence", { memberId: id, online: true }, id);
            else mem.lastBeat = Date.now();
          }
        }
        break;
      }
      case "plan.set":
        emit("plan.set", { text: m.text }, clients.get(ws) || "human");
        broadcast({ type: "plan.update", plan: store.plan });
        break;
      case "plan.approve":
        emit("plan.approve", {}, clients.get(ws) || "human");
        broadcast({ type: "plan.update", plan: store.plan });
        break;
      case "task.add":
        emit("task.add", { task: m.task }, clients.get(ws) || "human");
        broadcast({ type: "task.list", tasks: [...store.tasks.values()] });
        break;
      case "task.claim": {
        const t = store.tasks.get(m.taskId);
        if (!t) return send(ws, { type: "error", message: "no such task" });
        if (t.status === "claimed" && t.owner !== m.memberId)
          return send(ws, { type: "claim.result", taskId: m.taskId, ok: false, reason: "already claimed by " + t.owner });
        const overlaps = store.overlappingClaims(t.scope || [], m.memberId);
        emit("task.claim", { taskId: m.taskId, memberId: m.memberId }, m.memberId);
        broadcast({ type: "task.list", tasks: [...store.tasks.values()] });
        send(ws, { type: "claim.result", taskId: m.taskId, ok: true, overlaps });
        if (overlaps.length)
          emit("chat", { text: `⚠️ overlap: task "${t.title}" shares files with ${overlaps.map((o) => o.owner).join(", ")}`, to: null }, "hub");
        break;
      }
      case "task.release":
        emit("task.release", { taskId: m.taskId }, clients.get(ws));
        broadcast({ type: "task.list", tasks: [...store.tasks.values()] });
        break;
      case "task.complete":
        emit("task.complete", { taskId: m.taskId }, clients.get(ws));
        broadcast({ type: "task.list", tasks: [...store.tasks.values()] });
        break;
      case "conflict.check": {
        const id = clients.get(ws);
        const hits = store.claimsTouchingFiles(m.files || [], id);
        send(ws, { type: "conflict.result", overlaps: hits });
        break;
      }
      case "edit.announce": {
        const id = clients.get(ws) || "unknown";
        const hits = store.claimsTouchingFiles(m.files || [], id);
        emit("edit.announce", { files: m.files, summary: m.summary, overlaps: hits }, id);
        emit("chat", { text: `📤 ${id} about to push: ${m.summary || (m.files || []).length + " files"}`, to: null }, "hub");
        if (hits.length)
          emit("chat", { text: `⚠️ push overlaps active work by ${hits.map((h) => h.owner).join(", ")}`, to: null }, "hub");
        send(ws, { type: "announce.result", overlaps: hits });
        break;
      }
      case "chat":
        emit("chat", { text: m.text, to: m.to || null }, clients.get(ws) || m.from || "anon");
        break;
      default:
        send(ws, { type: "error", message: "unknown type: " + m.type });
    }
  }

  // presence sweeper: flip stale members offline, release long-abandoned claims
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const mem of store.members.values()) {
      if (mem.online && now - mem.lastBeat > OFFLINE_AFTER) {
        emit("member.presence", { memberId: mem.id, online: false }, "hub");
      }
      if (!mem.online && now - mem.lastBeat > RELEASE_AFTER) {
        for (const t of store.tasks.values()) {
          if (t.status === "claimed" && t.owner === mem.id) {
            emit("task.release", { taskId: t.id }, "hub");
            emit("chat", { text: `🔓 released "${t.title}" — ${mem.id} went offline`, to: null }, "hub");
          }
        }
      }
    }
    broadcast({ type: "presence", members: [...store.members.values()] });
  }, 10_000);

  http.listen(port, () => {});
  return {
    port,
    close: () => {
      clearInterval(sweep);
      wss.close();
      http.close();
    },
  };
}
