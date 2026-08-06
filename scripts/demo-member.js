// Simulates agents on the hub so you can see the dashboard come alive without wiring
// real Claude/Codex sessions. Also serves as the end-to-end smoke test.
//   node scripts/demo-member.js [hubUrl]
import { HubClient } from "../src/lib/client.js";

const url = process.argv[2] || "http://localhost:7777";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const members = [
  { id: "deepak.mac-a.claude", person: "deepak", machine: "mac-a", agentKind: "claude", role: "orchestrator" },
  { id: "deepak.mac-a.codex", person: "deepak", machine: "mac-a", agentKind: "codex", role: "backend" },
  { id: "naman.laptop.claude", person: "naman", machine: "laptop", agentKind: "claude", role: "frontend" },
];

const clients = [];
for (const m of members) {
  const c = new HubClient({ url, member: m });
  await c.connect(); await c.register();
  clients.push(c);
  await wait(300);
}
const [lead, backend, frontend] = clients;

lead.setPlan(`Build the auth feature.
  - task auth-api    → src/auth/**        (backend)
  - task auth-ui     → src/ui/login/**    (frontend)
  - task shared-types→ src/types/**       (backend)  [touches hot files]`);
await wait(300);
lead.approvePlan();
lead.postMessage("Plan approved 🚀 — everyone claim your tasks.");
await wait(300);

lead.addTask({ id: "auth-api", title: "Auth API endpoints", scope: ["src/auth/**"], role: "backend" });
lead.addTask({ id: "auth-ui", title: "Login screen", scope: ["src/ui/login/**"], role: "frontend" });
lead.addTask({ id: "shared-types", title: "Shared auth types", scope: ["src/types/**", "src/auth/types.ts"], role: "backend" });
await wait(400);

console.log("backend claims auth-api:", (await backend.claimTask("auth-api")).overlaps?.length ? "OVERLAP" : "clean");
frontend.postMessage("Taking the login screen.");
console.log("frontend claims auth-ui:", (await frontend.claimTask("auth-ui")).overlaps?.length ? "OVERLAP" : "clean");
await wait(300);

// This one overlaps auth-api (src/auth/types.ts ⊂ src/auth/**) → should warn.
const r = await frontend.claimTask("shared-types");
console.log("frontend claims shared-types:", r.overlaps?.length ? "⚠ OVERLAP with " + r.overlaps.map((o) => o.owner) : "clean");
await wait(300);

// backend simulates a pre-push announce that overlaps frontend's claim
const a = await backend.announceEdit(["src/ui/login/api.ts", "src/auth/routes.ts"], "wire login to API");
console.log("backend announce overlaps:", a.overlaps?.map((o) => o.owner) || []);

if (process.env.AGENTSYNC_KEEP) {
  console.log("\n✓ demo seeded — members staying online (Ctrl-C to exit).");
} else {
  console.log("\n✓ demo seeded — exiting (set AGENTSYNC_KEEP=1 to stay online).");
  for (const c of clients) c.close();
  process.exit(0);
}
