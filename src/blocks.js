const dateLabel = (iso) => new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(iso));

export function clarificationBlocks(record) {
  const options = (record.deadlineOptions ?? []).slice(0, 3);
  return [
    { type: "header", text: { type: "plain_text", text: "📅 One quick clarification", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `I heard *“${escapeMrkdwn(record.deadlinePhrase)}”* for _${escapeMrkdwn(record.action)}_. Which day should I use?`,
      },
    },
    {
      type: "actions",
      elements: options.map((dueAt, index) => button(
        new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(new Date(dueAt)),
        "deadline_clarify",
        JSON.stringify({ id: record.id, dueAt }),
      )),
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "I ask once instead of silently guessing a fuzzy deadline." }] },
  ];
}

export function confirmationBlocks(record) {
  const promisee = promiseeText(record);
  const detectorLabel = record.extractionMethod === "gemini"
    ? `Gemini ${record.extractionModel ?? "structured extraction"}`
    : record.extractionMethod === "groq"
      ? `Groq ${record.extractionModel ?? "structured extraction"}`
      : "Safe rules fallback";
  const evidence = record.extractionEvidence ? ` • ${escapeMrkdwn(record.extractionEvidence)}` : "";
  return [
    { type: "header", text: { type: "plain_text", text: "🎯 Commitment spotted", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Who*\n<@${record.assigneeId}>` },
        { type: "mrkdwn", text: `*Deadline*\n${dateLabel(record.dueAt)}` },
        { type: "mrkdwn", text: `*What*\n${escapeMrkdwn(record.action)}` },
        { type: "mrkdwn", text: `*Promised to*\n${promisee}` },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `${detectorLabel} • Confidence ${Math.round(record.confidence * 100)}%${evidence}\nNothing is tracked until a person confirms it.` }] },
    {
      type: "actions",
      elements: [
        button("Track it", "commitment_track", record.id, "primary"),
        button("Not a commitment", "commitment_ignore", record.id),
      ],
    },
  ];
}

export function trackedBlocks(record) {
  const promisee = (record.promiseeIds ?? []).length ? ` for ${promiseeText(record)}` : "";
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `✅ *Tracked:* <@${record.assigneeId}> will ${escapeMrkdwn(record.action)}${promisee} by *${dateLabel(record.dueAt)}*.` },
    },
    {
      type: "actions",
      elements: [button("Mark done", "commitment_done", record.id, "primary"), button("Snooze 1 day", "commitment_snooze", record.id)],
    },
  ];
}

export function nudgeBlocks(record, { contextSnippet, level = "due", promiseeView = false } = {}) {
  const contextLink = record.permalink ? ` • <${record.permalink}|Open original thread>` : "";
  const headings = {
    due: "👋 Friendly follow-through",
    overdue: "⏰ Still on your radar?",
    escalated: "🧭 Time to reset the plan",
  };
  const intro = promiseeView
    ? `<@${record.assigneeId}> committed to *${escapeMrkdwn(record.action)}*. You’re included privately because the promise was made to you.`
    : level === "escalated"
      ? `This is still open: *${escapeMrkdwn(record.action)}*. If the plan changed, snooze it and choose a realistic next step.`
      : `A quick reminder about your commitment to *${escapeMrkdwn(record.action)}*.`;
  const blocks = [
    { type: "header", text: { type: "plain_text", text: headings[level], emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `${intro}\n*Due:* ${dateLabel(record.dueAt)}${contextLink}` } },
  ];
  if (contextSnippet) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Live context from the source thread*\n>${escapeMrkdwn(contextSnippet)}` } });
  }
  if (!promiseeView) {
    blocks.push({
      type: "actions",
      elements: [button("Done", "commitment_done", record.id, "primary"), button("Snooze 1 day", "commitment_snooze", record.id)],
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: promiseeView ? "Private context only—no channel broadcast." : "A private memory aid, not a performance score." }],
  });
  return blocks;
}

export function escalationBlocks(record, daysOverdue) {
  return [
    { type: "header", text: { type: "plain_text", text: "🧭 Opt-in follow-through assist", emoji: true } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `<@${record.assigneeId}> has an open commitment that is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue:\n*${escapeMrkdwn(record.action)}*` },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "This private escalation was explicitly enabled by workspace configuration." }] },
  ];
}

export function dashboardBlocks(records, { title = "Your commitments" } = {}) {
  const open = records.filter((record) => ["open", "overdue", "pending"].includes(record.status));
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🎯 ${title}`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `${open.length} active • Human-confirmed • Private nudges` }] },
    { type: "divider" },
  ];

  if (open.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Nothing is hanging.* Enjoy the clean slate. ✨" } });
    return blocks;
  }

  for (const record of open.slice(0, 20)) {
    const overdue = new Date(record.dueAt) < new Date();
    const promisee = (record.promiseeIds ?? []).length ? ` • for ${promiseeText(record)}` : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${overdue ? "🔴" : "🟢"} *${escapeMrkdwn(record.action)}*\n<@${record.assigneeId}>${promisee} • ${dateLabel(record.dueAt)} • ${record.status}`,
      },
      accessory: button("Done", "commitment_done", record.id, "primary"),
    });
  }
  return blocks;
}

export function digestBlocks(stats, { title = "Your weekly follow-through" } = {}) {
  return [
    { type: "header", text: { type: "plain_text", text: `📊 ${title}`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*✅ Closed*\n${stats.closed}` },
        { type: "mrkdwn", text: `*🔴 Overdue*\n${stats.overdue}` },
        { type: "mrkdwn", text: `*🟡 Due tomorrow*\n${stats.dueTomorrow}` },
        { type: "mrkdwn", text: `*🎯 Open*\n${stats.open}` },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "A private reflection on commitments—not a leaderboard." }] },
  ];
}

export function rtsResultsBlocks(results) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "🔎 Live Slack context", emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: "Retrieved just now with Slack Real-time Search; results are not stored." }] },
  ];
  for (const result of results.slice(0, 5)) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${escapeMrkdwn(truncate(result.content ?? result.text ?? "", 500))}\n${result.permalink ? `<${result.permalink}|Open source>` : ""}` },
    });
  }
  if (results.length === 0) blocks.push({ type: "section", text: { type: "mrkdwn", text: "No matching Slack context found." } });
  return blocks;
}

export function pulseText(records) {
  if (records.length === 0) return "Nothing is hanging. Your accountability slate is clear. ✨";
  const overdue = records.filter((record) => new Date(record.dueAt) < new Date()).length;
  const next = records[0];
  return `*Accountability pulse:* ${records.length} open, ${overdue} overdue.\nNext: <@${next.assigneeId}> — ${escapeMrkdwn(next.action)} by ${dateLabel(next.dueAt)}.`;
}

function promiseeText(record) {
  const ids = record.promiseeIds ?? [];
  return ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "Just themselves";
}

function button(text, actionId, value, style) {
  return {
    type: "button",
    text: { type: "plain_text", text, emoji: true },
    action_id: actionId,
    value,
    ...(style ? { style } : {}),
  };
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function escapeMrkdwn(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
