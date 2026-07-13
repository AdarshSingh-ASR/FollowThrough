import test from "node:test";
import assert from "node:assert/strict";
import { createCommitmentDetector, normalizeGeminiCommitment, shouldAnalyze } from "../src/gemini-detector.js";

const input = {
  text: "You'll have the draft tomorrow, <@U456>.",
  userId: "U123",
  parentUserId: "U456",
  parentText: "Can you prepare the launch draft?",
  channelId: "C123",
  messageTs: "123.456",
  now: new Date("2026-07-13T10:00:00.000Z"),
};

test("Gemini normalization produces a validated structured commitment", () => {
  const result = normalizeGeminiCommitment({
    isCommitment: true,
    action: "prepare and deliver the launch draft",
    dueAt: "2026-07-14T17:00:00.000Z",
    deadlineText: "tomorrow",
    deadlineNeedsClarification: false,
    promiseeIds: ["U456", "INVENTED"],
    ownershipKind: "implicit",
    confidence: 0.91,
    evidence: "The speaker promised the recipient would have the draft tomorrow.",
  }, input, { allowedPromiseeIds: ["U456"] });

  assert.equal(result.extractionMethod, "gemini");
  assert.equal(result.action, "prepare and deliver the launch draft");
  assert.deepEqual(result.promiseeIds, ["U456"]);
  assert.equal(result.deadlineNeedsClarification, false);
});

test("Gemini detector uses structured model output instead of fixed examples", async () => {
  const client = {
    interactions: {
      create: async ({ input: prompt }) => {
        assert.match(prompt, /You'll have the draft tomorrow/);
        return { output_text: JSON.stringify({
          isCommitment: true,
          action: "deliver the draft",
          dueAt: "2026-07-14T17:00:00.000Z",
          deadlineText: "tomorrow",
          deadlineNeedsClarification: false,
          promiseeIds: ["U456"],
          ownershipKind: "implicit",
          confidence: 0.9,
          evidence: "Future delivery language.",
        }) };
      },
    },
  };
  const detect = createCommitmentDetector({ client, analyzeAll: true });
  const result = await detect(input);
  assert.equal(result.extractionMethod, "gemini");
  assert.equal(result.action, "deliver the draft");
});

test("privacy prefilter recognizes implicit commitment language", () => {
  assert.equal(shouldAnalyze("Leave the customer follow-up with me"), true);
  assert.equal(shouldAnalyze("The report was sent last Friday"), false);
});

test("detector uses Groq structured output when Gemini fails", async () => {
  const client = {
    interactions: {
      create: async () => { throw new Error("Gemini quota exceeded"); },
    },
  };
  const groqRequest = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, "openai/gpt-oss-20b");
    assert.equal(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.strict, true);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          isCommitment: true,
          action: "deliver the draft",
          dueAt: "2026-07-14T17:00:00.000Z",
          deadlineText: "tomorrow",
          deadlineNeedsClarification: false,
          promiseeIds: ["U456"],
          ownershipKind: "implicit",
          confidence: 0.88,
          evidence: "Future delivery language.",
        }) } }],
      }),
    };
  };
  const detect = createCommitmentDetector({
    client,
    groqApiKey: "gsk_test",
    groqRequest,
    analyzeAll: true,
  });
  const result = await detect(input);
  assert.equal(result.extractionMethod, "groq");
  assert.equal(result.extractionModel, "openai/gpt-oss-20b");
});

test("detector uses safe rules when Gemini and Groq both fail", async () => {
  const client = {
    interactions: {
      create: async () => { throw new Error("Gemini unavailable"); },
    },
  };
  const groqRequest = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: "Groq unavailable" } }),
  });
  const detect = createCommitmentDetector({
    client,
    groqApiKey: "gsk_test",
    groqRequest,
    analyzeAll: true,
  });
  const result = await detect({
    ...input,
    text: "I'll send <@U456> the launch draft tomorrow.",
  });
  assert.equal(result.extractionMethod, "rules-fallback");
  assert.match(result.extractionEvidence, /Safe deterministic fallback/);
});
