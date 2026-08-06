// Smoke test used by `npm test` and CI. Boots the hub in-process, drives the
// coordination flow through the real hub client, and asserts the key behaviors.
import { startHub } from "../src/hub/server.js";
import { HubClient } from "../src/lib/client.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 7788;
const url = `http://localhost:${PORT}`;
let failures = 0;
function assert(cond, msg) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
}
const mk = (id, person, machine, agentKind, role) => new HubClient({ url, member: { id, person, machine, agentKind, role } });

const hub = startHub({ port: PORT, logPath: join(tmpdir(), `agentsync-smoke-${PORT}.ndjson`) });
try {
  const lead = mk("deepak.mac-a.claude", "deepak", "mac-a", "claude", "orchestrator");
  const be = mk("deepak.mac-a.codex", "deepak", "mac-a", "codex", "backend");
  const fe = mk("naman.laptop.claude", "naman", "laptop", "claude", "frontend");
  for (const c of [lead, be, fe]) { await c.connect(); await c.register(); }

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

  for (const c of [lead, be, fe]) c.close();
} catch (e) {
  console.log("  ✗ threw:", e.message);
  failures++;
} finally {
  hub.close();
}

console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll smoke assertions passed ✓");
process.exit(failures ? 1 : 0);
