# implementation-notes — dashboard overhaul + manager layer

Build: mission-control dashboard (session polling, stall detection), Kanban with
split/handoff (aoagent.dev-inspired), manager admin layer. Append-only log of
deviations/decisions not obvious from the diff.

- Manager authority = hub token OR member role `manager`/`orchestrator`. The hub
  token doubles as the join token, so any teammate technically knows it; accepted
  for v0.1 (single-token model). Separate manager token if this ever matters.
- Handoff rides on existing infrastructure: `task.assign` sets `assignee` + sends a
  directed chat message; worker agents already poll `read_messages`, so no MCP
  client changes are needed for workers to receive handoffs.
- New statuses: `review` (manager drag) and `split` (hidden parent). `overlappingClaims`
  only counts `claimed`, so moving to review releases the file-scope lock by design.
- Dashboard polls `/state` every 5s as reconcile fallback on top of the WS stream —
  covers dropped WS messages without server changes.
- MCP `assign_task`/`split_task` do NOT pass the hub token as admin (every agent has
  it via env); they rely on the role check server-side, so only orchestrator/manager
  members can hand off work.
- Integration found a UA-stylesheet bug in the rewritten dashboard: author rules like
  `.pop { display:flex }` silently defeat the `hidden` attribute (author display beats
  UA `[hidden]{display:none}`), so the split modal, manager popover, and inactive tab
  panels all rendered at once. Fixed with `[hidden]{display:none !important}`.
- Card hover actions were replaced mid-build with a Wekan-style click-for-detail modal
  (per user direction): full scope, ownership, per-task activity, and all admin actions
  live there; cards stay compact. Added a WIP badge on In Progress (amber when claimed
  count exceeds online sessions).
- Restyled to aoagents.dev's app language (user direction): neutral monochrome dark
  (#0b0b0c base, no blue cast), white primary buttons w/ dark text (inverted in light
  mode via --btn-solid tokens), borderless columns with floating 10px cards, neutral
  owner chips, color reserved for status. Verified dark + light + 768px, zero console
  errors; drag/move/split/assign exercised live against a seeded hub on :7799.
- Task cards have no `createdAt` (protocol gap): card age falls back to claimedAt and
  is omitted for backlog cards. Add createdAt to task.add if backlog age matters.
