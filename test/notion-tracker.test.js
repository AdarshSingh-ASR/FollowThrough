import assert from "node:assert/strict";
import test from "node:test";
import { NotionCommitmentTracker, buildNotionProperties } from "../src/notion-tracker.js";

const commitment = {
  id: "commitment-1",
  action: "Send the launch deck",
  assigneeId: "U123",
  promiseeIds: ["U456"],
  dueAt: "2026-07-14T09:30:00.000Z",
  status: "open",
  permalink: "https://example.slack.com/archives/C1/p1",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

test("buildNotionProperties maps a commitment to the documented Notion schema", () => {
  const properties = buildNotionProperties(commitment);
  assert.equal(properties.Commitment.title[0].text.content, "Send the launch deck");
  assert.equal(properties["FollowThrough ID"].rich_text[0].text.content, "commitment-1");
  assert.equal(properties.Status.select.name, "open");
  assert.equal(properties.Deadline.date.start, "2026-07-14T09:30:00.000Z");
});

test("Notion tracker creates a page when the commitment is new", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    const payload = url.endsWith("/query")
      ? { results: [] }
      : { id: "page-1", url: "https://notion.so/page-1" };
    return { ok: true, status: 200, json: async () => payload };
  };
  const tracker = new NotionCommitmentTracker({
    NOTION_TOKEN: "secret_test",
    NOTION_DATA_SOURCE_ID: "source-1",
  }, request);
  const result = await tracker.upsert(commitment);
  assert.equal(result.operation, "created");
  assert.equal(calls[1].url, "https://api.notion.com/v1/pages");
  assert.equal(JSON.parse(calls[1].options.body).parent.data_source_id, "source-1");
});

test("Notion tracker updates a page when the commitment already exists", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    const payload = url.endsWith("/query")
      ? { results: [{ id: "page-1" }] }
      : { id: "page-1", url: "https://notion.so/page-1" };
    return { ok: true, status: 200, json: async () => payload };
  };
  const tracker = new NotionCommitmentTracker({
    NOTION_TOKEN: "secret_test",
    NOTION_DATA_SOURCE_ID: "source-1",
  }, request);
  const result = await tracker.upsert(commitment);
  assert.equal(result.operation, "updated");
  assert.equal(calls[1].url, "https://api.notion.com/v1/pages/page-1");
  assert.equal(calls[1].options.method, "PATCH");
});
