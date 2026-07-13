import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ACTIVE_STATUSES = ["open", "pending", "overdue"];

export class CommitmentStore {
  constructor(filePath = "./data/commitments.json") {
    this.filePath = resolve(filePath);
    this.records = [];
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.records = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
    return this;
  }

  async create(input) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
      lastNudgedAt: null,
      escalatedAt: null,
      promiseeIds: [],
      ...input,
    };
    this.records.push(record);
    await this.persist();
    return record;
  }

  get(id) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  findBySource(channelId, sourceTs) {
    return this.records.find((record) => record.channelId === channelId && record.sourceTs === sourceTs) ?? null;
  }

  list({ assigneeId, promiseeId, statuses = ACTIVE_STATUSES } = {}) {
    return this.records
      .filter((record) => !assigneeId || record.assigneeId === assigneeId)
      .filter((record) => !promiseeId || (record.promiseeIds ?? []).includes(promiseeId))
      .filter((record) => statuses.includes(record.status))
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  }

  assigneeIds() {
    return [...new Set(this.records.map((record) => record.assigneeId).filter(Boolean))];
  }

  stats({ assigneeId, now = new Date(), days = 7 } = {}) {
    const start = new Date(now.getTime() - days * 24 * 60 * 60_000);
    const tomorrowStart = new Date(now);
    tomorrowStart.setHours(0, 0, 0, 0);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
    const scoped = this.records.filter((record) => !assigneeId || record.assigneeId === assigneeId);
    return {
      closed: scoped.filter((record) => record.status === "done" && new Date(record.completedAt ?? 0) >= start).length,
      overdue: scoped.filter((record) => ACTIVE_STATUSES.includes(record.status) && new Date(record.dueAt) < now).length,
      dueTomorrow: scoped.filter((record) => ACTIVE_STATUSES.includes(record.status) && new Date(record.dueAt) >= tomorrowStart && new Date(record.dueAt) < tomorrowEnd).length,
      open: scoped.filter((record) => ACTIVE_STATUSES.includes(record.status)).length,
    };
  }

  async update(id, patch) {
    const record = this.get(id);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    await this.persist();
    return record;
  }

  dueForNudge(now = new Date(), leadMinutes = 30, repeatHours = 4) {
    const threshold = new Date(now.getTime() + leadMinutes * 60_000);
    const cooldown = new Date(now.getTime() - repeatHours * 60 * 60_000);
    return this.records.filter((record) => {
      if (!["open", "overdue"].includes(record.status)) return false;
      if (record.deadlineNeedsClarification) return false;
      if (new Date(record.dueAt) > threshold) return false;
      return !record.lastNudgedAt || new Date(record.lastNudgedAt) < cooldown;
    });
  }

  async persist() {
    const snapshot = JSON.stringify(this.records, null, 2);
    this.writeQueue = this.writeQueue.then(() => writeFile(this.filePath, snapshot, "utf8"));
    return this.writeQueue;
  }
}
