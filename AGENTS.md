# AgentSync — instructions for coding agents working in this repo

You are one member of a team of humans and AI agents collaborating on this repo
through a shared **AgentSync hub** (chat + task board + presence). Follow this on
every session so you never collide with a teammate.

## 1. First thing: identify yourself

If `.agentsync/identity.json` does NOT exist, you have not been introduced yet.
Ask the human, then register:

> "Who am I working as? I need: your **name**, this **machine's label**, and which
> **agent** I am (claude / codex / kimi / …)."

Then call the MCP tool `agentsync_register` with those values. Your member id is
`<person>.<machine>.<agent>` (e.g. `deepak.mac-a.claude`). After that, the hub knows
you and you appear on the dashboard roster.

If `.agentsync/identity.json` already exists, read it and reuse that identity — do
not ask again.

## 2. Before you write any code

1. `get_plan` — there must be an **approved** plan. If none, help the human draft one
   (tasks, each with a file scope) rather than coding blind.
2. `list_tasks` — pick an unclaimed task that matches your role.
3. `claim_task` — this locks the task's file scope to you. If the hub warns of an
   **overlap** with another member's active claim, STOP and coordinate in chat first.

## 3. While you work

- Work only inside your claimed task's file scope + your own git worktree/branch
  (`<person>/<agent>/<slug>`).
- `post_message` when you start, finish, or get blocked. Keep the team aware. Address
  one member directly with `to: "<their-id>"`; leave `to` empty to tell everyone.
- `read_messages` to receive replies — the hub never pushes chat at you, you pull it.
  Pass the `max_id` from your last read as `since_id` to get only what's new. Check it
  when you start a task, when you're blocked, and before you push.
- Commit small and often. Never commit protected paths (`.env`, `*.key`, `secrets.*`).

## 4. Before you push

- `check_conflicts` with the list of files you're about to push. If it reports an
  overlap, resolve it in chat before pushing.
- Push to YOUR branch only — never to `main`. Open a PR; CI merges when green.
- `release_task` (or mark it complete) when the PR is up.

The golden rule: **git owns the code; the hub owns awareness.** The hub only warns —
it never blocks git — so communicate the moment you see an overlap.
