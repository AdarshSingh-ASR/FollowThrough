export async function fetchThreadContext(client, record) {
  try {
    const response = await client.conversations.replies({
      channel: record.channelId,
      ts: record.threadTs ?? record.sourceTs,
      limit: 25,
      inclusive: true,
    });
    const messages = response.messages ?? [];
    const sourceIndex = Math.max(0, messages.findIndex((message) => message.ts === record.sourceTs));
    const aroundSource = messages.slice(Math.max(0, sourceIndex - 1), sourceIndex + 2);
    return aroundSource
      .filter((message) => message.text && !message.bot_id)
      .map((message) => message.text.replace(/\s+/g, " ").trim())
      .join(" — ")
      .slice(0, 700) || null;
  } catch (error) {
    console.warn(`Could not fetch live context for ${record.id}: ${error.data?.error ?? error.message}`);
    return null;
  }
}

export async function searchRtsContext(client, { query, actionToken }) {
  if (!actionToken) {
    const error = new Error("Slack did not include the short-lived action token required for Real-time Search. Ask in a DM to FollowThrough or mention it in a channel.");
    error.code = "missing_action_token";
    throw error;
  }
  const response = await client.apiCall("assistant.search.context", {
    action_token: actionToken,
    query,
    content_types: ["messages"],
    channel_types: ["public_channel"],
    include_context_messages: true,
    limit: 5,
  });
  return response.results?.messages ?? [];
}
