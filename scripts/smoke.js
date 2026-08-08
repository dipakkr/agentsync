// Smoke test used by `npm test` and CI. Boots the hub in-process, drives the
// coordination flow through the real hub client, and asserts the key behaviors.
import { startHub } from "../src/hub/server.js";
import { HubClient } from "../src/lib/client.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const PORT = 7788;
const url = `http://localhost:${PORT}`;
let failures = 0;
function assert(cond, msg) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
}
const mk = (id, person, machine, agentKind, role) => new HubClient({ url, member: { id, person, machine, agentKind, role } });

const DATA = join(tmpdir(), `agentsync-smoke-${PORT}`);
rmSync(DATA, { recursive: true, force: true }); // hermetic: never inherit a previous run's state
const hub = startHub({ port: PORT, dataDir: DATA });
try {
  const lead = mk("deepak.mac-a.claude", "deepak", "mac-a", "claude", "orchestrator");
  const be = mk("deepak.mac-a.codex", "deepak", "mac-a", "codex", "backend");
  const fe = mk("naman.laptop.claude", "naman", "laptop", "claude", "frontend");
  for (const c of [lead, be, fe]) { await c.connect(); await c.register(); }

  await new Promise((r) => setTimeout(r, 100)); // let each member.register broadcast reach the others
  assert(lead.state.members.length === 3, "three members registered");

  lead.setPlan("auth feature"); lead.approvePlan();
  await new Promise((r) => setTimeout(r, 100));
  assert(lead.state.plan?.status === "approved", "plan can be approved");

  lead.addTask({ id: "auth-api", title: "Auth API", scope: ["src/auth/**"], role: "backend" });
  lead.addTask({ id: "auth-ui", title: "Login UI", scope: ["src/ui/login/**"], role: "frontend" });
  lead.addTask({ id: "shared", title: "Shared types", scope: ["src/auth/types.ts"], role: "backend" });
  await new Promise((r) => setTimeout(r, 150));

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

  // regression: a view-only socket (like the dashboard) never joins the roster, but once it
  // `watch`es a project it MUST receive that project's live broadcasts — else the dashboard
  // freezes until refresh.
  const viewer = new WebSocket(`ws://localhost:${PORT}/ws`);
  let viewerEvents = 0;
  await new Promise((r) => viewer.addEventListener("open", r));
  viewer.addEventListener("message", (e) => { if (JSON.parse(e.data).type === "event") viewerEvents++; });
  viewer.send(JSON.stringify({ type: "watch", project: "default" })); // subscribe without registering
  await new Promise((r) => setTimeout(r, 50));
  lead.postMessage("regression: view-only clients must get this");
  await new Promise((r) => setTimeout(r, 300));
  assert(viewerEvents > 0, "view-only socket receives live broadcasts after watch (no register)");
  viewer.close();

  // regression: a dropped socket must self-heal — reconnect, re-register, keep its buffered
  // chat, and RE-ASSERT its claims. Otherwise a hub blip/redeploy silently strips an agent's
  // file-scope locks (the sweeper auto-releases after 90s) while the agent keeps editing.
  const msgsBefore = be.state.messages.length; // be owns "auth-api" at this point
  be.ws.close(); // hard drop (NOT be.close(), which is an intentional shutdown)

  // while be is offline, release its task back to the board — exactly what the sweeper does
  const raw = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise((r) => raw.addEventListener("open", r));
  raw.send(JSON.stringify({ type: "register", member: { id: "ops.hub.tool", person: "ops", machine: "hub", agentKind: "tool" } }));
  await new Promise((r) => setTimeout(r, 60));
  raw.send(JSON.stringify({ type: "task.release", taskId: "auth-api" }));
  await new Promise((r) => setTimeout(r, 60));
  raw.close();

  await new Promise((r) => setTimeout(r, 1500)); // let be reconnect (backoff ~0.5s) + reclaim
  assert(be.ws.readyState === 1, "client reconnects after an unexpected socket drop");
  assert(be.state.messages.length >= msgsBefore, "buffered chat survives a reconnect (no message loss)");
  const reclaimed = be.state.tasks.find((t) => t.id === "auth-api");
  assert(reclaimed?.status === "claimed" && reclaimed.owner === "deepak.mac-a.codex",
    "client re-asserts its claim after a disconnect released it (locks don't silently vanish)");

  // regression: two projects on one hub are ISOLATED — same file globs, ids, and chat must
  // not leak across the boundary (this is what makes one deployed hub safe for many repos).
  const a = new HubClient({ url, project: "proj-a", member: { id: "x.m.claude", person: "x", machine: "m", agentKind: "claude", role: "coder" } });
  const b = new HubClient({ url, project: "proj-b", member: { id: "y.m.claude", person: "y", machine: "m", agentKind: "claude", role: "coder" } });
  await a.connect(); await a.register();
  await b.connect(); await b.register();
  a.addTask({ id: "t", title: "A-task", scope: ["src/**"] }); // same id + same glob in both projects
  b.addTask({ id: "t", title: "B-task", scope: ["src/**"] });
  await new Promise((r) => setTimeout(r, 150));
  const ca = await a.claimTask("t");
  const cb = await b.claimTask("t");
  assert(ca.ok && ca.overlaps.length === 0 && cb.ok && cb.overlaps.length === 0,
    "same glob claimed in two projects → no cross-project overlap");
  a.postMessage("secret from A");
  await new Promise((r) => setTimeout(r, 150));
  assert(!b.state.messages.some((mm) => mm.text === "secret from A"), "chat does not leak across projects");
  assert(a.state.members.length === 1 && b.state.members.length === 1, "roster is per-project");
  assert(a.state.tasks.find((t) => t.id === "t")?.title === "A-task", "same task id in another project does not collide");
  a.close(); b.close();

  for (const c of [lead, be, fe]) c.close();
} catch (e) {
  console.log("  ✗ threw:", e.message);
  failures++;
} finally {
  hub.close();
}

console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll smoke assertions passed ✓");
process.exit(failures ? 1 : 0);
