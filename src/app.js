import "dotenv/config";
import bolt from "@slack/bolt";
import { CommitmentStore } from "./store.js";
import { createCommitmentDetector } from "./gemini-detector.js";
import {
  clarificationBlocks,
  confirmationBlocks,
  dashboardBlocks,
  digestBlocks,
  escalationBlocks,
  nudgeBlocks,
  pulseText,
  rtsResultsBlocks,
  trackedBlocks,
} from "./blocks.js";
import { fetchThreadContext, searchRtsContext } from "./context.js";
import { McpCommitmentSync } from "./mcp-sync.js";

const { App } = bolt;
const required = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env.`);
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

const store = await new CommitmentStore(process.env.DATA_FILE).init();
const mcpSync = new McpCommitmentSync();
const extractCommitment = createCommitmentDetector();
let lastDigestKey = null;

app.message(async ({ message: event, client, context, logger }) => {
  if (!event.text || event.bot_id || event.subtype) return;

  if (event.channel_type === "im") {
    await handleAgentMessage({ event, client, logger });
    return;
  }
  if (store.findBySource(event.channel, event.ts)) return;

  let parentUserId;
  let parentText;
  if (event.thread_ts) {
    try {
      const replies = await client.conversations.replies({ channel: event.channel, ts: event.thread_ts, limit: 1 });
      parentUserId = replies.messages?.[0]?.user;
      parentText = replies.messages?.[0]?.text;
    } catch (error) {
      logger.warn(`Could not resolve thread parent: ${error.data?.error ?? error.message}`);
    }
  }

  const detected = await extractCommitment({
    text: event.text,
    userId: event.user,
    parentUserId,
    parentText,
    channelId: event.channel,
    messageTs: event.ts,
  });
  if (!detected) return;

  try {
    const permalinkResult = await client.chat.getPermalink({ channel: event.channel, message_ts: event.ts });
    const record = await store.create({
      ...detected,
      teamId: context.teamId,
      threadTs: event.thread_ts ?? event.ts,
      permalink: permalinkResult.permalink,
    });
    const blocks = record.deadlineNeedsClarification ? clarificationBlocks(record) : confirmationBlocks(record);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: record.deadlineNeedsClarification ? "Which deadline should I use?" : `Commitment spotted: ${record.action}`,
      blocks,
    });
  } catch (error) {
    logger.error("Failed to capture commitment", error);
  }
});

app.action(/^deadline_clarify_\d+$/, async ({ ack, action, body, client }) => {
  await ack();
  const { id, dueAt } = JSON.parse(action.value);
  const record = await store.update(id, {
    dueAt,
    deadlineNeedsClarification: false,
    deadlineOptions: [],
    clarifiedAt: new Date().toISOString(),
  });
  if (!record) return;
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `Commitment spotted: ${record.action}`,
    blocks: confirmationBlocks(record),
  });
});

app.action("commitment_track", async ({ ack, action, body, client }) => {
  await ack();
  const record = await store.update(action.value, { status: "open", confirmedAt: new Date().toISOString() });
  if (!record) return;
  await syncExternal(record);
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `Tracked: ${record.action}`,
    blocks: trackedBlocks(record),
  });
});

app.action("commitment_ignore", async ({ ack, action, body, client }) => {
  await ack();
  const record = await store.update(action.value, { status: "ignored" });
  if (!record) return;
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: "Not tracked.",
    blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: "👌 Got it—this was not tracked." }] }],
  });
});

app.action("commitment_done", async ({ ack, action, body, client }) => {
  await ack();
  const record = await store.update(action.value, { status: "done", completedAt: new Date().toISOString() });
  if (!record) return;
  await syncExternal(record);
  if (body.channel?.id && body.message?.ts) {
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `Completed: ${record.action}`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅ *Closed the loop:* ${record.action}` } }],
    });
  }
  await refreshHome(client, body.user.id);
});

app.action("commitment_snooze", async ({ ack, action, body, client }) => {
  await ack();
  const current = store.get(action.value);
  if (!current) return;
  const due = new Date(Math.max(Date.now(), new Date(current.dueAt).getTime()) + 24 * 60 * 60_000);
  const record = await store.update(action.value, {
    status: "open",
    dueAt: due.toISOString(),
    lastNudgedAt: null,
    escalatedAt: null,
  });
  await syncExternal(record);
  if (body.channel?.id && body.message?.ts) {
    await client.chat.update({ channel: body.channel.id, ts: body.message.ts, text: `Snoozed: ${record.action}`, blocks: trackedBlocks(record) });
  }
  await refreshHome(client, body.user.id);
});

app.event("app_home_opened", async ({ event, client }) => {
  if (event.tab === "home") await refreshHome(client, event.user);
});

app.event("app_context_changed", async () => {});

app.command("/followthrough", async ({ ack, command, respond }) => {
  await ack();
  const mode = command.text.trim().toLowerCase();
  if (mode === "digest") {
    const stats = store.stats({ assigneeId: command.user_id });
    await respond({ response_type: "ephemeral", text: "Your weekly follow-through", blocks: digestBlocks(stats) });
    return;
  }
  if (mode === "help") {
    await respond({ response_type: "ephemeral", text: "Use `/followthrough mine`, `/followthrough team`, or `/followthrough digest`. In Messages, ask `context: launch deck` for live RTS results." });
    return;
  }
  const showTeam = mode === "team";
  const records = store.list(showTeam ? {} : { assigneeId: command.user_id });
  await respond({
    response_type: "ephemeral",
    text: pulseText(records),
    blocks: dashboardBlocks(records, { title: showTeam ? "Team commitments" : "Your commitments" }),
  });
});

app.event("app_mention", async ({ event, client, say, logger }) => {
  const query = extractRtsQuery(event.text);
  if (query) {
    await respondWithRts({ client, event, query, say, logger });
    return;
  }
  const records = store.list({ assigneeId: event.user });
  await say({ thread_ts: event.thread_ts ?? event.ts, text: pulseText(records), blocks: dashboardBlocks(records) });
});

async function handleAgentMessage({ event, client, logger }) {
  const query = extractRtsQuery(event.text);
  if (query) {
    await respondWithRts({
      client,
      event,
      query,
      logger,
      say: (message) => client.chat.postMessage({ channel: event.channel, thread_ts: event.thread_ts ?? event.ts, ...message }),
    });
    return;
  }
  if (/\bdigest\b/i.test(event.text)) {
    const stats = store.stats({ assigneeId: event.user });
    await client.chat.postMessage({ channel: event.channel, thread_ts: event.thread_ts ?? event.ts, text: "Your weekly follow-through", blocks: digestBlocks(stats) });
    return;
  }
  const wantsTeam = /\b(team|everyone|all)\b/i.test(event.text);
  const records = store.list(wantsTeam ? {} : { assigneeId: event.user });
  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: pulseText(records),
    blocks: dashboardBlocks(records, { title: wantsTeam ? "Team commitments" : "Your commitments" }),
  });
}

async function respondWithRts({ client, event, query, say, logger }) {
  try {
    const results = await searchRtsContext(client, { query, actionToken: event.action_token });
    await say({ text: `Live Slack context for: ${query}`, blocks: rtsResultsBlocks(results) });
  } catch (error) {
    logger.warn(`RTS lookup failed: ${error.data?.error ?? error.message}`);
    const reason = error.data?.error === "missing_scope"
      ? "Real-time Search needs the `search:read.public` scope. Update the manifest and reinstall the app."
      : error.message;
    await say({ text: `I couldn't run Real-time Search: ${reason}` });
  }
}

async function refreshHome(client, userId) {
  await client.views.publish({
    user_id: userId,
    view: {
      type: "home",
      blocks: [
        ...digestBlocks(store.stats({ assigneeId: userId })),
        { type: "divider" },
        ...dashboardBlocks(store.list({ assigneeId: userId })),
      ],
    },
  });
}

async function runNudges() {
  const now = new Date();
  const leadMinutes = Number(process.env.NUDGE_LEAD_MINUTES ?? 30);
  const repeatHours = Number(process.env.NUDGE_REPEAT_HOURS ?? 4);
  const escalationDays = Number(process.env.ESCALATION_AFTER_DAYS ?? 0);
  for (const record of store.dueForNudge(now, leadMinutes, repeatHours)) {
    try {
      const due = new Date(record.dueAt);
      const overdue = due < now;
      const daysOverdue = overdue ? Math.max(1, Math.floor((now - due) / 86_400_000)) : 0;
      const level = escalationDays > 0 && daysOverdue >= escalationDays ? "escalated" : overdue ? "overdue" : "due";
      const contextSnippet = await fetchThreadContext(app.client, record);

      await sendDm(record.assigneeId, {
        text: overdue ? `Follow-through check: ${record.action}` : `Due soon: ${record.action}`,
        blocks: nudgeBlocks(record, { contextSnippet, level }),
      });

      for (const promiseeId of record.promiseeIds ?? []) {
        await sendDm(promiseeId, {
          text: `Private follow-through context: ${record.action}`,
          blocks: nudgeBlocks(record, { contextSnippet, level, promiseeView: true }),
        });
      }

      const patch = { status: overdue ? "overdue" : "open", lastNudgedAt: now.toISOString() };
      if (level === "escalated" && shouldEscalate(record, now, repeatHours)) {
        await runEscalation(record, daysOverdue);
        patch.escalatedAt = now.toISOString();
      }
      const updated = await store.update(record.id, patch);
      await syncExternal(updated);
    } catch (error) {
      console.error(`Failed to nudge ${record.id}`, error.data?.error ?? error);
    }
  }
}

async function runEscalation(record, daysOverdue) {
  const blocks = escalationBlocks(record, daysOverdue);
  if (process.env.ESCALATION_MANAGER_USER_ID) {
    await sendDm(process.env.ESCALATION_MANAGER_USER_ID, { text: `Opt-in escalation: ${record.action}`, blocks });
  }
  if (process.env.ALLOW_PUBLIC_ESCALATION === "true" && process.env.ESCALATION_CHANNEL_ID) {
    await app.client.chat.postMessage({ channel: process.env.ESCALATION_CHANNEL_ID, text: `Opt-in escalation: ${record.action}`, blocks });
  }
}

async function runWeeklyDigest() {
  const now = new Date();
  const day = Number(process.env.DIGEST_DAY ?? 1);
  const hour = Number(process.env.DIGEST_HOUR ?? 9);
  if (now.getDay() !== day || now.getHours() !== hour) return;
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (lastDigestKey === key) return;
  lastDigestKey = key;

  for (const userId of store.assigneeIds()) {
    await sendDm(userId, { text: "Your weekly follow-through", blocks: digestBlocks(store.stats({ assigneeId: userId })) });
  }
  if (process.env.ALLOW_CHANNEL_DIGEST === "true" && process.env.DIGEST_CHANNEL_ID) {
    await app.client.chat.postMessage({
      channel: process.env.DIGEST_CHANNEL_ID,
      text: "Weekly team follow-through",
      blocks: digestBlocks(store.stats(), { title: "Weekly team follow-through" }),
    });
  }
}

async function sendDm(userId, message) {
  const dm = await app.client.conversations.open({ users: userId });
  return app.client.chat.postMessage({ channel: dm.channel.id, ...message });
}

async function syncExternal(record) {
  try {
    await mcpSync.sync(record);
  } catch (error) {
    console.error(`MCP sync failed for ${record?.id}:`, error.message);
  }
}

function shouldEscalate(record, now, repeatHours) {
  return !record.escalatedAt || new Date(record.escalatedAt) < new Date(now.getTime() - repeatHours * 60 * 60_000);
}

function extractRtsQuery(text) {
  const match = text?.match(/(?:^|\s)(?:context|search|find)(?:\s+(?:for|about))?\s*:\?\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

const port = Number(process.env.PORT ?? 3000);
await app.start(port);
console.log(`⚡ FollowThrough is running on port ${port}`);
console.log(process.env.GEMINI_API_KEY
  ? `🧠 Gemini extraction enabled (${process.env.GEMINI_MODEL ?? "gemini-3.5-flash"})`
  : "⚠️ Gemini is not configured");
console.log(process.env.GROQ_API_KEY
  ? `⚡ Groq AI fallback enabled (${process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"})`
  : "⚠️ Groq is not configured; safe rules remain the final fallback");

const interval = setInterval(async () => {
  await runNudges();
  await runWeeklyDigest();
}, Number(process.env.NUDGE_INTERVAL_MS ?? 60_000));
interval.unref();
await runNudges();
await runWeeklyDigest();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    clearInterval(interval);
    await mcpSync.close();
    await app.stop();
    process.exit(0);
  });
}
