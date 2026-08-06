#!/usr/bin/env node
// agentsync CLI — one binary for the hub host, humans joining, and the git hooks.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
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
  const logPath = flag("log", join(CWD, ".agentsync", "events.ndjson"));
  startHub({ port, token, logPath });
  const lan = lanIP();
  say(`\n  ${c.b}${c.cy}⚡ AgentSync hub is live${c.reset}\n`);
  say(`  Dashboard   ${c.g}http://localhost:${port}${c.reset}${lan ? `  ·  http://${lan}:${port}` : ""}`);
  say(`  Hub URL     ${c.g}http://${lan || "localhost"}:${port}${c.reset}`);
  say(`  Token       ${token ? c.y + token + c.reset : c.dim + "(none — open)" + c.reset}`);
  say(`\n  Teammates join with:`);
  say(`    ${c.dim}npx agentsync join http://${lan || "localhost"}:${port}${token ? " --token " + token : ""}${c.reset}\n`);
  process.on("SIGINT", () => process.exit(0));
}

async function cmdJoin() {
  const url = args[1] && !args[1].startsWith("--") ? args[1] : (loadConfig().hub_url || "");
  if (!url) return fail("Usage: agentsync join <hub-url> [--name … --machine … --agent … --role …]");
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
  const token = flag("token", cfg.token || "");
  saveIdentity({ member, hubUrl: url, token });

  writeMcpConfig(url, token, agent);
  installHooks();

  say(`\n  ${c.g}✓ Joined as ${c.b}${member.id}${c.reset}${c.g} (${role})${c.reset}`);
  say(`  ${c.dim}identity → .agentsync/identity.json${c.reset}`);
  say(`  ${c.dim}dashboard → ${url}${c.reset}`);
  say(`\n  Your ${agent} agent can now use the agentsync MCP tools. Start it and say hi in the chat.\n`);
  // quick presence ping so they show up immediately
  try { const cl = new HubClient({ url, token, member }); await cl.connect(); await cl.register(); cl.postMessage(`👋 ${member.id} joined`); setTimeout(() => cl.close(), 400); } catch {}
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

// Make ANY project repo AgentSync-aware: drop in the config + the agent usage guide
// (so coding agents that open this repo know how to use the tool) + gitignore + hooks.
function cmdInit() {
  const hub = flag("hub", "");
  const project = flag("project", basename(CWD));
  let wrote = [], skipped = [];

  // 1) agentsync.config.yaml
  if (!existsSync(CONFIG_PATH)) {
    const tpl = readFileSync(join(PKG_ROOT, "templates", "agentsync.config.yaml"), "utf8")
      .replace("__PROJECT__", project).replace("__HUB__", hub);
    writeFileSync(CONFIG_PATH, tpl); wrote.push("agentsync.config.yaml");
  } else skipped.push("agentsync.config.yaml");

  // 2) AGENTS.md — the "how to use this tool" context for any agent in this repo
  const guide = readFileSync(join(PKG_ROOT, "templates", "AGENTS.md"), "utf8");
  const agentsPath = join(CWD, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, guide); wrote.push("AGENTS.md");
  } else {
    const cur = readFileSync(agentsPath, "utf8");
    if (cur.includes("agentsync:begin")) skipped.push("AGENTS.md (already has AgentSync section)");
    else { writeFileSync(agentsPath, cur.trimEnd() + "\n\n" + guide); wrote.push("AGENTS.md (appended)"); }
  }

  // 3) CLAUDE.md pointer (Claude Code reads CLAUDE.md; keep the guide in AGENTS.md)
  const claudePath = join(CWD, "CLAUDE.md");
  const pointer = "See [AGENTS.md](./AGENTS.md) for how to work in this repo through AgentSync.";
  if (!existsSync(claudePath)) { writeFileSync(claudePath, pointer + "\n"); wrote.push("CLAUDE.md"); }
  else if (!readFileSync(claudePath, "utf8").includes("AGENTS.md")) {
    writeFileSync(claudePath, readFileSync(claudePath, "utf8").trimEnd() + "\n\n" + pointer + "\n"); wrote.push("CLAUDE.md (appended)");
  } else skipped.push("CLAUDE.md");

  // 4) gitignore .agentsync/
  const giPath = join(CWD, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  if (!gi.split("\n").some((l) => l.trim() === ".agentsync/")) {
    writeFileSync(giPath, (gi ? gi.trimEnd() + "\n" : "") + ".agentsync/\n"); wrote.push(".gitignore (+.agentsync/)");
  }

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

  agentsync init [--hub <url>]                make THIS repo AgentSync-aware (config + AGENTS.md context)
  agentsync hub [--port 7777] [--token …]     start the hub + dashboard
  agentsync join <url> [--token …]            join from a clone (onboarding, MCP config, hooks)
  agentsync status [url]                       print roster / tasks / plan
  agentsync whoami                             show your identity
  agentsync mcp                                run the MCP server (used by agents)
  agentsync announce | guard-commit           internal (git hooks)`;

const table = {
  init: cmdInit, hub: cmdHub, join: cmdJoin, announce: cmdAnnounce, "guard-commit": cmdGuardCommit,
  status: cmdStatus, whoami: cmdWhoami,
  mcp: async () => { await import("../mcp/server.js"); },
};
if (!cmd || cmd === "help" || cmd === "--help") say(HELP);
else if (table[cmd]) await table[cmd]();
else fail(`Unknown command: ${cmd}\n\n${HELP}`);
