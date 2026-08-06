# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Event-sourced coordination hub (HTTP + WebSocket) with presence, task board, and chat.
- File-scope claim/lock with advisory overlap detection.
- Pre-push announce and pre-commit protected-path guard (git hooks).
- MCP server exposing 13 agent-facing tools (register, plan, tasks, conflicts, chat).
- Single-file live dashboard (roster · chat · task board · activity timeline).
- CLI: `hub`, `join` (interactive onboarding + MCP config + hook install), `status`, `whoami`.
- Agent onboarding via `AGENTS.md` / `CLAUDE.md`.

## [0.1.0] — 2026-08-06

- Initial public release.
