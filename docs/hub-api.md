# Hub API — HTTP & WebSocket

The hub (`src/hub/server.js`) is a single Node process serving three things: the
dashboard, a tiny read-only HTTP API, and the WebSocket coordination protocol that the
CLI, the MCP server, and the dashboard all speak. Everything is event-sourced: each
action is appended to an NDJSON log and folded into in-memory state, which is rebuilt by
replaying the log on boot.

## HTTP endpoints

| Endpoint | Returns |
|---|---|
| `GET /` | The dashboard (single-file HTML) |
| `GET /health` | `{ "ok": true, "members": <count> }` — use as a container/uptime health check |
| `GET /state` | The full state snapshot (below). Handy for scripts and polling — this is what `agentsync status` prints |

### The `/state` snapshot

```jsonc
{
  "members":  [ { "id": "deepak.mac-a.claude", "person": "deepak", "machine": "mac-a",
                  "agentKind": "claude", "role": "coder", "online": true,
                  "lastBeat": 1754500000000, "joinedAt": 1754490000000 } ],
  "tasks":    [ { "id": "auth-api", "title": "Auth API", "scope": ["src/auth/**"],
                  "role": "backend", "dependsOn": [], "status": "claimed",
                  "owner": "deepak.mac-a.claude", "claimedAt": 1754500000000 } ],
  "plan":     { "text": "…", "status": "approved", "updatedAt": 1754500000000 },
  "messages": [ { "id": 42, "from": "deepak.mac-a.claude", "to": null,
                  "text": "starting auth-api", "ts": 1754500000000 } ],
  "events":   [ /* last 100 raw events — the activity timeline */ ]
}
```

The hub keeps the last **500** messages and the last **100** events in the snapshot;
the NDJSON log on disk keeps everything.

## WebSocket protocol — `ws(s)://<hub>/ws`

Connect, then send JSON messages. The first server message is always
`{ type: "welcome", state: <snapshot> }`.

### Client → server

All messages act within one **project** (a room on the hub). Establish it first with
`register` (agents) or `watch` (view-only clients); every other message operates on the
project that socket declared. Broadcasts reach only sockets in the same project.

| Message | Payload | Reply / broadcast |
|---|---|---|
| `register` | `{ member, token, project? }` | `registered` (with that project's state) to you; `event: member.register` to the project. `error: "bad token"` on mismatch, `error: "bad project name"` if `project` isn't `[A-Za-z0-9._-]{1,64}`. Defaults to `default` |
| `watch` | `{ project? }` | `welcome` (with that project's state) to you — subscribe a view-only socket (dashboard) without joining the roster |
| `heartbeat` | `{}` | none — send every ~10 s to stay online |
| `plan.set` | `{ text }` | `plan.update` to all |
| `plan.approve` | `{}` | `plan.update` to all |
| `task.add` | `{ task }` | `task.list` to all |
| `task.claim` | `{ taskId, memberId }` | `claim.result` `{ ok, overlaps \| reason }` to you; `task.list` to all; a hub chat warning to all if scopes overlap |
| `task.release` | `{ taskId }` | `task.list` to all |
| `task.complete` | `{ taskId }` | `task.list` to all |
| `conflict.check` | `{ files }` | `conflict.result` `{ overlaps }` to you |
| `edit.announce` | `{ files, summary }` | `announce.result` `{ overlaps }` to you; "📤 about to push" chat to all (+ overlap warning if any) |
| `chat` | `{ text, to? }` | `event: chat` to all |

### Server → client

| Message | When |
|---|---|
| `welcome { state? }` | On connect (no state — project unknown yet); and after `watch` (carries that project's state) |
| `registered { member, project, state }` | After your `register` |
| `event { event }` | Every recorded event, live (see event types below) |
| `task.list { tasks }` | After any task mutation |
| `plan.update { plan }` | After plan set/approve |
| `presence { members }` | Every 10 s from the presence sweeper |
| `claim.result` / `conflict.result` / `announce.result` | Replies to your requests |
| `error { message }` | Bad JSON, bad token, unknown type, no such task |

### Presence lifecycle

- Register → online.
- No heartbeat for **30 s** → shown offline (the sweeper runs every 10 s).
- Offline for **90 s** → the hub auto-releases every task you had claimed and says so
  in chat, so locks never leak.
- Socket close flips you offline immediately — unless you hold another live socket
  (e.g. CLI + MCP server at once).

## The event log

Every event is one NDJSON line, `{ seq, ts, type, actor, …payload }`, appended to a
per-project log in the data dir — `events.ndjson` for the `default` project,
`project-<name>.ndjson` for others (set `AGENTSYNC_DATA` to relocate the dir). Each
project's log is its own source of truth: replayable, auditable, and it *is* that
project's dashboard timeline.

Event types: `member.register` · `member.presence` · `plan.set` · `plan.approve` ·
`task.add` · `task.claim` · `task.release` · `task.complete` · `edit.announce` · `chat`.

Reading the feed from a script:

```bash
curl -s https://hub.example.com/state | jq '.events[-10:]'   # last 10 events
curl -s https://hub.example.com/state | jq '.messages[-5:]'  # last 5 chat messages
```
