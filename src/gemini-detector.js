import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { buildDeadlineOptions, detectCommitment as detectWithRules } from "./detector.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEFAULT_GROQ_TIMEOUT_MS = 15_000;
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const CANDIDATE_SIGNAL = /\b(i(?:'|’)ll|i will|i can|i promise|i commit|i(?:'|’)ve got|we(?:'|’)ll|we will|let(?:'|’)s|leave .+ with me|you(?:'|’)ll have|consider it done|on me|take care of|handle that|circle back|follow up|by (?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)|before (?:the )?meeting|next week|end of (?:the )?week)\b/i;

const commitmentJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    isCommitment: { type: "boolean", description: "True only when the speaker accepts future responsibility for a concrete action." },
    action: { type: "string", description: "A concise verb phrase describing exactly what will be done, with pronouns resolved from provided context." },
    dueAt: { type: ["string", "null"], format: "date-time", description: "Resolved ISO 8601 deadline, or null when no defensible deadline exists." },
    deadlineText: { type: "string", description: "The deadline phrase from the message, or an empty string if none was stated." },
    deadlineNeedsClarification: { type: "boolean", description: "True for missing or ambiguous deadlines such as next week without a day." },
    promiseeIds: { type: "array", items: { type: "string" }, description: "Only IDs from the provided allowed promisee list. Never invent an ID." },
    ownershipKind: { type: "string", enum: ["personal", "team", "proposal", "implicit"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "string", description: "A short user-visible explanation of what language signaled the commitment. No hidden reasoning." },
  },
  required: ["isCommitment", "action", "dueAt", "deadlineText", "deadlineNeedsClarification", "promiseeIds", "ownershipKind", "confidence", "evidence"],
};

const commitmentSchema = z.object({
  isCommitment: z.boolean(),
  action: z.string(),
  dueAt: z.string().nullable(),
  deadlineText: z.string(),
  deadlineNeedsClarification: z.boolean(),
  promiseeIds: z.array(z.string()),
  ownershipKind: z.enum(["personal", "team", "proposal", "implicit"]),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

export function createCommitmentDetector({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
  vertexProject = process.env.VERTEX_AI_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
  vertexLocation = process.env.VERTEX_AI_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
  vertexServiceAccountJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_VERTEX_CREDENTIALS,
  groqApiKey = process.env.GROQ_API_KEY,
  groqModel = process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
  groqRequest = fetch,
  groqTimeoutMs = Number(process.env.GROQ_TIMEOUT_MS ?? DEFAULT_GROQ_TIMEOUT_MS),
  analyzeAll = process.env.GEMINI_ANALYZE_ALL === "true",
  client,
} = {}) {
  const vertexAuth = parseVertexCredentials(vertexServiceAccountJson);
  const resolvedVertexProject = vertexProject ?? vertexAuth?.project_id;
  const gemini = client ?? (resolvedVertexProject
    ? new GoogleGenAI({
      vertexai: true,
      project: resolvedVertexProject,
      location: vertexLocation,
      apiVersion: "v1",
      ...(vertexAuth ? { googleAuthOptions: { credentials: vertexAuth } } : {}),
    })
    : (apiKey ? new GoogleGenAI({ apiKey }) : null));
  const geminiProvider = resolvedVertexProject ? "vertex" : "gemini";

  return async function detect(input) {
    if (!analyzeAll && !shouldAnalyze(input.text)) return null;

    const allowedPromiseeIds = allowedPromisees(input);
    const failures = [];
    if (gemini) {
      try {
        const parsed = await extractWithGemini(gemini, { input, model, allowedPromiseeIds });
        return normalizeGeminiCommitment(parsed, input, { model, allowedPromiseeIds, provider: geminiProvider });
      } catch (error) {
        failures.push(`Gemini: ${error.message}`);
        console.warn(`Gemini extraction failed; trying Groq: ${error.message}`);
      }
    } else {
      failures.push("Vertex AI project or Gemini API key is not configured");
    }

    if (groqApiKey) {
      try {
        const parsed = await extractWithGroq({
          apiKey: groqApiKey,
          model: groqModel,
          request: groqRequest,
          timeoutMs: groqTimeoutMs,
          input,
          allowedPromiseeIds,
        });
        return normalizeGeminiCommitment(parsed, input, { model: groqModel, allowedPromiseeIds, provider: "groq" });
      } catch (error) {
        failures.push(`Groq: ${error.message}`);
        console.warn(`Groq extraction failed; using safe rules fallback: ${error.message}`);
      }
    } else {
      failures.push("Groq API key is not configured");
    }

    return rulesFallback(input, failures.join("; "));
  };
}

function parseVertexCredentials(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    } catch {
      throw new Error("Vertex service-account credentials must be JSON or base64-encoded JSON");
    }
  }
}

async function extractWithGemini(gemini, { input, model, allowedPromiseeIds }) {
  const interaction = await gemini.interactions.create({
    model,
    input: buildPrompt(input, allowedPromiseeIds),
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: commitmentJsonSchema,
    },
  });
  return commitmentSchema.parse(JSON.parse(interaction.output_text));
}

export async function extractWithGroq({ apiKey, model = DEFAULT_GROQ_MODEL, request = fetch, timeoutMs = DEFAULT_GROQ_TIMEOUT_MS, input, allowedPromiseeIds = allowedPromisees(input) }) {
  const response = await request(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Extract Slack commitments. Return only the JSON object required by the supplied schema." },
        { role: "user", content: buildPrompt(input, allowedPromiseeIds) },
      ],
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "followthrough_commitment",
          strict: true,
          schema: groqCommitmentSchema(),
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${payload.error?.message ?? "Groq request failed"}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no structured content");
  return commitmentSchema.parse(JSON.parse(content));
}

export function normalizeGeminiCommitment(result, input, { model = DEFAULT_MODEL, allowedPromiseeIds = allowedPromisees(input), provider = "gemini" } = {}) {
  if (!result.isCommitment) return null;
  const action = result.action.replace(/\s+/g, " ").replace(/[.!?,;:\s]+$/g, "").trim();
  if (action.length < 4) return null;

  const parsedDue = result.dueAt ? new Date(result.dueAt) : null;
  const validDue = parsedDue && !Number.isNaN(parsedDue.getTime()) ? parsedDue : null;
  const needsClarification = result.deadlineNeedsClarification || !validDue;
  const deadlineOptions = needsClarification ? buildDeadlineOptions(input.now ?? new Date()) : [];
  const promiseeIds = [...new Set(result.promiseeIds)].filter((id) => allowedPromiseeIds.includes(id) && id !== input.userId);

  return {
    action,
    assigneeId: input.userId,
    promiseeIds,
    channelId: input.channelId,
    sourceTs: input.messageTs,
    dueAt: (validDue ?? new Date(deadlineOptions[0])).toISOString(),
    deadlinePhrase: result.deadlineText || "No deadline specified",
    deadlineNeedsClarification: needsClarification,
    deadlineOptions,
    confidence: result.confidence,
    ownershipKind: result.ownershipKind,
    extractionMethod: provider,
    extractionModel: model,
    extractionEvidence: result.evidence.slice(0, 240),
  };
}

export function shouldAnalyze(text = "") {
  return CANDIDATE_SIGNAL.test(text);
}

function rulesFallback(input, reason) {
  const result = detectWithRules(input);
  return result ? {
    ...result,
    extractionMethod: "rules-fallback",
    extractionModel: null,
    extractionEvidence: `Safe deterministic fallback used after AI providers were unavailable. ${reason}`.slice(0, 240),
  } : null;
}

function groqCommitmentSchema() {
  const schema = JSON.parse(JSON.stringify(commitmentJsonSchema));
  delete schema.properties.dueAt.format;
  return schema;
}

function allowedPromisees(input) {
  const mentions = [...(input.text ?? "").matchAll(/<@([A-Z0-9]+)>/gi)].map((match) => match[1]);
  if (input.parentUserId) mentions.push(input.parentUserId);
  return [...new Set(mentions.filter((id) => id !== input.userId))];
}

function buildPrompt(input, allowedPromiseeIds) {
  const now = input.now ?? new Date();
  const timeZone = process.env.TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `You are the structured commitment extractor for a privacy-first Slack accountability agent.

Classify only the newest message. A commitment exists when the speaker accepts responsibility for a future, concrete action. Detect explicit and implicit promises such as “I'll send it”, “you'll have it tomorrow”, “leave that with me”, or “consider it done”. Reject past-tense reports, questions, hypotheticals, vague aspirations, and assignments imposed on someone else.

Resolve relative dates using current time ${now.toISOString()} and timezone ${timeZone}. Mark deadlineNeedsClarification true when no deadline exists or a phrase such as “next week” does not identify a defensible day. Never invent a promisee ID; use only allowedPromiseeIds. When the message says “you” in a thread, the parent author is the likely promise recipient. Use the thread parent text only to resolve phrases like “it” or “that”.

Slack input:
${JSON.stringify({
    newestMessage: input.text,
    speakerId: input.userId,
    threadParentAuthorId: input.parentUserId ?? null,
    threadParentText: input.parentText ?? null,
    allowedPromiseeIds,
  }, null, 2)}`;
}
