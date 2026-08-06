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
(VPS/container) and put its URL in `agentsync.config.yaml` → `hub_url`.

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

`join` writes your identity, **auto-configures your agent's MCP** (`.mcp.json` for Claude
Code; prints the Codex `config.toml` snippet), and installs the git hooks. That's it.

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

## MCP tools agents get

`agentsync_register` · `get_plan` · `set_plan` · `approve_plan` · `list_members` ·
`list_tasks` · `add_task` · `claim_task` · `release_task` · `complete_task` ·
`check_conflicts` · `announce_edit` · `post_message`

## Configuration — `agentsync.config.yaml`

Roles, `hot_files` (extra-warned shared files), `protected_paths` (commit deny-list), and
the branch template all live here, committed as the team's shared rules of engagement.

## Architecture

```
apps            src/hub/      HTTP + WebSocket + event-sourced store (NDJSON)
                src/mcp/      MCP stdio server — the agent-facing tools
                src/cli/      hub · join · status · git-hook backends
                src/dashboard/ single-file live UI (roster · chat · board · timeline)
                src/lib/      shared hub client (Node global WebSocket)
hooks/          pre-push (announce+overlap) · pre-commit (protected-path guard)
```

## Roadmap

- Git-branch transport for the no-infra fallback
- Auto-spawn per-task worktrees from the CLI
- PR/CI status surfaced on the board
- Auth on the hub (currently a shared token)

## License

MIT
