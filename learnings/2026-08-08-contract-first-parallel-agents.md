# Building one feature with three parallel agents via a locked protocol contract

## The problem

Ship a hub-wide feature (manager admin layer + Kanban handoff + dashboard rewrite)
across four surfaces (WS server, event store, MCP tools, dashboard HTML) fast, using
parallel agents, without them colliding or drifting apart.

## The approach

1. Read every file first and wrote the FULL protocol extension before spawning anyone:
   exact message types (`task.assign`, `task.status`, `task.split`, `task.delete`,
   `manager.auth`), exact reply shapes (`{type:"assign.result", taskId, ok, reason?}`),
   exact reason strings, child-id scheme (`<parentId>-<n>`), and event payloads
   (replay-safe: `task.split` carries the finished subtask objects so log replay
   rebuilds identical state).
2. Partitioned by file, not by feature: agent A owned `src/hub/* + src/lib/client.js +
   scripts/*`, agent B owned only `src/dashboard/index.html`, agent C owned
   `src/mcp/server.js + templates/AGENTS.md`. Zero shared files, so no merge conflicts.
3. Each prompt embedded the identical contract block plus "do NOT touch / do NOT run
   other agents' files" and "if a contract detail is impossible, say so — do not
   deviate silently".
4. Only agent A (who owned the tests) was allowed to run them; B and C built blind
   against the contract. Integration afterwards: `npm test` (24/24), seeded demo hub,
   Playwright walkthrough. The pieces composed with zero contract deviations.
5. Handoff needed no worker-side changes at all: `task.assign` sets `assignee` and
   sends a directed chat message, and worker agents already poll `read_messages` — the
   notification rides existing infrastructure.

## The judgment calls

- Did NOT give agents overlapping ownership "for context" — a read-only reference to a
  concurrently-edited file (client.js for the MCP agent) was stated as "assume these
  methods will exist", which was enough.
- Did NOT make MCP tools pass the hub token as `admin`: every agent holds the join
  token in env, so token-passthrough would make every worker an admin. Authority comes
  from the member's role (`manager`/`orchestrator`) checked server-side.
- Did NOT add a separate manager token for v0.1; the join token doubles as the
  dashboard manager key. Known ceiling, noted in implementation-notes.md.

## The reusable rule

Parallel agents compose cleanly only when the interface between them is written down
to the level of exact strings BEFORE spawning, ownership is partitioned by file, and
exactly one agent owns the runnable tests.
