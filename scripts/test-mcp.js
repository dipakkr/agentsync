// Smoke-test the MCP server: spawn it, list tools, register, claim a task through MCP.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const transport = new StdioClientTransport({
  command: "node",
  args: [join(root, "src", "mcp", "server.js")],
  env: { ...process.env, AGENTSYNC_HUB: "http://localhost:7799" },
});
const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const reg = await client.callTool({ name: "agentsync_register", arguments: { person: "tester", machine: "ci", agent: "claude", role: "backend" } });
console.log("register:", reg.content[0].text.split("\n")[0]);

const tasks = await client.callTool({ name: "list_tasks", arguments: {} });
console.log("list_tasks ok, count:", JSON.parse(tasks.content[0].text).length);

const post = await client.callTool({ name: "post_message", arguments: { text: "hello from MCP test" } });
console.log("post_message:", post.content[0].text);

await client.close();
process.exit(0);
