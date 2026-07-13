#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { NotionCommitmentTracker } from "../src/notion-tracker.js";

const tracker = new NotionCommitmentTracker();
const server = new McpServer({ name: "followthrough-notion-tracker", version: "1.0.0" });

server.registerTool("upsert_commitment", {
  description: "Create or update a FollowThrough commitment in a Notion data source",
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
  const result = await tracker.upsert(commitment);
  return {
    content: [{
      type: "text",
      text: `${result.operation === "created" ? "Created" : "Updated"} Notion commitment ${commitment.id}: ${result.url}`,
    }],
    structuredContent: {
      id: commitment.id,
      status: commitment.status,
      synced: true,
      notionPageId: result.pageId,
      notionUrl: result.url,
    },
  };
});

await server.connect(new StdioServerTransport());
console.error("FollowThrough Notion MCP tracker is ready");
