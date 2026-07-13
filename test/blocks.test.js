import assert from "node:assert/strict";
import test from "node:test";
import { clarificationBlocks } from "../src/blocks.js";

test("deadline clarification buttons share the stable Slack action ID", () => {
  const blocks = clarificationBlocks({
    id: "commitment-1",
    action: "circle back on the hiring plan",
    deadlinePhrase: "next week",
    deadlineOptions: [
      "2026-07-20T17:00:00.000Z",
      "2026-07-22T17:00:00.000Z",
      "2026-07-24T17:00:00.000Z",
    ],
  });
  const ids = blocks.find((block) => block.type === "actions").elements.map((element) => element.action_id);
  assert.deepEqual(ids, ["deadline_clarify", "deadline_clarify", "deadline_clarify"]);
  assert.equal(new Set(ids).size, ids.length);
});
