// Event-sourced state for the hub. Every change is an append-only NDJSON event;
// state is rebuilt by replaying the log on boot. The log doubles as the audit
// trail and the dashboard's activity timeline.

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { scopesOverlap, filesInScope } from "./glob.js";

const MAX_MESSAGES = 500; // kept in memory for the dashboard / welcome snapshot

export class Store {
  constructor(logPath) {
    this.logPath = logPath;
    this.seq = 0;
    this.members = new Map();
    this.tasks = new Map();
    this.plan = null;
    this.messages = [];
    this.events = []; // recent, for the timeline
    this._replay();
  }

  _replay() {
    if (!this.logPath || !existsSync(this.logPath)) return;
    const lines = readFileSync(this.logPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        this._apply(JSON.parse(line), false);
      } catch {
        /* skip corrupt line */
      }
    }
  }

  /** Record an event: persist it, fold it into state, return it for broadcast. */
  record(type, payload = {}, actor = "system") {
    const ev = { seq: ++this.seq, ts: Date.now(), type, actor, ...payload };
    if (this.logPath) {
      mkdirSync(dirname(this.logPath), { recursive: true });
      appendFileSync(this.logPath, JSON.stringify(ev) + "\n");
    }
    this._apply(ev, true);
    return ev;
  }

  _apply(ev, live) {
    if (ev.seq > this.seq) this.seq = ev.seq;
    switch (ev.type) {
      case "member.register": {
        const prev = this.members.get(ev.member.id) || {};
        this.members.set(ev.member.id, {
          ...prev,
          ...ev.member,
          online: true,
          lastBeat: ev.ts,
          joinedAt: prev.joinedAt || ev.ts,
        });
        break;
      }
      case "member.presence": {
        const m = this.members.get(ev.memberId);
        if (m) {
          m.online = ev.online;
          if (ev.online) m.lastBeat = ev.ts;
        }
        break;
      }
      case "plan.set":
        this.plan = { text: ev.text, status: "draft", updatedAt: ev.ts };
        break;
      case "plan.approve":
        if (this.plan) this.plan.status = "approved";
        break;
      case "task.add":
        this.tasks.set(ev.task.id, {
          status: "open",
          owner: null,
          assignee: null,
          ...ev.task,
        });
        break;
      case "task.assign": {
        const t = this.tasks.get(ev.taskId);
        if (t) t.assignee = ev.memberId;
        break;
      }
      case "task.status": {
        const t = this.tasks.get(ev.taskId);
        if (t) {
          t.status = ev.status;
          if (ev.status === "open") t.owner = null;
          if (ev.status === "claimed") {
            t.owner = ev.memberId || t.assignee;
            t.claimedAt = ev.ts;
          }
          // review/done keep the owner
        }
        break;
      }
      case "task.split": {
        // event carries the fully-built subtask objects so replay rebuilds identically
        for (const s of ev.subtasks || []) {
          this.tasks.set(s.id, { status: "open", owner: null, assignee: null, ...s });
        }
        const t = this.tasks.get(ev.taskId);
        if (t) t.status = "split";
        break;
      }
      case "task.delete":
        this.tasks.delete(ev.taskId);
        break;
      case "task.claim": {
        const t = this.tasks.get(ev.taskId);
        if (t) {
          t.status = "claimed";
          t.owner = ev.memberId;
          t.claimedAt = ev.ts;
        }
        break;
      }
      case "task.release": {
        const t = this.tasks.get(ev.taskId);
        if (t) {
          t.status = "open";
          t.owner = null;
        }
        break;
      }
      case "task.complete": {
        const t = this.tasks.get(ev.taskId);
        if (t) t.status = "done";
        break;
      }
      case "chat":
        this.messages.push({ id: ev.seq, from: ev.actor, to: ev.to || null, text: ev.text, ts: ev.ts });
        if (this.messages.length > MAX_MESSAGES) this.messages.shift();
        break;
      case "edit.announce":
        // announcement only — surfaced in the timeline; no state mutation
        break;
    }
    // keep a bounded tail of raw events for the timeline
    this.events.push(ev);
    if (this.events.length > MAX_MESSAGES) this.events.shift();
  }

  // ---- queries ---------------------------------------------------------------

  snapshot() {
    return {
      members: [...this.members.values()],
      tasks: [...this.tasks.values()],
      plan: this.plan,
      messages: this.messages,
      events: this.events.slice(-100),
    };
  }

  /**
   * Active claims (by other members) whose file scope overlaps `scope`.
   * Used both when claiming a task and when checking a push.
   */
  overlappingClaims(scope, excludeMemberId) {
    const hits = [];
    for (const t of this.tasks.values()) {
      if (t.status !== "claimed") continue;
      if (t.owner === excludeMemberId) continue;
      if (scopesOverlap(scope, t.scope || [])) {
        hits.push({ taskId: t.id, title: t.title, owner: t.owner, scope: t.scope });
      }
    }
    return hits;
  }

  /** Which active claims (by others) cover any of `files`. */
  claimsTouchingFiles(files, excludeMemberId) {
    const hits = [];
    for (const t of this.tasks.values()) {
      if (t.status !== "claimed" || t.owner === excludeMemberId) continue;
      const touched = filesInScope(files, t.scope || []);
      if (touched.length) hits.push({ taskId: t.id, owner: t.owner, files: touched });
    }
    return hits;
  }
}
