import * as chrono from "chrono-node";

const OWNERSHIP_PATTERNS = [
  { pattern: /\b(?:i(?:'|’)ll|i will|i can|i promise(?: to)?|i commit to)\s+(.+)/i, confidence: 0.94, kind: "personal" },
  { pattern: /\b(?:we(?:'|’)ll|we will)\s+(.+)/i, confidence: 0.84, kind: "team" },
  { pattern: /\b(?:let(?:'|’)s)\s+(.+)/i, confidence: 0.76, kind: "proposal" },
];

const ACTION_VERBS = /\b(send|share|finish|complete|deliver|get|review|update|prepare|draft|publish|fix|ship|follow up|circle back|schedule|book|confirm|check|create|write|upload|submit|provide|email|call|reply|investigate|resolve|return)\b/i;
const FUZZY_DEADLINE = /\b(next week|this week|later|soon|sometime|end of (?:the )?week)\b/i;

export function detectCommitment({ text, userId, channelId, messageTs, parentUserId, now = new Date() }) {
  if (!text || !userId || !channelId || !messageTs) return null;

  const promiseeIds = extractPromisees(text, userId, parentUserId);
  const normalized = text.replace(/<@[^>]+>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const ownership = OWNERSHIP_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  if (!ownership || !ACTION_VERBS.test(normalized)) return null;

  const parsedDates = chrono.parse(normalized, now, { forwardDate: true });
  if (parsedDates.length === 0) return null;

  const bestDate = parsedDates[parsedDates.length - 1];
  const dueAt = bestDate.start.date();
  if (!bestDate.start.isCertain("hour")) dueAt.setHours(17, 0, 0, 0);

  const match = normalized.match(ownership.pattern);
  const action = cleanAction(match?.[1] ?? normalized, bestDate.text);
  if (action.length < 4) return null;

  const deadlineNeedsClarification = FUZZY_DEADLINE.test(bestDate.text) || FUZZY_DEADLINE.test(normalized);

  return {
    action,
    assigneeId: userId,
    promiseeIds,
    channelId,
    sourceTs: messageTs,
    dueAt: dueAt.toISOString(),
    deadlinePhrase: bestDate.text,
    deadlineNeedsClarification,
    deadlineOptions: deadlineNeedsClarification ? buildDeadlineOptions(now) : [],
    confidence: ownership.confidence,
    ownershipKind: ownership.kind,
  };
}

function extractPromisees(text, userId, parentUserId) {
  const explicit = [...text.matchAll(/<@([A-Z0-9]+)>/gi)].map((match) => match[1]);
  const ids = new Set(explicit.filter((id) => id !== userId));
  if (/\b(?:get|send|share|give|email|tell|show)\s+you\b/i.test(text) && parentUserId && parentUserId !== userId) {
    ids.add(parentUserId);
  }
  return [...ids];
}

export function buildDeadlineOptions(now) {
  const monday = new Date(now);
  const daysUntilMonday = ((8 - monday.getDay()) % 7) || 7;
  monday.setDate(monday.getDate() + daysUntilMonday);
  monday.setHours(17, 0, 0, 0);
  return [0, 2, 4].map((offset) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    return date.toISOString();
  });
}

function cleanAction(candidate, dateText) {
  const escapedDate = dateText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return candidate
    .replace(new RegExp(`\\s*(?:by|before|on|at)?\\s*${escapedDate}.*$`, "i"), "")
    .replace(/[.!?,;:\s]+$/g, "")
    .trim();
}

export function parseSnooze(value, now = new Date()) {
  const result = chrono.parseDate(value, now, { forwardDate: true });
  return result?.toISOString() ?? null;
}
