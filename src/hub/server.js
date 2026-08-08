// The AgentSync reference hub: HTTP (dashboard + REST) + WebSocket coordination.
// Plain Node so it runs identically on a laptop, a VPS, or any container host.
//
// One hub serves MANY projects. Each project is an isolated Store (its own roster,
// tasks, plan, chat) with its own event log, keyed by a `project` string a client
// declares at register/watch. This is ORGANIZATIONAL separation, not a security
// boundary — the shared token still gates the hub, so anyone with it can name any
// project. Use per-hub tokens per team if you need a hard wall between projects.

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
const DEFAULT_PROJECT = "default";

// Project names become filenames — allowlist strictly (no path traversal, no separators).
// Reject rather than substitute so "my.app" and "my-app" can't silently collide into one store.
const PROJECT_RE = /^[A-Za-z0-9._-]{1,64}$/;
function safeProject(p) {
  const name = (p || DEFAULT_PROJECT).trim();
  if (name === "." || name === ".." || !PROJECT_RE.test(name)) return null;
  return name;
}

export function startHub({ port = 7777, token = "", dataDir, logPath }) {
  // Accept an explicit dataDir; fall back to a legacy single logPath's directory, then CWD.
  const dir = dataDir || (logPath ? dirname(logPath) : join(process.cwd(), ".agentsync"));
  // Keep the `default` project on the legacy `events.ndjson` name so a hub that already
  // persisted to a volume picks its history back up; other projects get their own file.
  const logFileFor = (project) =>
    join(dir, project === DEFAULT_PROJECT ? "events.ndjson" : `project-${project}.ndjson`);

  const stores = new Map(); // project -> Store
  function storeFor(project) {
    if (!stores.has(project)) stores.set(project, new Store(logFileFor(project)));
    return stores.get(project);
  }
  storeFor(DEFAULT_PROJECT); // always exists — /health and legacy clients rely on it

  const clients = new Map(); // ws -> { id?: memberId, project }

  const http = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") {
      const members = [...stores.values()].reduce((n, s) => n + s.members.size, 0);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, projects: stores.size, members }));
    }
    if (url.pathname === "/state") {
      const project = safeProject(url.searchParams.get("project")) || DEFAULT_PROJECT;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(storeFor(project).snapshot()));
    }
    // dashboard (root)
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(existsSync(DASHBOARD) ? readFileSync(DASHBOARD) : "<h1>AgentSync hub</h1>");
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });

  // Broadcast only to sockets watching the SAME project — including view-only clients
  // (the dashboard) that never `register` but must still get live updates for their project.
  function broadcast(project, msg) {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN && clients.get(ws)?.project === project) ws.send(data);
    }
  }
  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
  // Fold an event into a project's state + push it to everyone on that project.
  function emit(project, type, payload, actor) {
    const ev = storeFor(project).record(type, payload, actor);
    broadcast(project, { type: "event", event: ev });
    return ev;
  }

  wss.on("connection", (ws) => {
    // We don't know the project yet — the snapshot arrives with `registered`/`watch`.
    send(ws, { type: "welcome" });

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
      const cx = clients.get(ws);
      clients.delete(ws);
      // only flip offline if this member has no other live socket on the same project
      if (cx?.id && ![...clients.values()].some((c) => c.id === cx.id && c.project === cx.project)) {
        emit(cx.project, "member.presence", { memberId: cx.id, online: false }, cx.id);
      }
    });
  });

  function handle(ws, m) {
    // register/watch establish the socket's project; everything else needs it set first.
    if (m.type === "register") {
      if (token && m.token !== token) return send(ws, { type: "error", message: "bad token" });
      const project = safeProject(m.project);
      if (!project) return send(ws, { type: "error", message: "bad project name" });
      clients.set(ws, { id: m.member.id, project });
      emit(project, "member.register", { member: m.member }, m.member.id);
      send(ws, { type: "registered", member: m.member, project, state: storeFor(project).snapshot() });
      return;
    }
    if (m.type === "watch") {
      // view-only clients (dashboard) subscribe to a project without joining the roster
      const project = safeProject(m.project);
      if (!project) return send(ws, { type: "error", message: "bad project name" });
      clients.set(ws, { project });
      send(ws, { type: "welcome", project, state: storeFor(project).snapshot() });
      return;
    }

    const cx = clients.get(ws);
    if (!cx) return send(ws, { type: "error", message: "register or watch first" });
    const project = cx.project;
    const store = storeFor(project);
    const actor = cx.id || "anon";

    switch (m.type) {
      case "heartbeat": {
        if (cx.id) {
          const mem = store.members.get(cx.id);
          if (mem) {
            if (!mem.online) emit(project, "member.presence", { memberId: cx.id, online: true }, cx.id);
            else mem.lastBeat = Date.now();
          }
        }
        break;
      }
      case "plan.set":
        emit(project, "plan.set", { text: m.text }, actor);
        broadcast(project, { type: "plan.update", plan: store.plan });
        break;
      case "plan.approve":
        emit(project, "plan.approve", {}, actor);
        broadcast(project, { type: "plan.update", plan: store.plan });
        break;
      case "task.add":
        emit(project, "task.add", { task: m.task }, actor);
        broadcast(project, { type: "task.list", tasks: [...store.tasks.values()] });
        break;
      case "task.claim": {
        const t = store.tasks.get(m.taskId);
        if (!t) return send(ws, { type: "error", message: "no such task" });
        if (t.status === "claimed" && t.owner !== m.memberId)
          return send(ws, { type: "claim.result", taskId: m.taskId, ok: false, reason: "already claimed by " + t.owner });
        const overlaps = store.overlappingClaims(t.scope || [], m.memberId);
        emit(project, "task.claim", { taskId: m.taskId, memberId: m.memberId }, m.memberId);
        broadcast(project, { type: "task.list", tasks: [...store.tasks.values()] });
        send(ws, { type: "claim.result", taskId: m.taskId, ok: true, overlaps });
        if (overlaps.length)
          emit(project, "chat", { text: `⚠️ overlap: task "${t.title}" shares files with ${overlaps.map((o) => o.owner).join(", ")}`, to: null, kind: "system", subtype: "overlap" }, "hub");
        break;
      }
      case "task.release":
        emit(project, "task.release", { taskId: m.taskId }, actor);
        broadcast(project, { type: "task.list", tasks: [...store.tasks.values()] });
        break;
      case "task.complete":
        emit(project, "task.complete", { taskId: m.taskId }, actor);
        broadcast(project, { type: "task.list", tasks: [...store.tasks.values()] });
        break;
      case "conflict.check": {
        const hits = store.claimsTouchingFiles(m.files || [], cx.id);
        send(ws, { type: "conflict.result", overlaps: hits });
        break;
      }
      case "edit.announce": {
        const id = cx.id || "unknown";
        const hits = store.claimsTouchingFiles(m.files || [], id);
        emit(project, "edit.announce", { files: m.files, summary: m.summary, overlaps: hits }, id);
        emit(project, "chat", { text: `📤 ${id} about to push: ${m.summary || (m.files || []).length + " files"}`, to: null, kind: "system", subtype: "push" }, "hub");
        if (hits.length)
          emit(project, "chat", { text: `⚠️ push overlaps active work by ${hits.map((h) => h.owner).join(", ")}`, to: null, kind: "system", subtype: "overlap" }, "hub");
        send(ws, { type: "announce.result", overlaps: hits });
        break;
      }
      case "chat": {
        const kind = ["fyi", "ask", "reply"].includes(m.kind) ? m.kind : "fyi";
        // a reply inherits the thread of the message it answers, so ask→reply group together
        let thread = null;
        if (kind === "reply" && m.reply_to != null) {
          const src = store.messages.find((x) => x.id === m.reply_to);
          thread = src ? src.thread || src.id : m.reply_to;
        }
        emit(project, "chat", { text: m.text, to: m.to || null, kind, reply_to: m.reply_to ?? null, thread }, cx.id || m.from || "anon");
        break;
      }
      default:
        send(ws, { type: "error", message: "unknown type: " + m.type });
    }
  }

  // presence sweeper: flip stale members offline, release long-abandoned claims — per project
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [project, store] of stores) {
      for (const mem of store.members.values()) {
        if (mem.online && now - mem.lastBeat > OFFLINE_AFTER) {
          emit(project, "member.presence", { memberId: mem.id, online: false }, "hub");
        }
        if (!mem.online && now - mem.lastBeat > RELEASE_AFTER) {
          for (const t of store.tasks.values()) {
            if (t.status === "claimed" && t.owner === mem.id) {
              emit(project, "task.release", { taskId: t.id }, "hub");
              emit(project, "chat", { text: `🔓 released "${t.title}" — ${mem.id} went offline`, to: null, kind: "system", subtype: "release" }, "hub");
            }
          }
        }
      }
      broadcast(project, { type: "presence", members: [...store.members.values()] });
    }
  }, 10_000);

  http.listen(port, () => {});
  return {
    port,
    dataDir: dir,
    close: () => {
      clearInterval(sweep);
      wss.close();
      http.close();
    },
  };
}
