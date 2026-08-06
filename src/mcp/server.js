#!/usr/bin/env node
// AgentSync MCP server — exposes the hub to any MCP-speaking agent (Claude, Codex, …).
// Launched per-agent, in the repo root, via the agent's MCP config (written by `agentsync join`).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HubClient } from "../lib/client.js";

const IDENTITY = join(process.cwd(), ".agentsync", "identity.json");

function loadIdentity() {
  if (existsSync(IDENTITY)) return JSON.parse(readFileSync(IDENTITY, "utf8"));
  return null;
}
function saveIdentity(id) {
  mkdirSync(join(process.cwd(), ".agentsync"), { recursive: true });
  writeFileSync(IDENTITY, JSON.stringify(id, null, 2));
}

let client = null; // lazy HubClient
async function hub() {
  if (client) return client;
  const id = loadIdentity();
  if (!id) throw new Error("Not registered yet. Call agentsync_register with your person, machine and agent first.");
  const url = process.env.AGENTSYNC_HUB || id.hubUrl;
  if (!url) throw new Error("No hub URL. Set AGENTSYNC_HUB or run `agentsync join <url>`.");
  client = new HubClient({ url, token: process.env.AGENTSYNC_TOKEN || id.token || "", member: id.member });
  await client.connect();
  await client.register();
  return client;
}

const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });

const TOOLS = {
  agentsync_register: {
    description: "Introduce yourself to the team hub. Call this once per clone if not already registered. Creates member id <person>.<machine>.<agent>.",
    inputSchema: { type: "object", required: ["person", "machine", "agent"], properties: {
      person: { type: "string", description: "Human's name, e.g. deepak" },
      machine: { type: "string", description: "This machine's label, e.g. mac-a" },
      agent: { type: "string", description: "Which agent you are: claude | codex | kimi | …" },
      role: { type: "string", description: "Optional role: coder | frontend | backend | reviewer | planner | orchestrator" },
    } },
    handler: async (a) => {
      const existing = loadIdentity() || {};
      const member = {
        id: `${a.person}.${a.machine}.${a.agent}`.toLowerCase().replace(/\s+/g, "-"),
        person: a.person, machine: a.machine, agentKind: a.agent, role: a.role || "coder",
      };
      const id = { ...existing, member, hubUrl: process.env.AGENTSYNC_HUB || existing.hubUrl || "http://localhost:7777", token: process.env.AGENTSYNC_TOKEN || existing.token || "" };
      saveIdentity(id);
      client = null; // force reconnect with new identity
      const c = await hub();
      return text(`Registered as ${member.id} (${member.role}). You're on the roster. Now: get_plan → list_tasks → claim_task.`);
    },
  },
  get_plan: { description: "Get the current shared plan and its approval status. Do not code until a plan is approved.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => text((await hub()).state.plan || "No plan yet. Help the human draft one with set_plan.") },
  set_plan: { description: "Set/replace the shared plan text (list of tasks with file scopes).",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
    handler: async (a) => { (await hub()).setPlan(a.text); return text("Plan set (status: draft). Ask a human to approve_plan."); } },
  approve_plan: { description: "Mark the plan approved so work can begin.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => { (await hub()).approvePlan(); return text("Plan approved."); } },
  list_members: { description: "List team members and who is online.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => text((await hub()).state.members) },
  list_tasks: { description: "List all tasks with status, owner and file scope.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => text((await hub()).state.tasks) },
  add_task: { description: "Add a task with an explicit file scope (globs). Scope is what gets locked on claim.",
    inputSchema: { type: "object", required: ["title", "scope"], properties: {
      title: { type: "string" }, scope: { type: "array", items: { type: "string" }, description: "globs, e.g. [\"src/auth/**\"]" },
      role: { type: "string" }, dependsOn: { type: "array", items: { type: "string" } },
      id: { type: "string", description: "optional stable id; defaults to a slug of the title" } } },
    handler: async (a) => { const c = await hub();
      const task = { id: a.id || a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40), title: a.title, scope: a.scope, role: a.role, dependsOn: a.dependsOn || [] };
      c.addTask(task); return text(`Added task "${task.id}".`); } },
  claim_task: { description: "Claim a task — locks its file scope to you and warns of overlaps with other active claims. STOP and coordinate in chat if it warns.",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } },
    handler: async (a) => { const r = await (await hub()).claimTask(a.taskId);
      if (!r.ok) return text(`Could not claim: ${r.reason}`);
      if (r.overlaps?.length) return text({ claimed: true, WARNING: "file-scope overlap — coordinate before editing", overlaps: r.overlaps });
      return text({ claimed: true, taskId: a.taskId, overlaps: [] }); } },
  release_task: { description: "Release a claimed task back to the board.",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } },
    handler: async (a) => { (await hub()).releaseTask(a.taskId); return text("Released."); } },
  complete_task: { description: "Mark a task complete (e.g. after opening its PR).",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } },
    handler: async (a) => { (await hub()).completeTask(a.taskId); return text("Completed."); } },
  check_conflicts: { description: "Before pushing, check whether files you're about to push overlap another member's active claim.",
    inputSchema: { type: "object", required: ["files"], properties: { files: { type: "array", items: { type: "string" } } } },
    handler: async (a) => { const r = await (await hub()).checkConflicts(a.files);
      return text(r.overlaps?.length ? { safe: false, overlaps: r.overlaps } : { safe: true, overlaps: [] }); } },
  announce_edit: { description: "Announce to the team what you're about to push (files + summary). Posts to chat and checks overlaps.",
    inputSchema: { type: "object", required: ["files"], properties: { files: { type: "array", items: { type: "string" } }, summary: { type: "string" } } },
    handler: async (a) => { const r = await (await hub()).announceEdit(a.files, a.summary); return text({ announced: true, overlaps: r.overlaps || [] }); } },
  post_message: { description: "Send a message to the team chat (or to one member via `to`).",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" }, to: { type: "string" } } },
    handler: async (a) => { (await hub()).postMessage(a.text, a.to || null); return text("Sent."); } },
};

const server = new Server({ name: "agentsync", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const t = TOOLS[req.params.name];
  if (!t) return { content: [{ type: "text", text: "unknown tool" }], isError: true };
  try {
    return await t.handler(req.params.arguments || {});
  } catch (e) {
    return { content: [{ type: "text", text: "Error: " + e.message }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
