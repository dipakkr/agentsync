#!/usr/bin/env node
// agentsync CLI — one binary for the hub host, humans joining, and the git hooks.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { networkInterfaces } from "node:os";
import { parse as parseYaml } from "yaml";
import { startHub } from "../hub/server.js";
import { HubClient } from "../lib/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "../..");
const CWD = process.cwd();
const IDENTITY_PATH = join(CWD, ".agentsync", "identity.json");
const CONFIG_PATH = join(CWD, "agentsync.config.yaml");

const args = process.argv.slice(2);
const cmd = args[0];
function flag(name, def) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? (args[i + 1]?.startsWith("--") ? true : args[i + 1]) : def;
}
const c = { reset: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", cy: "\x1b[36m" };
const say = (s) => console.log(s);

function loadIdentity() { return existsSync(IDENTITY_PATH) ? JSON.parse(readFileSync(IDENTITY_PATH, "utf8")) : null; }
function saveIdentity(id) { mkdirSync(join(CWD, ".agentsync"), { recursive: true }); writeFileSync(IDENTITY_PATH, JSON.stringify(id, null, 2)); }
function loadConfig() { return existsSync(CONFIG_PATH) ? parseYaml(readFileSync(CONFIG_PATH, "utf8")) : {}; }

// ---- commands ---------------------------------------------------------------

async function cmdHub() {
  const port = Number(flag("port", process.env.PORT || 7777));
  const token = flag("token", process.env.AGENTSYNC_TOKEN || "");
  // Persist the event log under AGENTSYNC_DATA (point it at a mounted volume on a
  // deployed hub) so chat/tasks/plan survive a redeploy; default to the local repo.
  const dir = process.env.AGENTSYNC_DATA || join(CWD, ".agentsync");
  const logPath = flag("log", join(dir, "events.ndjson"));
  startHub({ port, token, logPath });
  const lan = lanIP();
  say(`\n  ${c.b}${c.cy}⚡ AgentSync hub is live${c.reset}\n`);
  say(`  Dashboard   ${c.g}http://localhost:${port}${c.reset}${lan ? `  ·  http://${lan}:${port}` : ""}`);
  say(`  Hub URL     ${c.g}http://${lan || "localhost"}:${port}${c.reset}`);
  say(`  Token       ${token ? c.y + token + c.reset : c.dim + "(none — open)" + c.reset}`);
  say(`  Event log   ${c.g}${logPath}${c.reset}${process.env.AGENTSYNC_DATA ? "" : `${c.dim}  (ephemeral — set AGENTSYNC_DATA to a mounted volume to persist)${c.reset}`}`);
  say(`\n  Teammates join with:`);
  say(`    ${c.dim}npx agentsync join http://${lan || "localhost"}:${port}${token ? " --token " + token : ""}${c.reset}\n`);
  process.on("SIGINT", () => process.exit(0));
}

// Shared onboarding: figure out who this agent is, then write identity + MCP config +
// hooks, and ping the hub so they appear on the roster. Reused by `join` and `up`.
async function setupMember(url, token) {
  const cfg = loadConfig();
  const interactive = !flag("name") && process.stdin.isTTY;
  let person = flag("name"), machine = flag("machine"), agent = flag("agent", "human"), role = flag("role", "coder");
  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    say(`\n  ${c.b}Who are you?${c.reset} ${c.dim}(this becomes your id: <name>.<machine>.<agent>)${c.reset}`);
    person = person || (await rl.question("  Your name         > ")).trim();
    machine = machine || (await rl.question("  This machine label> ")).trim();
    agent = (await rl.question("  Agent (human/claude/codex/kimi) [human] > ")).trim() || "human";
    role = (await rl.question(`  Role (${(cfg.roles || []).map((r) => r.name).join("/") || "coder"}) [coder] > `)).trim() || "coder";
    rl.close();
  }
  if (!person || !machine) return fail("Need at least --name and --machine.");
  const member = { id: `${person}.${machine}.${agent}`.toLowerCase().replace(/\s+/g, "-"), person, machine, agentKind: agent, role };
  saveIdentity({ member, hubUrl: url, token });
  writeMcpConfig(url, token, agent);
  installHooks();
  writeAgentContext(); // ensure AGENTS.md + CLAUDE.md pointer exist locally even if the repo never committed them
  try { const cl = new HubClient({ url, token, member }); await cl.connect(); await cl.register(); cl.postMessage(`👋 ${member.id} joined`); setTimeout(() => cl.close(), 400); } catch {}
  return member;
}

function printInvite(url, token) {
  const cmd = `npx github:dipakkr/agentsync join ${url}${token ? ` --token ${token}` : ""} --name YOU --machine THIS --agent claude`;
  // A paste-ready brief, not a bare command: the teammate drops this whole block into
  // their coding agent and it self-onboards — no human needed to explain what AgentSync is.
  const brief = [
    `You're joining an AgentSync-coordinated repo — a shared hub that keeps humans and AI`,
    `coding agents aware of who is editing what, so parallel agents never collide on the same`,
    `files. Onboard yourself now:`,
    ``,
    `1. Run this in the repo root (replace YOU / THIS with your name and this machine's label):`,
    `   ${cmd}`,
    `2. It writes .mcp.json (the AgentSync tools), git hooks, your identity, and AGENTS.md, then`,
    `   puts you on the dashboard: ${url}`,
    `   Then RESTART this agent session — the AgentSync MCP tools only load at startup.`,
    `3. Read AGENTS.md in the repo root — those are your rules of engagement.`,
    `4. Before writing code: get_plan (don't code until a plan is approved) -> claim_task (locks`,
    `   your file scope, warns on overlap). While working: read_messages to hear teammates and`,
    `   post_message to keep them posted; check_conflicts before you push. Push to your OWN`,
    `   branch, never main.`,
  ].join("\n");
  say(`\n  ${c.b}Invite teammates${c.reset} — paste this whole block to a teammate; they paste it into their coding agent:`);
  say(`  ${c.dim}${"─".repeat(74)}${c.reset}`);
  say(brief);
  say(`  ${c.dim}${"─".repeat(74)}${c.reset}`);
}

async function cmdJoin() {
  const url = args[1] && !args[1].startsWith("--") ? args[1] : (loadConfig().hub_url || "");
  if (!url) return fail("Usage: agentsync join <hub-url> [--name … --machine … --agent … --role …]");
  const token = flag("token", loadConfig().token || "");
  const member = await setupMember(url, token);
  say(`\n  ${c.g}✓ Joined as ${c.b}${member.id}${c.reset}${c.g} (${member.role})${c.reset}`);
  say(`  ${c.dim}identity → .agentsync/identity.json  ·  dashboard → ${url}${c.reset}`);
  say(`  ${c.dim}Your agent can now use the agentsync MCP tools. Start it and say hi.${c.reset}`);
}

// One command to go from a fresh clone to fully live: init the repo, bring up (or point at)
// a hub, set yourself up, open the dashboard, and print the invite line.
async function cmdUp() {
  if (!existsSync(CONFIG_PATH)) ensureProjectFiles(flag("hub", ""));
  const cfg = loadConfig();
  let token = flag("token", process.env.AGENTSYNC_TOKEN || cfg.token || "");
  let hubUrl = flag("hub", cfg.hub_url || "");
  const remote = hubUrl && !/(localhost|127\.0\.0\.1)/.test(hubUrl);
  const port = Number(flag("port", 7777));
  let localHub = null;

  if (!remote) {
    if (!token) token = randomBytes(6).toString("hex");
    const lan = lanIP();
    hubUrl = `http://${lan || "localhost"}:${port}`;
    const dir = process.env.AGENTSYNC_DATA || join(CWD, ".agentsync");
    localHub = startHub({ port, token, logPath: join(dir, "events.ndjson") });
    say(`\n  ${c.b}${c.cy}⚡ Hub started${c.reset} on ${c.g}${hubUrl}${c.reset} ${c.dim}(token ${token})${c.reset}`);
  } else {
    say(`\n  ${c.b}Using hub${c.reset} ${c.g}${hubUrl}${c.reset}`);
  }

  const member = await setupMember(hubUrl, token);
  say(`  ${c.g}✓ You're live as ${c.b}${member.id}${c.reset}`);

  const dash = localHub ? `http://localhost:${port}` : hubUrl;
  if (args.includes("--no-open")) say(`  ${c.dim}dashboard → ${dash}${c.reset}`);
  else try { execSync(`open "${dash}"`, { stdio: "ignore" }); say(`  ${c.dim}opened dashboard → ${dash}${c.reset}`); }
  catch { say(`  ${c.dim}dashboard → ${dash}${c.reset}`); }

  printInvite(hubUrl, token);

  if (localHub) {
    say(`\n  ${c.dim}Hub is running here — keep this terminal open. Ctrl-C to stop.${c.reset}\n`);
    process.on("SIGINT", () => process.exit(0));
  } else process.exit(0);
}

function cmdInvite() {
  const id = loadIdentity(), cfg = loadConfig();
  const url = flag("hub", id?.hubUrl || cfg.hub_url || "");
  const token = flag("token", id?.token || cfg.token || "");
  if (!url) return fail("No hub yet. Run `agentsync up` (local) or `agentsync join <url>` first.");
  printInvite(url, token);
  say("");
}

function writeMcpConfig(url, token, agent) {
  const mcpEntry = { command: "node", args: [join(PKG_ROOT, "src", "mcp", "server.js")], env: { AGENTSYNC_HUB: url, AGENTSYNC_TOKEN: token } };
  // Claude Code / generic: project-level .mcp.json
  const mj = join(CWD, ".mcp.json");
  const cur = existsSync(mj) ? JSON.parse(readFileSync(mj, "utf8")) : {};
  cur.mcpServers = { ...(cur.mcpServers || {}), agentsync: mcpEntry };
  writeFileSync(mj, JSON.stringify(cur, null, 2));
  say(`  ${c.dim}wrote .mcp.json (agentsync MCP server)${c.reset}`);
  if (agent === "codex") {
    say(`  ${c.y}Codex:${c.reset} add this to ~/.codex/config.toml:`);
    say(`    ${c.dim}[mcp_servers.agentsync]\n    command = "node"\n    args = ["${mcpEntry.args[0]}"]\n    env = { AGENTSYNC_HUB = "${url}", AGENTSYNC_TOKEN = "${token}" }${c.reset}`);
  }
}

function installHooks() {
  let gitDir;
  try { gitDir = execSync("git rev-parse --git-dir", { cwd: CWD, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return say(`  ${c.dim}(no git repo — skipped hook install)${c.reset}`); }
  const hooksDir = join(CWD, gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  for (const h of ["pre-push", "pre-commit"]) {
    const dest = join(hooksDir, h);
    copyFileSync(join(PKG_ROOT, "hooks", h), dest);
    chmodSync(dest, 0o755);
  }
  say(`  ${c.dim}installed git hooks (pre-push announce, pre-commit guard)${c.reset}`);
}

async function cmdAnnounce() {
  const id = loadIdentity(); if (!id) return; // advisory — never block a push
  const branch = loadConfig().git?.protected_branch || "main";
  let files = [];
  try { files = execSync(`git diff --name-only origin/${branch}...HEAD`, { cwd: CWD, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n").filter(Boolean); } catch {}
  if (!files.length) return;
  try {
    const cl = new HubClient({ url: id.hubUrl, token: id.token, member: id.member });
    await cl.connect(); await cl.register();
    const r = await cl.announceEdit(files, `${files.length} files on ${current(branch)}`);
    if (r.overlaps?.length) {
      say(`\n  ${c.y}⚠ AgentSync: your push overlaps active work:${c.reset}`);
      for (const o of r.overlaps) say(`    ${o.owner} — ${o.files.join(", ")}`);
      say(`  ${c.dim}Coordinate in the chat before merging.${c.reset}\n`);
    } else say(`  ${c.g}✓ AgentSync: no overlap with active claims.${c.reset}`);
    cl.close();
  } catch { /* hub down → silent, never block */ }
}

function cmdGuardCommit() {
  const cfg = loadConfig();
  const protectedGlobs = cfg.protected_paths || [".env", "**/*.key", "**/secrets.*"];
  let staged = [];
  try { staged = execSync("git diff --cached --name-only", { cwd: CWD, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n").filter(Boolean); } catch {}
  const bad = staged.filter((f) => protectedGlobs.some((g) => globMatch(g, f)));
  if (bad.length) {
    say(`\n  ${c.y}✗ AgentSync blocked this commit — protected paths staged:${c.reset}`);
    for (const f of bad) say(`    ${f}`);
    say(`  ${c.dim}Unstage them (git restore --staged <file>) or edit protected_paths in agentsync.config.yaml.${c.reset}\n`);
    process.exit(1);
  }
}

async function cmdStatus() {
  const id = loadIdentity(); const url = args[1] || id?.hubUrl;
  if (!url) return fail("No hub. Pass a url or join first.");
  const res = await fetch(url.replace(/\/$/, "") + "/state");
  const s = await res.json();
  say(`\n  ${c.b}Members${c.reset}`);
  for (const m of s.members) say(`    ${m.online ? c.g + "●" : c.dim + "○"}${c.reset} ${m.id} ${c.dim}(${m.role || "?"})${c.reset}`);
  say(`\n  ${c.b}Tasks${c.reset}`);
  for (const t of s.tasks) say(`    [${t.status}] ${t.title} ${c.dim}${t.owner || ""} ${(t.scope || []).join(" ")}${c.reset}`);
  say(`\n  ${c.b}Plan${c.reset}: ${s.plan ? s.plan.status : "none"}\n`);
}

function cmdWhoami() { const id = loadIdentity(); say(id ? JSON.stringify(id.member, null, 2) : "Not joined. Run: agentsync join <url>"); }

// Drop the agent context into a repo: AGENTS.md (the usage guide) + a CLAUDE.md pointer.
// Idempotent. Called by init/up AND by join — so a teammate who joins always has the
// context locally even if the repo never committed AGENTS.md (it is often gitignored).
function writeAgentContext() {
  let wrote = [], skipped = [];
  const guide = readFileSync(join(PKG_ROOT, "templates", "AGENTS.md"), "utf8");
  const agentsPath = join(CWD, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, guide); wrote.push("AGENTS.md");
  } else {
    const cur = readFileSync(agentsPath, "utf8");
    if (cur.includes("agentsync:begin")) skipped.push("AGENTS.md (already has AgentSync section)");
    else { writeFileSync(agentsPath, cur.trimEnd() + "\n\n" + guide); wrote.push("AGENTS.md (appended)"); }
  }
  // Claude Code auto-loads CLAUDE.md; keep the guide in AGENTS.md and point at it from there.
  const claudePath = join(CWD, "CLAUDE.md");
  const pointer = "See [AGENTS.md](./AGENTS.md) for how to work in this repo through AgentSync.";
  if (!existsSync(claudePath)) { writeFileSync(claudePath, pointer + "\n"); wrote.push("CLAUDE.md"); }
  else if (!readFileSync(claudePath, "utf8").includes("AGENTS.md")) {
    writeFileSync(claudePath, readFileSync(claudePath, "utf8").trimEnd() + "\n\n" + pointer + "\n"); wrote.push("CLAUDE.md (appended)");
  } else skipped.push("CLAUDE.md");
  return { wrote, skipped };
}

// Make ANY project repo AgentSync-aware: drop in the config + the agent usage guide
// (so coding agents that open this repo know how to use the tool) + gitignore.
// Returns {wrote, skipped, project}; used by both `init` (prints) and `up` (silent).
function ensureProjectFiles(hub) {
  const project = flag("project", basename(CWD));
  let wrote = [], skipped = [];

  // 1) agentsync.config.yaml
  if (!existsSync(CONFIG_PATH)) {
    const tpl = readFileSync(join(PKG_ROOT, "templates", "agentsync.config.yaml"), "utf8")
      .replace("__PROJECT__", project).replace("__HUB__", hub);
    writeFileSync(CONFIG_PATH, tpl); wrote.push("agentsync.config.yaml");
  } else skipped.push("agentsync.config.yaml");

  // 2) + 3) AGENTS.md + CLAUDE.md pointer — the "how to use this tool" context so any
  // coding agent that opens this repo knows what AgentSync is and what to do.
  const ctx = writeAgentContext();
  wrote.push(...ctx.wrote); skipped.push(...ctx.skipped);

  // 4) gitignore .agentsync/
  const giPath = join(CWD, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  if (!gi.split("\n").some((l) => l.trim() === ".agentsync/")) {
    writeFileSync(giPath, (gi ? gi.trimEnd() + "\n" : "") + ".agentsync/\n"); wrote.push(".gitignore (+.agentsync/)");
  }
  return { wrote, skipped, project };
}

function cmdInit() {
  const hub = flag("hub", "");
  const { wrote, skipped, project } = ensureProjectFiles(hub);
  say(`\n  ${c.g}✓ AgentSync initialized in ${c.b}${project}${c.reset}`);
  if (wrote.length) say(`  ${c.dim}created: ${wrote.join(", ")}${c.reset}`);
  if (skipped.length) say(`  ${c.dim}kept:    ${skipped.join(", ")}${c.reset}`);
  say(`\n  Next:`);
  say(`    1. ${c.cy}commit these files${c.reset} so the whole team shares the same setup`);
  say(`    2. each teammate: ${c.cy}agentsync join ${hub || "<hub-url>"} --token <t> --name <you> --machine <m> --agent <claude|codex>${c.reset}`);
  say(`    3. open your coding agent here — it reads AGENTS.md and connects itself\n`);
}

// ---- helpers ----------------------------------------------------------------
function current(fallback) { try { return execSync("git branch --show-current", { cwd: CWD }).toString().trim() || fallback; } catch { return fallback; } }
function lanIP() {
  return Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
}
function globMatch(glob, file) {
  const re = "^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§").replace(/\*/g, "[^/]*").replace(/§/g, ".*").replace(/\?/g, "[^/]") + "$";
  return new RegExp(re).test(file);
}
function fail(msg) { console.error(msg); process.exit(1); }

const HELP = `agentsync — coordination hub for teams of humans + AI coding agents

  agentsync up [--hub <url>] [--token …]      ⭐ one command: init + hub + join + dashboard + invite
  agentsync invite                             print the one-line command teammates paste to join
  agentsync init [--hub <url>]                make THIS repo AgentSync-aware (config + AGENTS.md context)
  agentsync hub [--port 7777] [--token …]     start the hub + dashboard
  agentsync join <url> [--token …]            join from a clone (onboarding, MCP config, hooks)
  agentsync status [url]                       print roster / tasks / plan
  agentsync whoami                             show your identity
  agentsync mcp                                run the MCP server (used by agents)
  agentsync announce | guard-commit           internal (git hooks)`;

const table = {
  up: cmdUp, invite: cmdInvite, init: cmdInit, hub: cmdHub, join: cmdJoin,
  announce: cmdAnnounce, "guard-commit": cmdGuardCommit,
  status: cmdStatus, whoami: cmdWhoami,
  mcp: async () => { await import("../mcp/server.js"); },
};
if (!cmd || cmd === "help" || cmd === "--help") say(HELP);
else if (table[cmd]) await table[cmd]();
else fail(`Unknown command: ${cmd}\n\n${HELP}`);
