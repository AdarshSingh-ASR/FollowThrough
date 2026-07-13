import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommitmentStore } from "../src/store.js";

test("weekly stats separate closed, overdue, and due-tomorrow commitments", async () => {
  const file = join(tmpdir(), `followthrough-${Date.now()}.json`);
  const store = await new CommitmentStore(file).init();
  const now = new Date("2026-07-13T10:00:00.000Z");
  await store.create({ assigneeId: "U1", action: "closed", dueAt: now.toISOString(), status: "done", completedAt: now.toISOString() });
  await store.create({ assigneeId: "U1", action: "late", dueAt: "2026-07-12T10:00:00.000Z", status: "overdue" });
  await store.create({ assigneeId: "U1", action: "tomorrow", dueAt: "2026-07-14T10:00:00.000Z", status: "open" });
  assert.deepEqual(store.stats({ assigneeId: "U1", now }), { closed: 1, overdue: 1, dueTomorrow: 1, open: 2 });
  await rm(file, { force: true });
});

test("ambiguous deadlines cannot trigger nudges before clarification", async () => {
  const file = join(tmpdir(), `followthrough-${Date.now()}-fuzzy.json`);
  const store = await new CommitmentStore(file).init();
  await store.create({ assigneeId: "U1", action: "circle back", dueAt: new Date().toISOString(), status: "open", deadlineNeedsClarification: true });
  assert.equal(store.dueForNudge(new Date(), 30).length, 0);
  await rm(file, { force: true });
});
