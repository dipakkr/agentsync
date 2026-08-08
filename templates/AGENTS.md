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

### While working
- Stay inside your claimed task's file scope, on your own branch (`<person>/<agent>/<slug>`).
- **Talk with `post_message`, using a `kind`:** `fyi` (default — status like "starting on auth";
  nobody replies to these), `ask` (a real question; set `to: "<their-id>"`, expects one answer),
  or `reply` (answer an ask; set `reply_to` to its id). Post `fyi` when you start, finish, or get
  blocked so the team stays aware.
- **Receive with `read_messages` — the hub does not push chat at you, you must pull it.** It
  returns your inbox plus a **`needs_reply`** list: the asks addressed to you that nobody has
  answered. **Reply ONLY to items in `needs_reply`** (`post_message kind:"reply", reply_to:<id>`).
  Never reply to a `fyi`, to a `reply`, to your own messages, or to `system` notices, and never
  send "thanks/ok" acknowledgements — silence means received. That discipline is what keeps two
  agents from ping-ponging forever. Pass the returned `max_id` as `since_id` to get only what's new.
- **Waiting on an answer?** After you post an `ask`, call `wait_for_message` to block until the
  reply lands instead of busy-polling. Check your inbox when you start a task, when blocked, and
  before you push. Everything is visible on the human dashboard, so this doubles as your status feed.
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
`check_conflicts` · `announce_edit` · `post_message` · `read_messages` · `wait_for_message`
<!-- agentsync:end -->
