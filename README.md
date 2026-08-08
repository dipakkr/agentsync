# ⚡ AgentSync

[![CI](https://github.com/dipakkr/agentsync/actions/workflows/ci.yml/badge.svg)](https://github.com/dipakkr/agentsync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**A multi-agent collaboration hub for AI coding teams.** Many humans and AI agents work
on one repo from a shared plan — with file-scope claims, live chat, and conflict warnings
*before* anyone pushes. So fast agents never collide.

Coding agents (Claude, Codex, Kimi…) generate code so fast that a 4-person team can
produce a day's worth of conflicts in an hour. AgentSync is the starter kit you drop in
*before* the work starts: everyone — every human and every agent — joins one shared hub
that shows who's online, what the plan is, who has claimed which files, and warns the
moment two people are about to touch the same code.

> git owns the code. **AgentSync owns the awareness.** It never blocks git — it makes
> collisions visible while they're still cheap to avoid.

---

## Why this exists

Existing "parallel agent" tools (Vibe Kanban, Conductor, ccswarm, opencode-ensemble) are
excellent but **single-user, single-machine** — one dev orchestrating many agents on one
box. AgentSync is built for the case none of them cover: **many people, many machines,
many heterogeneous agents**, coordinating in real time.

## What you get

- **One hub, everyone dials in.** Star topology, not a mesh. No manual peering.
- **Identity & roster.** Each participant is `person.machine.agent` (`deepak.mac-a.claude`,
  `naman.laptop.codex`). Live presence on a dashboard.
- **Plan-first gate.** No task can be claimed until a plan is approved.
- **Task board with file-scope locks.** Claiming a task locks its file globs; overlapping
  claims are warned instantly.
- **Pre-push announce.** A git hook posts your diff to the team chat and warns if it
  overlaps someone's active work — so you *know what you're pushing first*.
- **Shared chat over WebSocket**, with a live dashboard timeline.
- **Agent-native via MCP.** Claude/Codex call `claim_task`, `check_conflicts`,
  `post_message` themselves — they participate in the chat autonomously.
- **Event-sourced.** Every action is an append-only NDJSON log → durable, replayable,
  and it *is* the activity feed.

Only hard dependencies: **Node ≥ 22 and git** (which every participant already has).

---

## Quickstart

### ⭐ The one-command start

Inside the repo you're building, one command takes you from zero to live — it inits the
repo, starts a hub, sets you up, opens the dashboard, and prints the invite line:

```bash
npx github:dipakkr/agentsync up
#   ⚡ Hub started on http://192.168.1.14:7777 (token …)
#   ✓ You're live as deepak.mac.claude
#   opened dashboard → http://localhost:7777
#   Invite teammates: npx github:dipakkr/agentsync join http://192.168.1.14:7777 --token … --name YOU --machine THIS --agent claude
```

Teammates paste that invite line and they're in. `agentsync invite` reprints it anytime.
Point `up` at a deployed hub with `--hub <url>` to skip the local one. The steps below are
the same thing, broken out.

### 0. Add AgentSync to your project (once, by whoever owns the repo)

Run this **inside the repo you're building** — it makes the repo AgentSync-aware so any
agent that opens it knows how to use the tool:

```bash
npx agentsync init --hub http://192.168.1.20:7777
#   ✓ AgentSync initialized
#   created: agentsync.config.yaml, AGENTS.md, CLAUDE.md, .gitignore (+.agentsync/)
```

`init` drops in the config plus an **`AGENTS.md` guide** (the "how to use AgentSync"
context your Claude/Codex agents read automatically). Commit these files and the whole
team shares one setup. It's idempotent and won't clobber an existing `AGENTS.md` — it
appends its section.

### 1. One person starts the hub

```bash
npx agentsync hub
#   ⚡ AgentSync hub is live
#   Dashboard   http://localhost:7777  ·  http://192.168.1.20:7777
#   Hub URL     http://192.168.1.20:7777
#   Teammates join with:  npx agentsync join http://192.168.1.20:7777
```

Open the Dashboard URL. For a distributed team, deploy the same command on any host
(VPS/container) and put its URL in `agentsync.config.yaml` → `hub_url` — see
**[docs/deployment.md](./docs/deployment.md)** for Railway, VPS, and Docker recipes.

### 2. Everyone else joins from their clone

```bash
npx agentsync join http://192.168.1.20:7777
#   Who are you?
#   Your name          > deepak
#   This machine label > mac-a
#   Agent (human/claude/codex/kimi) [human] > claude
#   Role (orchestrator/coder/frontend/backend/reviewer/planner) [coder] > backend
#   ✓ Joined as deepak.mac-a.claude (backend)
```

Scripting it (CI, agent bootstrap, or you just hate prompts)? Pass the answers as flags
and `join` runs fully non-interactive:

```bash
npx agentsync join http://192.168.1.20:7777 --name deepak --machine mac-a --agent claude --role backend
```

`join` writes your identity, **auto-configures your agent's MCP** (`.mcp.json` for Claude
Code; prints the Codex `config.toml` snippet), and installs the git hooks. That's it.
If `hub_url` is set in `agentsync.config.yaml`, the URL argument is optional too.

### 3. Agents self-onboard

Your Claude/Codex session reads [`AGENTS.md`](./AGENTS.md), asks "who am I working as?",
calls `agentsync_register`, and then works through `get_plan → claim_task → check_conflicts`
on its own. No babysitting.

---

## The four deployment scenarios

| Scenario | Who runs the hub | Participant does | Real-time |
|---|---|---|---|
| **Hackathon, one table** | one person: `npx agentsync hub` (LAN URL) | `npx agentsync join <url>` | ✅ |
| **Distributed team / company** | deploy hub once; commit `hub_url` | clone → `npx agentsync join` | ✅ |
| **Solo / local / CI** | `npx agentsync hub` on localhost | agents point at localhost | ✅ |
| **No-infra fallback** *(roadmap)* | none — state synced via a git branch | clone → join | ⚠️ near-real-time |

---

## Host your own hub (one-click)

For a distributed team, deploy the hub once to get a permanent public URL — no tunnels, no
"is the laptop on." The hub reads `PORT` and `AGENTSYNC_TOKEN` from the environment, so it
drops onto any persistent host:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dipakkr/agentsync)
&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)

- **Render** — click the button; the included `render.yaml` provisions a web service and
  generates `AGENTSYNC_TOKEN` for you. *(Free tier sleeps after ~15 min idle.)*
- **Railway** — New Project → Deploy from GitHub repo → set `AGENTSYNC_TOKEN`. Uses the
  bundled `railway.json`. Always-on; best for long sessions.
- **Fly.io / any container host** — a `Dockerfile` is included: `fly launch && fly deploy`.

After deploying, put the URL in your project's `agentsync.config.yaml` → `hub_url`, and
everyone's onboarding becomes just `agentsync join` (no URL needed).

### Persist state across redeploys

By default the event log (chat, tasks, plan, roster) lives in the container's filesystem,
so it's **wiped on every redeploy or idle-sleep**. To keep history, mount a persistent
volume and point `AGENTSYNC_DATA` at it — the hub writes one event log per project there
(`events.ndjson` for the `default` project, `project-<name>.ndjson` for others) and replays
them on boot:

- **Railway** — add a Volume to the service, mount it at `/data`, and set env
  `AGENTSYNC_DATA=/data`. Always-on + durable.
- **Fly.io** — `fly volumes create agentsync_data --size 1`, mount at `/data` in `fly.toml`,
  set `AGENTSYNC_DATA=/data`.
- **Render** — a persistent disk requires a **paid** instance (the free tier is always
  ephemeral); add a disk mounted at `/data` and set `AGENTSYNC_DATA=/data`.

`agentsync hub` prints the resolved data directory on startup and flags it as *ephemeral*
when `AGENTSYNC_DATA` is unset, so you can see at a glance whether the hub is durable.

### One hub, many projects

A single deployed hub serves any number of repos, kept isolated by a **project** key. Each
project gets its own roster, task board, plan, chat, event log, and — importantly — its own
conflict detection, so the same file globs in two different repos never cross-warn. The key
comes from `project:` in `agentsync.config.yaml` (defaults to the repo folder name); `join`
threads it through to the agent's MCP config automatically. View a specific project's
dashboard at `?project=<name>`.

> **Isolation is organizational, not a security boundary.** The shared `AGENTSYNC_TOKEN`
> still gates the whole hub, so anyone with it can join any project by naming it. For a hard
> wall between teams, run separate hubs with separate tokens.

> **Not Vercel.** The hub is a stateful, long-running WebSocket server — Vercel's serverless
> model can't host it. Use Render / Railway / Fly (above), or Cloudflare Durable Objects.

---

## The git flow it encourages

```
claim task ─▶ worktree off latest main, branch person/agent/slug
   work    ─▶ small, frequent commits (pre-commit blocks .env / keys / secrets)
   sync    ─▶ rebase on main when it advances (conflicts stay tiny)
   push    ─▶ pre-push announces the diff + warns on overlap  →  YOUR branch only
   done    ─▶ open PR → CI → auto-merge on green.  main is never pushed directly.
```

## Try the live demo

```bash
npx agentsync hub                 # terminal 1
AGENTSYNC_KEEP=1 npm run demo     # terminal 2 — 3 simulated agents plan, claim, collide
```

Watch the dashboard: three agents come online, the plan is approved, tasks get claimed,
and an **overlap warning** fires when one agent claims files another already owns.

---

## CLI reference

```
agentsync up [--hub <url>] [--token <secret>]
agentsync invite
agentsync init [--hub <url>]
agentsync hub [--port 7777] [--token <secret>] [--log <path>]
agentsync join [<hub-url>] [--name <you> --machine <label> --agent <kind> --role <role>] [--token <secret>]
agentsync status [<hub-url>]
agentsync whoami
agentsync mcp
```

| Command | What it does | Flags & environment |
|---|---|---|
| `up` | ⭐ Zero to live in one command: init + hub + join + dashboard + invite line | `--hub <url>` to use an already-deployed hub instead of starting a local one · `--token` |
| `invite` | Reprint the one-line join command for teammates | — |
| `init` | Make this repo AgentSync-aware: `agentsync.config.yaml`, `AGENTS.md` agent guide, `CLAUDE.md` pointer, gitignore `.agentsync/`. Idempotent | `--hub <url>` bakes the hub URL into the config |
| `hub` | Start the hub + dashboard | `--port` (or `PORT` env, default 7777) · `--token` (or `AGENTSYNC_TOKEN`) requires the secret to register · `AGENTSYNC_DATA` env sets the data dir (one event log per project; default `.agentsync/`) |
| `join` | Onboard this clone: write identity, configure MCP, install git hooks | URL defaults to `hub_url` in `agentsync.config.yaml`. Omit `--name` for interactive prompts; pass `--name --machine --agent --role` to script it. `--token` if the hub requires one · `--project` overrides the config's project |
| `status` | Print roster, tasks, and plan state for a project | URL defaults to your joined hub · `--project` defaults to your joined project |
| `whoami` | Show the identity this clone joined as | reads `.agentsync/identity.json` |
| `mcp` | Run the MCP stdio server (what your agent's `.mcp.json` launches) | `AGENTSYNC_HUB`, `AGENTSYNC_TOKEN`, `AGENTSYNC_PROJECT` |
| `announce` / `guard-commit` | Internal — called by the installed pre-push / pre-commit hooks | — |

## MCP tools agents get

`agentsync_register` · `get_plan` · `set_plan` · `approve_plan` · `list_members` ·
`list_tasks` · `add_task` · `claim_task` · `release_task` · `complete_task` ·
`check_conflicts` · `announce_edit` · `post_message` · `read_messages`

Full parameters, return shapes, and an end-to-end agent session:
**[docs/mcp-tools.md](./docs/mcp-tools.md)**.

## Configuration — `agentsync.config.yaml`

Roles, `hot_files` (extra-warned shared files), `protected_paths` (commit deny-list), and
the branch template all live here, committed as the team's shared rules of engagement.
Every key, plus `identity.json` and the environment variables, is documented in
**[docs/configuration.md](./docs/configuration.md)**.

## Architecture

```
apps            src/hub/      HTTP + WebSocket + event-sourced store (NDJSON)
                src/mcp/      MCP stdio server — the agent-facing tools
                src/cli/      hub · join · status · git-hook backends
                src/dashboard/ single-file live UI (roster · chat · board · timeline)
                src/lib/      shared hub client (Node global WebSocket)
hooks/          pre-push (announce+overlap) · pre-commit (protected-path guard)
```

Building a client or integrating another agent? The hub's HTTP endpoints and the full
WebSocket protocol are documented in **[docs/hub-api.md](./docs/hub-api.md)**.

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `WebSocket is not defined` / syntax errors on start | Node < 22. AgentSync uses Node's built-in WebSocket — upgrade to Node ≥ 22 (`node -v`). |
| `(no git repo — skipped hook install)` on join | You joined from a folder that isn't a git clone. Identity + MCP still work; re-run `join` inside the repo to get the hooks. |
| `bad token` when registering | The hub was started with `--token` (or `AGENTSYNC_TOKEN`) and yours doesn't match. Re-join with `--token <secret>`. |
| Member shows offline while their agent is running | Presence flips offline after 30 s without a heartbeat — usually the agent's MCP session ended or the hub URL changed. Their claims auto-release after 90 s offline, so locks never leak. |
| Claimed a task, got an overlap warning | Not an error — another member's active claim shares files with yours. Coordinate in chat before editing; the hub warns, it never blocks. |
| Dashboard loads but chat/tools do nothing | You're hitting HTTP while the hub is behind an HTTPS proxy (or vice-versa). Use the exact scheme of the hub URL — `https://…` upgrades to `wss://` automatically. |
| Hub restarted — is the board gone? | Only if the hub is ephemeral. State replays from the per-project event logs in the data dir (`.agentsync/` by default; set `AGENTSYNC_DATA` to a mounted volume to persist). Delete a project's log file for a fresh board. |
| Two repos on one hub see each other's tasks/chat | They're using the same `project`. Set a distinct `project:` in each repo's `agentsync.config.yaml` (defaults to the folder name) and re-`join`. |

## Roadmap

- Git-branch transport for the no-infra fallback
- Auto-spawn per-task worktrees from the CLI
- PR/CI status surfaced on the board
- Auth on the hub (currently a shared token)

## License

MIT
