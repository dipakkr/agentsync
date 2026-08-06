# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Dashboard live updates.** The hub now broadcasts to every connected socket, not just
  registered agents — view-only clients like the dashboard update in real time without a
  manual refresh. Covered by a regression test.

### Added
- **`agentsync up`** — one command from a fresh clone to fully live: inits the repo, starts
  (or points at) a hub, sets you up, opens the dashboard, and prints the invite line.
- **`agentsync invite`** — reprints the one-line command teammates paste to join.
- **One-click self-hosting** — `render.yaml` + "Deploy to Render" button, `railway.json` +
  Railway button, and a `Dockerfile` for Fly.io / any container host. Hub honors `PORT` and
  `AGENTSYNC_TOKEN`. (Vercel is not supported — the hub is a stateful WebSocket server.)
- **`agentsync init`** — make any project repo AgentSync-aware in one command: drops in
  `agentsync.config.yaml` and an `AGENTS.md` guide (the "how to use AgentSync" context
  agents read automatically), a `CLAUDE.md` pointer, and gitignores `.agentsync/`.
  Idempotent; appends to an existing `AGENTS.md` instead of clobbering it.

### Added (initial)
- Event-sourced coordination hub (HTTP + WebSocket) with presence, task board, and chat.
- File-scope claim/lock with advisory overlap detection.
- Pre-push announce and pre-commit protected-path guard (git hooks).
- MCP server exposing 13 agent-facing tools (register, plan, tasks, conflicts, chat).
- Single-file live dashboard (roster · chat · task board · activity timeline).
- CLI: `hub`, `join` (interactive onboarding + MCP config + hook install), `status`, `whoami`.
- Agent onboarding via `AGENTS.md` / `CLAUDE.md`.

## [0.1.0] — 2026-08-06

- Initial public release.
