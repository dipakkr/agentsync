# Contributing to AgentSync

Thanks for wanting to help! AgentSync is young and every contribution counts.

## Ground rules (we dogfood our own tool)

AgentSync exists to make teams — humans *and* agents — coordinate before they collide.
So we work the way the README preaches:

- **Plan first.** Open an issue describing the change before a big PR.
- **Small, scoped PRs.** One concern per PR. Easy to review, easy to merge.
- **Branch naming:** `you/topic` (e.g. `deepak/no-infra-transport`).
- **Never push `main`.** Open a PR; CI must be green.

## Dev setup

```bash
git clone https://github.com/dipakkr/agentsync
cd agentsync
npm install
npm test          # runs the hub + coordination smoke test
```

Try it live:

```bash
npx . hub                       # terminal 1
AGENTSYNC_KEEP=1 npm run demo   # terminal 2
```

## Project layout

| Path | What |
|---|---|
| `src/hub/` | HTTP + WebSocket hub, event-sourced store, overlap engine |
| `src/mcp/` | MCP server — the agent-facing tools |
| `src/cli/` | `hub` / `join` / `status` + git-hook backends |
| `src/dashboard/` | single-file live UI |
| `src/lib/` | shared hub client |
| `hooks/` | git hooks (pre-push, pre-commit) |

## Good first issues

- Git-branch transport for the no-infra fallback scenario
- Auto-spawn per-task git worktrees from the CLI
- Surface PR/CI status on the task board
- Real auth on the hub (currently a shared token)

## Before you open a PR

- `npm test` passes
- New behavior has at least a smoke assertion in `scripts/smoke.js`
- The README/docs reflect any user-facing change

By contributing you agree your work is licensed under the project's [MIT License](./LICENSE).
