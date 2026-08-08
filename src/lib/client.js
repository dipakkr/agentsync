// Thin hub client used by both the MCP server and the CLI. Uses Node's global
// WebSocket (Node 22+), so no client-side dependency. Promise-based request/reply
// for the handful of calls that expect an answer; everything else is fire-and-forget.

export class HubClient {
  constructor({ url, token = "", member }) {
    this.url = url.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
    this.token = token;
    this.member = member; // {id, person, machine, agentKind, role} — optional for read-only clients
    this.state = { members: [], tasks: [], plan: null, messages: [] };
    this._waiters = []; // {match(msg)->bool, resolve}
    this._hb = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        if (this.member) {
          ws.send(JSON.stringify({ type: "register", member: this.member, token: this.token }));
        }
        this._hb = setInterval(() => this._safeSend({ type: "heartbeat" }), 10_000);
        resolve(this);
      });
      ws.addEventListener("error", (e) => reject(e.error || new Error("ws error")));
      ws.addEventListener("close", () => clearInterval(this._hb));
      ws.addEventListener("message", (e) => this._onMsg(JSON.parse(e.data)));
    });
  }

  _onMsg(m) {
    if (m.type === "welcome" || m.type === "registered") Object.assign(this.state, m.state);
    if (m.type === "task.list") this.state.tasks = m.tasks;
    if (m.type === "plan.update") this.state.plan = m.plan;
    if (m.type === "presence") this.state.members = m.members;
    if (m.type === "event") this._applyEvent(m.event);
    this._waiters = this._waiters.filter((w) => {
      if (w.match(m)) { w.resolve(m); return false; }
      return true;
    });
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
      this.state.messages.push({ id: ev.seq, from: ev.actor, to: ev.to || null, text: ev.text, ts: ev.ts });
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
    this._safeSend({ type: "register", member: this.member, token: this.token });
    const m = await this._await((x) => x.type === "registered");
    Object.assign(this.state, m.state);
    return m.member;
  }
  async getState() { return this.state; }
  setPlan(text) { this._safeSend({ type: "plan.set", text }); }
  approvePlan() { this._safeSend({ type: "plan.approve" }); }
  addTask(task) { this._safeSend({ type: "task.add", task }); }
  releaseTask(taskId) { this._safeSend({ type: "task.release", taskId }); }
  completeTask(taskId) { this._safeSend({ type: "task.complete", taskId }); }
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
    return this._await((x) => x.type === "claim.result" && x.taskId === taskId);
  }
  async assignTask(taskId, memberId, admin = "") {
    this._safeSend({ type: "task.assign", taskId, memberId, admin });
    return this._await((x) => x.type === "assign.result" && x.taskId === taskId);
  }
  async splitTask(taskId, subtasks, admin = "") {
    this._safeSend({ type: "task.split", taskId, subtasks, admin });
    return this._await((x) => x.type === "split.result" && x.taskId === taskId);
  }
  async setTaskStatus(taskId, status, { memberId, admin } = {}) {
    this._safeSend({ type: "task.status", taskId, status, memberId, admin });
    return this._await((x) => x.type === "status.result" && x.taskId === taskId);
  }
  async deleteTask(taskId, admin = "") {
    this._safeSend({ type: "task.delete", taskId, admin });
    return this._await((x) => x.type === "delete.result" && x.taskId === taskId);
  }
  async checkConflicts(files) {
    this._safeSend({ type: "conflict.check", files });
    return this._await((x) => x.type === "conflict.result");
  }
  async announceEdit(files, summary) {
    this._safeSend({ type: "edit.announce", files, summary });
    return this._await((x) => x.type === "announce.result");
  }
  close() { clearInterval(this._hb); this.ws?.close(); }
}
