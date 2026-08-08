// Thin hub client used by both the MCP server and the CLI. Uses Node's global
// WebSocket (Node 22+), so no client-side dependency. Promise-based request/reply
// for the handful of calls that expect an answer; everything else is fire-and-forget.
//
// Resilience: the socket self-heals. On an unexpected drop (hub redeploy, sleep,
// network blip) it reconnects with backoff, re-registers, merges the fresh snapshot
// without losing buffered messages, and RE-ASSERTS its task claims — so a transient
// disconnect can never silently strip an agent's file-scope locks while it keeps editing.

export class HubClient {
  constructor({ url, token = "", member, project = null }) {
    this.url = url.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
    this.token = token;
    this.member = member; // {id, person, machine, agentKind, role} — optional for read-only clients
    this.project = project; // reserved for per-project partitioning; sent at register if set
    this.state = { members: [], tasks: [], plan: null, messages: [] };
    this._waiters = []; // {match(msg)->bool, resolve}
    this._hb = null;
    this._closed = false; // set by close() — suppresses reconnect
    this._everOpen = false; // have we ever had a live socket? (first-connect vs reconnect)
    this._needResync = false; // set on a reconnect; drives claim re-assertion on next `registered`
    this._backoff = 500; // ms, doubles per failed attempt up to a cap
    this._reconnectTimer = null;
    this._myClaims = new Set(); // taskIds I hold — replayed after a reconnect
    this.onReconnect = null; // optional hook the host can set (e.g. to log)
  }

  connect() {
    return new Promise((resolve, reject) => this._open(resolve, reject));
  }

  // Open a socket and wire it up. `resolve/reject` settle the FIRST connect only;
  // reconnect attempts pass null and are driven by the close→backoff loop instead.
  _open(resolve, reject) {
    let settled = false;
    const wasOpenBefore = this._everOpen;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this._everOpen = true;
      this._backoff = 500; // healthy connection resets backoff
      if (wasOpenBefore) this._needResync = true; // this is a reconnect
      if (this.member) this._sendRegister();
      clearInterval(this._hb);
      this._hb = setInterval(() => this._safeSend({ type: "heartbeat" }), 10_000);
      if (!settled) { settled = true; resolve?.(this); }
    });

    ws.addEventListener("error", (e) => {
      // Only reject the very first connect. Later errors fall through to close→reconnect.
      if (!settled && !wasOpenBefore) { settled = true; reject?.(e.error || new Error("ws error")); }
    });

    ws.addEventListener("close", () => {
      clearInterval(this._hb);
      if (this._closed) return; // intentional close()
      if (!this._everOpen) return; // initial connect failed — already rejected
      this._scheduleReconnect();
    });

    ws.addEventListener("message", (e) => {
      try { this._onMsg(JSON.parse(e.data)); } catch { /* ignore malformed frame */ }
    });
  }

  _scheduleReconnect() {
    if (this._closed || this._reconnectTimer) return;
    const base = Math.min(this._backoff, 15_000);
    const delay = base * (0.7 + Math.random() * 0.6); // jitter to avoid thundering herds
    this._backoff = Math.min(this._backoff * 2, 15_000);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open(null, null);
    }, delay);
  }

  _sendRegister() {
    const msg = { type: "register", member: this.member, token: this.token };
    if (this.project) msg.project = this.project;
    this._safeSend(msg);
  }

  _onMsg(m) {
    if (m.type === "welcome" || m.type === "registered") this._mergeState(m.state);
    if (m.type === "task.list") this.state.tasks = m.tasks;
    if (m.type === "plan.update") this.state.plan = m.plan;
    if (m.type === "presence") this.state.members = m.members;
    if (m.type === "event") this._applyEvent(m.event);
    // After a reconnect, the fresh `registered` snapshot is our cue to reclaim what we held.
    if (m.type === "registered" && this._needResync) {
      this._needResync = false;
      this._resyncClaims();
      try { this.onReconnect?.(); } catch { /* host hook must never break the client */ }
    }
    this._waiters = this._waiters.filter((w) => {
      if (w.match(m)) { w.resolve(m); return false; }
      return true;
    });
  }

  // Merge a hub snapshot into local state by id — never wholesale-replace. A snapshot can
  // arrive stale (a duplicate `registered` from connect, or a reconnect snapshot older than
  // events we already applied); replacing would clobber roster/tasks we already know about
  // and drop buffered chat. Union-by-id keeps newer knowledge and folds in anything missing.
  _mergeState(snap) {
    if (!snap) return;
    if (snap.members) this.state.members = this._unionById(this.state.members, snap.members);
    if (snap.tasks) this.state.tasks = this._unionById(this.state.tasks, snap.tasks);
    if (snap.plan) this.state.plan = snap.plan; // adopt a real plan; never null out a known one
    if (snap.messages) {
      const seen = new Set((this.state.messages || []).map((x) => x.id));
      for (const msg of snap.messages) if (!seen.has(msg.id)) this.state.messages.push(msg);
      this.state.messages.sort((a, b) => (a.id || 0) - (b.id || 0));
    }
  }

  _unionById(current = [], incoming = []) {
    const byId = new Map(current.map((x) => [x.id, x]));
    for (const x of incoming) byId.set(x.id, { ...(byId.get(x.id) || {}), ...x });
    return [...byId.values()];
  }

  // Locks don't leak, and they don't vanish either: reclaim any task I still consider mine
  // that got released while I was disconnected. If someone else took it over, say so loudly.
  _resyncClaims() {
    const me = this.member?.id;
    for (const taskId of this._myClaims) {
      const t = (this.state.tasks || []).find((x) => x.id === taskId);
      if (t && t.status === "claimed" && t.owner === me) continue; // still mine — nothing to do
      this.claimTask(taskId)
        .then((r) => { if (!r.ok) this.postMessage(`⚠️ lost my claim on "${taskId}" during a disconnect — now ${r.reason}`); })
        .catch(() => { /* hub slow to answer; next reconnect retries */ });
    }
  }

  // Keep local state live from broadcast events (roster joins, presence, chat).
  _applyEvent(ev) {
    if (ev.type === "member.register") {
      const i = this.state.members.findIndex((x) => x.id === ev.member.id);
      const next = { ...(i >= 0 ? this.state.members[i] : {}), ...ev.member, online: true };
      if (i >= 0) this.state.members[i] = next;
      else this.state.members.push(next);
    } else if (ev.type === "member.presence") {
      const mem = this.state.members.find((x) => x.id === ev.memberId);
      if (mem) mem.online = ev.online;
    } else if (ev.type === "chat") {
      if (!this.state.messages.some((x) => x.id === ev.seq)) {
        this.state.messages.push({ id: ev.seq, from: ev.actor, to: ev.to || null, text: ev.text, ts: ev.ts });
      }
    }
  }

  _safeSend(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  _await(match, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      this._waiters.push(w);
      setTimeout(() => {
        this._waiters = this._waiters.filter((x) => x !== w);
        reject(new Error("hub timeout"));
      }, timeout);
    });
  }

  // ---- API -------------------------------------------------------------------
  async register() {
    this._sendRegister();
    const m = await this._await((x) => x.type === "registered");
    this._mergeState(m.state);
    return m.member;
  }
  async getState() { return this.state; }
  setPlan(text) { this._safeSend({ type: "plan.set", text }); }
  approvePlan() { this._safeSend({ type: "plan.approve" }); }
  addTask(task) { this._safeSend({ type: "task.add", task }); }
  releaseTask(taskId) { this._myClaims.delete(taskId); this._safeSend({ type: "task.release", taskId }); }
  completeTask(taskId) { this._myClaims.delete(taskId); this._safeSend({ type: "task.complete", taskId }); }
  postMessage(text, to = null) { this._safeSend({ type: "chat", text, to }); }

  /**
   * Your inbox: broadcasts + messages addressed to you (and your own, for context).
   * Poll with the `max_id` you last saw to get only what's new — this is how one
   * agent picks up another agent's reply. `all:true` returns every message (what
   * the dashboard shows a human). Reads from live local state kept current over WS.
   */
  readMessages({ sinceId = 0, all = false, limit = 50 } = {}) {
    const me = this.member?.id;
    let msgs = this.state.messages || [];
    if (sinceId) msgs = msgs.filter((m) => (m.id || 0) > sinceId);
    if (!all) msgs = msgs.filter((m) => !m.to || m.to === me || m.from === me);
    msgs = msgs.slice(-limit);
    const maxId = msgs.reduce((x, m) => Math.max(x, m.id || 0), sinceId);
    return { messages: msgs, max_id: maxId, me };
  }

  async claimTask(taskId) {
    this._safeSend({ type: "task.claim", taskId, memberId: this.member.id });
    const r = await this._await((x) => x.type === "claim.result" && x.taskId === taskId);
    if (r.ok) this._myClaims.add(taskId);
    return r;
  }
  async checkConflicts(files) {
    this._safeSend({ type: "conflict.check", files });
    return this._await((x) => x.type === "conflict.result");
  }
  async announceEdit(files, summary) {
    this._safeSend({ type: "edit.announce", files, summary });
    return this._await((x) => x.type === "announce.result");
  }
  close() {
    this._closed = true;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._hb);
    this.ws?.close();
  }
}
