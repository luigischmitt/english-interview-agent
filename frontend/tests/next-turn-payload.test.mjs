import assert from "node:assert/strict";
import test from "node:test";
import { serializeNextTurnRequest } from "../src/lib/interview/next-turn-payload.mjs";

test("next-turn serialization includes the approved direction and excludes the source description", () => {
  const direction = {
    targetRole: "Backend Engineer", suggestedSeniority: "mid-level", mainInterviewEmphasis: "Reliable API design",
    priorityCompetencies: ["comunicação interpessoal"], productTeamContext: "Equipe de pagamentos",
  };
  const serialized = serializeNextTurnRequest({
    config: {
      role: "Backend Engineer", seniority: "mid-level", focus: "technical-depth", jobDirection: direction,
      jobDescription: "PRIVATE_RAW_JOB_DESCRIPTION_SENTINEL",
    },
    currentQuestion: "What experience would help you in this role?", transcript: "I built APIs for payments.",
    nextFixedQuestion: "How would you keep an API reliable?", remainingFixedQuestions: ["How would you keep an API reliable?"],
    followUpUsed: false, askedQuestions: [],
  });
  const payload = JSON.parse(serialized);
  assert.deepEqual(payload.jobDirection, direction);
  assert.deepEqual(payload.roleContext, { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" });
  assert.equal(serialized.includes("PRIVATE_RAW_JOB_DESCRIPTION_SENTINEL"), false);
});

test("next-turn serialization bounds future questions and history while keeping the end of answers", () => {
  const answer = `${"old ".repeat(100)}LAST_ANSWER_DETAIL`;
  const payload = JSON.parse(serializeNextTurnRequest({
    config: { role: "Backend Engineer", seniority: "senior", focus: "technical-depth" },
    currentQuestion: "Current question?", transcript: "Current answer.", nextFixedQuestion: "Question 1?",
    remainingFixedQuestions: Array.from({ length: 8 }, (_, index) => `Question ${index + 1}?`),
    followUpUsed: false,
    askedQuestions: ["A".repeat(200), "Short question?"],
    previousAnswers: [
      { question: "Old 1?", answer: "Old 1." },
      { question: "Old 2?", answer: "Old 2." },
      { question: "Most recent?", answer },
    ],
  }));
  assert.deepEqual(payload.remainingFixedQuestions, ["Question 1?", "Question 2?", "Question 3?", "Question 4?"]);
  assert.equal(payload.askedQuestions[0].length, 160);
  assert.equal(payload.askedQuestions[1], "Short question?");
  assert.equal(payload.previousAnswers.length, 3);
  assert.equal(payload.previousAnswers.at(-1).answer.length, 300);
  assert.equal(payload.previousAnswers.at(-1).answer.endsWith("LAST_ANSWER_DETAIL"), true);
});

test("bounded previous-answer memory retains older themes through the last eight pairs", () => {
  const previousAnswers = Array.from({ length: 10 }, (_, index) => ({
    question: index === 2 ? "How did you handle the legacy migration?" : `Question ${index}?`,
    answer: index === 2 ? "I coordinated the old billing migration." : `Answer ${index}.`,
  }));
  const payload = JSON.parse(serializeNextTurnRequest({
    config: { role: "Backend Engineer", seniority: "senior", focus: "technical-depth" },
    currentQuestion: "Current?", transcript: "Current answer.", nextFixedQuestion: "Next?", remainingFixedQuestions: ["Next?"],
    followUpUsed: false, askedQuestions: [], previousAnswers,
  }));
  assert.equal(payload.previousAnswers.length, 8);
  assert.equal(payload.previousAnswers[0].question, "How did you handle the legacy migration?");
  assert.equal(payload.previousAnswers[0].answer, "I coordinated the old billing migration.");
  assert.equal(payload.previousAnswers.at(-1).question, "Question 9?");
});

test("resume next turns omit vacancy framing and the inferred role, seniority and focus", () => {
  const payload = JSON.parse(serializeNextTurnRequest({
    config: {
      role: "Backend Engineer", seniority: "senior", focus: "technical-depth", interviewSource: "resume",
      jobDirection: { targetRole: "Backend Engineer", suggestedSeniority: "senior", mainInterviewEmphasis: "Resume", priorityCompetencies: ["Resume"], productTeamContext: "Resume" },
    },
    currentQuestion: "What did you build?", transcript: "I built an API.", nextFixedQuestion: "How did you test it?",
    remainingFixedQuestions: ["How did you test it?"], followUpUsed: false, askedQuestions: [],
  }));
  assert.equal("jobDirection" in payload, false);
  assert.deepEqual(payload.roleContext, { targetRole: "the candidate's resume background" });
  assert.equal(JSON.stringify(payload).includes("Backend Engineer"), false);
});

import { DEFAULT_INTERVIEWER_VOICE, INTERVIEWER_VOICE_OPTIONS, resolveInterviewerVoice } from "../src/lib/interview/voices.mjs";

test("the next-turn request carries a selectable voice, defaulting to am_echo", () => {
  const input = { config: { role: "Backend Engineer", seniority: "mid-level", focus: "mixed" }, currentQuestion: "Q?", transcript: "A", nextFixedQuestion: null, remainingFixedQuestions: [], followUpUsed: false, askedQuestions: [] };
  assert.equal(JSON.parse(serializeNextTurnRequest(input)).voice, "am_echo");
  assert.equal(JSON.parse(serializeNextTurnRequest({ ...input, config: { ...input.config, voice: "bm_george" } })).voice, "bm_george");
  assert.equal(JSON.parse(serializeNextTurnRequest({ ...input, config: { ...input.config, voice: "af_bella+af_heart" } })).voice, "am_echo");
  assert.equal(DEFAULT_INTERVIEWER_VOICE, "am_echo");
  assert.equal(resolveInterviewerVoice("nope"), "am_echo");
  assert.equal(INTERVIEWER_VOICE_OPTIONS.length, 20);
});

import { fetchSpeechBlob } from "../src/lib/interview/speech-playback.mjs";

test("speech requests carry the chosen voice only when one is given", async () => {
  const bodies = [];
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(new Blob(["x"]), { status: 200 }); };
  await fetchSpeechBlob("Okay.", { endpoint: "/s1", fetcher, voice: "bm_lewis" });
  await fetchSpeechBlob("Okay.", { endpoint: "/s2", fetcher });
  assert.deepEqual(bodies, [{ text: "Okay.", voice: "bm_lewis" }, { text: "Okay." }]);
});
