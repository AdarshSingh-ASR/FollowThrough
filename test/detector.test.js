import test from "node:test";
import assert from "node:assert/strict";
import { detectCommitment } from "../src/detector.js";

const now = new Date("2026-07-13T10:00:00.000Z");
const base = { userId: "U123", channelId: "C123", messageTs: "123.456", now };

test("detects a first-person promise with a deadline", () => {
  const result = detectCommitment({ ...base, text: "I'll send the revised deck by Friday" });
  assert.ok(result);
  assert.equal(result.action, "send the revised deck");
  assert.equal(result.assigneeId, "U123");
  assert.equal(result.ownershipKind, "personal");
  assert.ok(new Date(result.dueAt) > now);
});

test("detects circle-back language", () => {
  const result = detectCommitment({ ...base, text: "Let's circle back next week" });
  assert.ok(result);
  assert.equal(result.action, "circle back");
  assert.equal(result.ownershipKind, "proposal");
  assert.equal(result.deadlineNeedsClarification, true);
  assert.equal(result.deadlineOptions.length, 3);
});

test("extracts the teammate a promise was made to", () => {
  const result = detectCommitment({ ...base, text: "I'll get <@U456> the numbers by Friday" });
  assert.ok(result);
  assert.deepEqual(result.promiseeIds, ["U456"]);
  assert.equal(result.action, "get the numbers");
});

test("uses the thread parent as promisee for direct you-language", () => {
  const result = detectCommitment({ ...base, parentUserId: "U789", text: "I'll send you the figures tomorrow" });
  assert.ok(result);
  assert.deepEqual(result.promiseeIds, ["U789"]);
});

test("ignores plans without a deadline", () => {
  assert.equal(detectCommitment({ ...base, text: "I'll send the revised deck" }), null);
});

test("ignores ordinary dated statements", () => {
  assert.equal(detectCommitment({ ...base, text: "The report was sent last Friday" }), null);
});
