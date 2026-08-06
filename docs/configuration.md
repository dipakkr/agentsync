# Configuration reference

AgentSync has three layers of configuration, from shared to per-person:

| File | Committed? | Purpose |
|---|---|---|
| `agentsync.config.yaml` | ✅ yes | The team's shared rules of engagement |
| `.agentsync/identity.json` | ❌ gitignored | Who *this clone* joined as, which hub, which token |
| `.mcp.json` | project choice | Launches the AgentSync MCP server for your agent |

Environment variables override files everywhere they apply.

## `agentsync.config.yaml`

```yaml
project: my-project

# Deploy the hub once, commit its URL, and `agentsync join` becomes zero-argument.
# Leave blank for ephemeral (hackathon) hubs passed on the command line.
hub_url: ""

# Roles a member can take — used to assign work and render the roster.
# `sandbox` is advisory metadata for agents; the hub does not enforce it.
roles:
  - name: orchestrator   # drafts the plan, decomposes tasks, assigns roles
    sandbox: read-write
  - name: coder
    sandbox: read-write
  - name: reviewer       # reads PRs, never edits
    sandbox: read-only

# Files everyone touches. Advisory today: claiming a scope that includes these is
# meant to trigger a stronger warning (enforcement is on the roadmap).
hot_files:
  - package.json
  - "**/schema.*"

# Globs the pre-commit hook refuses to let anyone commit.
protected_paths:
  - .env
  - "**/*.key"
  - "**/secrets.*"

git:
  # {person}/{agent}/{slug} keeps `git branch` readable across the whole roster.
  branch_template: "{person}/{agent}/{slug}"
  # Only ever advanced by CI auto-merge of a green PR. Never pushed directly.
  protected_branch: main
```

| Key | Used by | Effect |
|---|---|---|
| `project` | dashboard | Display name |
| `hub_url` | `join`, hooks | Default hub when no URL is passed |
| `roles[].name` | `join` prompt | The role choices offered at onboarding |
| `roles[].sandbox` | agents | Advisory: `read-only` roles shouldn't edit |
| `hot_files` | — | Advisory / roadmap: extra-warned shared files |
| `protected_paths` | `guard-commit` (pre-commit hook) | Commit is **blocked** if a staged file matches |
| `git.branch_template` | convention | How members name their branches |
| `git.protected_branch` | `announce` (pre-push hook) | The base branch diffs are announced against |

## `.agentsync/identity.json`

Written by `agentsync join` (or by the `agentsync_register` MCP tool). Never commit it.

```json
{
  "member": {
    "id": "deepak.mac-a.claude",
    "person": "deepak",
    "machine": "mac-a",
    "agentKind": "claude",
    "role": "coder"
  },
  "hubUrl": "https://hub.example.com/",
  "token": ""
}
```

## `.mcp.json`

`join` adds an `agentsync` entry alongside whatever MCP servers you already have:

```json
{
  "mcpServers": {
    "agentsync": {
      "command": "node",
      "args": ["<agentsync package>/src/mcp/server.js"],
      "env": { "AGENTSYNC_HUB": "https://hub.example.com/", "AGENTSYNC_TOKEN": "" }
    }
  }
}
```

Claude Code picks this up automatically. For Codex, `join --agent codex` prints the
equivalent `~/.codex/config.toml` snippet.

## Environment variables

| Variable | Where | Effect |
|---|---|---|
| `PORT` | `agentsync hub` | Listen port (also `--port`; default 7777) |
| `AGENTSYNC_TOKEN` | hub + MCP server + hooks | Shared secret. On the hub: require it to register. On clients: send it |
| `AGENTSYNC_HUB` | MCP server | Hub URL override (takes precedence over `identity.json`) |
| `AGENTSYNC_KEEP` | `npm run demo` | Keep the three simulated demo agents online instead of exiting |

## Hub timing constants

Two constants in `src/hub/server.js` govern presence (change them if you fork):

| Constant | Default | Meaning |
|---|---|---|
| `OFFLINE_AFTER` | 30 s | No heartbeat for this long → member shown offline |
| `RELEASE_AFTER` | 90 s | Offline for this long → their claimed tasks auto-release, so locks never leak |
