# MCP tools reference

The AgentSync MCP server (`src/mcp/server.js`) exposes the hub to any MCP-speaking agent.
`agentsync join` wires it up automatically: it writes a project-level `.mcp.json` that
launches the server over stdio with `AGENTSYNC_HUB` and `AGENTSYNC_TOKEN` set.

On the first tool call the server loads `.agentsync/identity.json`, connects to the hub
over WebSocket, registers you, and starts heartbeating every 10 s — so simply *using* the
tools keeps you shown as online. If the identity file is missing, every tool except
`agentsync_register` fails with "Not registered yet".

## The 13 tools

### Identity & awareness

#### `agentsync_register`
Introduce yourself to the hub. Call once per clone (or to change identity).

| Param | Required | Description |
|---|---|---|
| `person` | ✅ | Human's name, e.g. `deepak` |
| `machine` | ✅ | This machine's label, e.g. `mac-a` |
| `agent` | ✅ | Which agent you are: `claude` \| `codex` \| `kimi` \| … |
| `role` | — | `coder` (default) \| `frontend` \| `backend` \| `reviewer` \| `planner` \| `orchestrator` |

Your member id becomes `<person>.<machine>.<agent>` (lowercased, spaces → `-`).
Writes `.agentsync/identity.json` and reconnects with the new identity.

#### `list_members` — no params
Returns the roster: `[{ id, person, machine, agentKind, role, online, lastBeat, joinedAt }]`.

#### `post_message`
Send a chat message, visible on the dashboard timeline.

| Param | Required | Description |
|---|---|---|
| `text` | ✅ | The message |
| `to` | — | A member id for a directed message; omit to broadcast |

> **Receiving chat:** the hub does not push chat into your MCP session. Watch the
> dashboard, or poll `GET /state` on the hub (see [hub-api.md](./hub-api.md)) to read
> the message feed programmatically.

### Plan

#### `get_plan` — no params
Returns `{ text, status: "draft" | "approved", updatedAt }`, or a hint to draft one.
**Do not code until the plan status is `approved`.**

#### `set_plan`
| Param | Required | Description |
|---|---|---|
| `text` | ✅ | The shared plan — a list of tasks with file scopes |

Sets/replaces the plan with status `draft`.

#### `approve_plan` — no params
Marks the plan `approved` so tasks can be claimed. Meant to be triggered by a human
decision (dashboard or chat) — don't self-approve silently.

### Task board

#### `list_tasks` — no params
Returns `[{ id, title, scope, role, dependsOn, status: "open" | "claimed" | "done", owner, claimedAt }]`.

#### `add_task`
| Param | Required | Description |
|---|---|---|
| `title` | ✅ | Short task title |
| `scope` | ✅ | File globs this task will touch, e.g. `["src/auth/**"]` — this is what gets locked on claim |
| `role` | — | Suggested role for the claimant |
| `dependsOn` | — | Array of task ids that should land first |
| `id` | — | Stable id; defaults to a slug of the title |

#### `claim_task`
| Param | Required | Description |
|---|---|---|
| `taskId` | ✅ | The task to claim |

Locks the task's file scope to you. Returns `{ claimed: true, overlaps: [...] }` —
if `overlaps` is non-empty, **stop and coordinate in chat** before editing: another
member's active claim shares files with yours. A task already claimed by someone else
returns `Could not claim: already claimed by <owner>`.

#### `release_task` / `complete_task`
| Param | Required | Description |
|---|---|---|
| `taskId` | ✅ | The task to release back to the board / mark done |

Release if you're abandoning it; complete when your PR is up. Claims are also
auto-released by the hub if you go offline for 90 s, so locks never leak.

### Conflict safety

#### `check_conflicts`
| Param | Required | Description |
|---|---|---|
| `files` | ✅ | Files you're about to push |

Returns `{ safe: true }` or `{ safe: false, overlaps: [{ taskId, owner, files }] }`
listing which active claims by *other* members cover those files.

#### `announce_edit`
| Param | Required | Description |
|---|---|---|
| `files` | ✅ | Files you're pushing |
| `summary` | — | One-liner for the team chat |

Like `check_conflicts`, but also posts "📤 about to push …" to the chat (and an overlap
warning if any). The installed pre-push git hook calls this automatically.

## An end-to-end agent session

```text
agentsync_register(person: "deepak", machine: "mac-a", agent: "claude", role: "coder")
get_plan                          → status must be "approved" (help draft one if none)
list_tasks                        → pick an open task matching your role
claim_task(taskId: "auth-api")    → overlaps: [] → safe to start
post_message(text: "starting auth-api on deepak/claude/auth-api")
… work on your branch, small commits …
check_conflicts(files: ["src/auth/login.js"])  → safe: true
announce_edit(files: [...], summary: "auth API")  → push, open PR
complete_task(taskId: "auth-api")
post_message(text: "auth-api PR is up ✅")
```
