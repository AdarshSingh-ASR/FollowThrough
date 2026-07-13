import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class McpCommitmentSync {
  constructor(env = process.env) {
    this.env = env;
    this.client = null;
    this.transport = null;
    this.connecting = null;
  }

  get enabled() {
    return this.env.MCP_DISABLED !== "true";
  }

  async connect() {
    if (!this.enabled) return null;
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = this.#connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async #connect() {
    const client = new Client({ name: "followthrough", version: "1.0.0" });
    if (this.env.MCP_SERVER_URL) {
      const headers = this.env.MCP_AUTH_TOKEN ? { Authorization: `Bearer ${this.env.MCP_AUTH_TOKEN}` } : undefined;
      this.transport = new StreamableHTTPClientTransport(new URL(this.env.MCP_SERVER_URL), { requestInit: { headers } });
    } else {
      const args = this.env.MCP_ARGS
        ? JSON.parse(this.env.MCP_ARGS)
        : ["scripts/mcp-tracker-server.js"];
      this.transport = new StdioClientTransport({
        command: this.env.MCP_COMMAND ?? process.execPath,
        args,
        cwd: process.cwd(),
        stderr: "inherit",
      });
    }
    await client.connect(this.transport);
    this.client = client;
    return client;
  }

  async sync(record) {
    if (!this.enabled) return { skipped: true };
    const client = await this.connect();
    return client.callTool({
      name: this.env.MCP_TOOL_NAME ?? "upsert_commitment",
      arguments: {
        id: record.id,
        action: record.action,
        assigneeId: record.assigneeId,
        promiseeIds: record.promiseeIds ?? [],
        dueAt: record.dueAt,
        status: record.status,
        permalink: record.permalink ?? "",
        updatedAt: record.updatedAt,
      },
    });
  }

  async close() {
    await this.transport?.close();
    this.client = null;
    this.transport = null;
  }
}
