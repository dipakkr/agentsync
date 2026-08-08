// Smoke test used by `npm test` and CI. Boots the hub in-process, drives the
// coordination flow through the real hub client, and asserts the key behaviors.
import { startHub } from "../src/hub/server.js";
import { Store } from "../src/hub/store.js";
import { HubClient } from "../src/lib/client.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 7788;
const PORT2 = 7789;
const TOKEN = "smoke-manager-token";
const url = `http://localhost:${PORT}`;
const url2 = `http://localhost:${PORT2}`;
const log2 = join(tmpdir(), `agentsync-smoke-${PORT2}-${Date.now()}.ndjson`);
let failures = 0;
function assert(cond, msg) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (id, person, machine, agentKind, role) => new HubClient({ url, member: { id, person, machine, agentKind, role } });

const hub = startHub({ port: PORT, logPath: join(tmpdir(), `agentsync-smoke-${PORT}-${Date.now()}.ndjson`) });
try {
  const lead = mk("deepak.mac-a.claude", "deepak", "mac-a", "claude", "orchestrator");
  const be = mk("deepak.mac-a.codex", "deepak", "mac-a", "codex", "backend");
  const fe = mk("naman.laptop.claude", "naman", "laptop", "claude", "frontend");
  for (const c of [lead, be, fe]) { await c.connect(); await c.register(); }
  await wait(150); // let register broadcasts land on every client

  assert(lead.state.members.length === 3, "three members registered");

  lead.setPlan("auth feature"); lead.approvePlan();
  await wait(100);
  assert(lead.state.plan?.status === "approved", "plan can be approved");

  lead.addTask({ id: "auth-api", title: "Auth API", scope: ["src/auth/**"], role: "backend" });
  lead.addTask({ id: "auth-ui", title: "Login UI", scope: ["src/ui/login/**"], role: "frontend" });
  lead.addTask({ id: "shared", title: "Shared types", scope: ["src/auth/types.ts"], role: "backend" });
  await wait(150);

  const c1 = await be.claimTask("auth-api");
  assert(c1.ok && c1.overlaps.length === 0, "clean claim has no overlap");

  const c2 = await fe.claimTask("auth-ui");
  assert(c2.ok && c2.overlaps.length === 0, "non-overlapping claim is clean");

  const c3 = await fe.claimTask("shared"); // src/auth/types.ts ⊂ src/auth/** (be owns it)
  assert(c3.ok && c3.overlaps.length === 1 && c3.overlaps[0].owner === "deepak.mac-a.codex",
    "overlapping claim warns about the file-scope owner");

  const dup = await lead.claimTask("auth-api"); // already claimed by be
  assert(!dup.ok, "claiming an already-claimed task is refused");

  const ann = await be.announceEdit(["src/ui/login/api.ts"], "wire login"); // ⊂ fe's auth-ui
  assert(ann.overlaps.length === 1 && ann.overlaps[0].owner === "naman.laptop.claude",
    "pre-push announce detects overlap with another active claim");

  const safe = await be.checkConflicts(["src/auth/routes.ts"]); // only be owns src/auth/**
  assert(safe.overlaps.length === 0, "check_conflicts is clean when no one else owns the files");

  // regression: a view-only socket (like the dashboard) never registers, but MUST still
  // receive live broadcasts — otherwise the dashboard freezes until refresh.
  const viewer = new WebSocket(`ws://localhost:${PORT}/ws`);
  let viewerEvents = 0;
  await new Promise((r) => viewer.addEventListener("open", r));
  viewer.addEventListener("message", (e) => { if (JSON.parse(e.data).type === "event") viewerEvents++; });
  lead.postMessage("regression: view-only clients must get this");
  await wait(300);
  assert(viewerEvents > 0, "view-only socket (dashboard) receives live broadcasts without registering");
  viewer.close();

  for (const c of [lead, be, fe]) c.close();
} catch (e) {
  console.log("  ✗ threw:", e.message);
  failures++;
} finally {
  hub.close();
}

// ---- manager ops on a token-gated hub ---------------------------------------
const hub2 = startHub({ port: PORT2, token: TOKEN, logPath: log2 });
try {
  const mk2 = (id, person, machine, agentKind, role) =>
    new HubClient({ url: url2, token: TOKEN, member: { id, person, machine, agentKind, role } });
  const lead = mk2("deepak.mac-a.claude", "deepak", "mac-a", "claude", "orchestrator");
  const be = mk2("deepak.mac-a.codex", "deepak", "mac-a", "codex", "backend");
  const fe = mk2("naman.laptop.claude", "naman", "laptop", "claude", "frontend");
  for (const c of [lead, be, fe]) { await c.connect(); await c.register(); }

  lead.addTask({ id: "t1", title: "Auth API", scope: ["src/auth/**"], role: "backend" });
  lead.addTask({ id: "t2", title: "Shared types", scope: ["src/types/**"], role: "backend" });
  lead.addTask({ id: "t3", title: "Login UI", scope: ["src/ui/**"], role: "frontend" });
  await wait(150);

  const noAuth = await be.assignTask("t1", fe.member.id);
  assert(!noAuth.ok && noAuth.reason === "manager token or orchestrator role required",
    "plain member without admin token cannot assign");

  const asg = await lead.assignTask("t1", fe.member.id);
  await wait(200);
  const t1 = lead.state.tasks.find((t) => t.id === "t1");
  assert(asg.ok && t1?.assignee === fe.member.id, "orchestrator can assign without admin token");
  assert(fe.readMessages().messages.some((m) => m.to === fe.member.id && m.text.includes("📋") && m.text.includes("t1")),
    "assignee receives the directed 📋 chat message");

  const byToken = await be.assignTask("t3", fe.member.id, TOKEN);
  assert(byToken.ok, "plain member with the admin token can assign");

  const ghost = await lead.assignTask("nope", fe.member.id);
  assert(!ghost.ok && ghost.reason === "no such task", "assigning an unknown task is refused");

  const sp = await lead.splitTask("t2", [
    { title: "Auth types: session", scope: ["src/types/session.ts"] },
    { title: "Auth types: tokens", scope: ["src/types/tokens.ts"] },
  ]);
  await wait(200);
  const kids = lead.state.tasks.filter((t) => t.parent === "t2");
  assert(sp.ok && sp.ids.length === 2 && kids.length === 2 && kids.every((t) => t.status === "open"),
    "split creates open children carrying the parent field");
  assert(lead.state.tasks.find((t) => t.id === "t2")?.status === "split", "split parent moves to status split");

  const replayed = new Store(log2); // fresh replay of the same log must rebuild identically
  assert(replayed.tasks.get("t2")?.status === "split" &&
    sp.ids.every((id) => replayed.tasks.get(id)?.parent === "t2"),
    "split children + parent status survive log replay");

  const noWho = await lead.setTaskStatus(sp.ids[0], "claimed"); // child has no assignee
  assert(!noWho.ok && noWho.reason === "assign a session first", "status→claimed without a session is refused");

  const st = await lead.setTaskStatus("t1", "claimed"); // t1.assignee = fe
  await wait(150);
  const t1c = lead.state.tasks.find((t) => t.id === "t1");
  assert(st.ok && t1c?.status === "claimed" && t1c?.owner === fe.member.id,
    "status→claimed adopts the assignee as owner");

  const rv = await lead.setTaskStatus("t1", "review");
  await wait(150);
  const t1r = lead.state.tasks.find((t) => t.id === "t1");
  assert(rv.ok && t1r?.status === "review" && t1r?.owner === fe.member.id, "status→review keeps the owner");

  const bad = await lead.setTaskStatus("t1", "split");
  assert(!bad.ok && bad.reason === "bad status", "unknown status is refused");

  const del = await lead.deleteTask("t3");
  await wait(150);
  assert(del.ok && !lead.state.tasks.find((t) => t.id === "t3"), "delete removes the task");

  // manager.auth over a raw socket (how the dashboard unlocks)
  const raw = new WebSocket(`ws://localhost:${PORT2}/ws`);
  const msgs = [];
  raw.addEventListener("message", (e) => msgs.push(JSON.parse(e.data)));
  await new Promise((r) => raw.addEventListener("open", r));
  raw.send(JSON.stringify({ type: "manager.auth", token: "wrong" }));
  await wait(200);
  assert(msgs.find((m) => m.type === "welcome")?.needsToken === true, "welcome advertises needsToken on a token-gated hub");
  assert(msgs.find((m) => m.type === "manager.result")?.ok === false, "manager.auth with the wrong token is refused");
  raw.close();

  for (const c of [lead, be, fe]) c.close();
} catch (e) {
  console.log("  ✗ threw:", e.message);
  failures++;
} finally {
  hub2.close();
}

console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll smoke assertions passed ✓");
process.exit(failures ? 1 : 0);
