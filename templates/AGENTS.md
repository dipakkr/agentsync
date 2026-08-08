<!-- agentsync:begin — how coding agents should use AgentSync in this repo. Safe to edit above/below these markers. -->
## Working in this repo with AgentSync

This repository is coordinated by **AgentSync** — a shared hub (chat + task board +
presence) that keeps every human and AI agent aware of each other so fast agents never
collide on the same file. You have the `agentsync` MCP tools available. Use them.

**Golden rule:** git owns the code; the hub owns awareness. The hub only *warns* — it never
blocks git — so the moment you see an overlap, coordinate in chat before you edit.

### On session start
1. If `.agentsync/identity.json` does **not** exist, you aren't introduced yet. Ask the human
   for their **name**, this **machine's label**, and which **agent** you are, then call
   `agentsync_register`. Your id becomes `<person>.<machine>.<agent>`.
2. If it exists, reuse that identity — don't ask again.

### Before writing any code
1. `get_plan` — there must be an **approved** plan. If none, help draft one (tasks, each with a
   file scope) instead of coding blind.
2. `list_tasks` → pick an unclaimed task matching your role → `claim_task`.
   - If the claim **warns of an overlap**, STOP and coordinate in chat first.
3. Tasks may be **assigned** to you by a manager: check `list_tasks` for tasks whose
   `assignee` is your id, and watch `read_messages` for 📋 assignment notifications.
   Claim assigned tasks first — they're yours to pick up.

### If you are the orchestrator/manager
Registered with role `orchestrator` or `manager`, you can also direct the work:
`split_task` oversized tasks into scoped subtasks, `assign_task` them to idle members,
and `update_task_status` to move work to review/done. Narrate handoffs in chat and keep
the humans' dashboard as the source of truth.

### While working
- Stay inside your claimed task's file scope, on your own branch (`<person>/<agent>/<slug>`).
- `post_message` when you start, finish, or get blocked — keep the team aware. Address another
  agent directly with `to: "<their-id>"` to ask them something; leave `to` empty to tell everyone.
- **`read_messages` to receive replies.** The hub does not push chat at you — you must pull it.
  Call `read_messages` to see broadcasts + anything addressed to you, then pass the returned
  `max_id` as `since_id` next time so you only get what's new. This is how you and another agent
  hold a conversation: you `post_message(to: peer)`, then poll `read_messages` for their answer.
  Check it when you start a task, when you're blocked, and before you push. Everything you and
  the others say is visible on the human dashboard, so this doubles as your status feed.
- Need to touch a file you don't own? `check_conflicts` first, then ask the owner in chat.
- Commit small and often. Never commit `.env`, keys, or secrets.

### Before you push
- `check_conflicts` on the files you're about to push. If it overlaps someone's active work,
  resolve it in chat before pushing.
- Push to **your** branch only — never `main`. Open a PR; CI merges when green.
- `complete_task` (or `release_task`) when your PR is up.

### Your AgentSync tools
`agentsync_register` · `get_plan` · `set_plan` · `approve_plan` · `list_members` ·
`list_tasks` · `add_task` · `claim_task` · `release_task` · `complete_task` ·
`assign_task` · `split_task` · `update_task_status` ·
`check_conflicts` · `announce_edit` · `post_message` · `read_messages`
<!-- agentsync:end -->
