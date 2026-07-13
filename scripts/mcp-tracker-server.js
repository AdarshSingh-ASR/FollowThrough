#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as z from "zod/v4";

const trackerFile = resolve(process.env.MCP_TRACKER_FILE ?? "./data/mcp-tracker.json");
const server = new McpServer({ name: "followthrough-tracker", version: "1.0.0" });

server.registerTool("upsert_commitment", {
  description: "Create or update a FollowThrough commitment in an external tracker",
  inputSchema: {
    id: z.string(),
    action: z.string(),
    assigneeId: z.string(),
    promiseeIds: z.array(z.string()),
    dueAt: z.string(),
    status: z.string(),
    permalink: z.string(),
    updatedAt: z.string(),
  },
}, async (commitment) => {
  await mkdir(dirname(trackerFile), { recursive: true });
  let rows = [];
  try {
    rows = JSON.parse(await readFile(trackerFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const index = rows.findIndex((row) => row.id === commitment.id);
  if (index >= 0) rows[index] = commitment;
  else rows.push(commitment);
  await writeFile(trackerFile, JSON.stringify(rows, null, 2), "utf8");
  return {
    content: [{ type: "text", text: `Synced commitment ${commitment.id} (${commitment.status})` }],
    structuredContent: { id: commitment.id, status: commitment.status, synced: true },
  };
});

await server.connect(new StdioServerTransport());
console.error("FollowThrough MCP tracker is ready");
