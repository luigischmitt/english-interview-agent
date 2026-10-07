import assert from "node:assert/strict";
import test from "node:test";
import { applyJobAnalysis, isValidJobDirection, jobDescriptionMaxLength, jobDescriptionMinLength, requestJobDirection, setupModeBlocksStart, switchSetupMode } from "../src/lib/interview/job-direction.mjs";
import { parseRoomHandoff, serializeRoomHandoff } from "../src/lib/interview/room-handoff.mjs";

const direction = {
  targetRole: "Senior Backend Engineer",
  suggestedSeniority: "senior",
  mainInterviewEmphasis: "Arquitetura de APIs e confiabilidade.",
  priorityCompetencies: ["Sistemas distribuídos", "Observabilidade"],
  productTeamContext: "Plataforma de logística B2B em uma equipe multidisciplinar.",
};
const generatedQuestions = Array.from({ length: 8 }, (_, index) => `How would you handle vacancy scenario number ${index + 1}?`);
const generatedDirection = { ...direction, tailoredQuestions: generatedQuestions };
const config = {
  role: direction.targetRole, seniority: direction.suggestedSeniority, focus: "technical-depth", duration: "15", questionCount: null,
  playInterviewerAudio: true, showQuestionCaptions: false, candidateCameraEnabled: false, autoCaptureVoice: true, jobDirection: direction,
};
const description = "We need a backend engineer to build APIs and distributed services, improve reliability, and collaborate with product on a logistics platform. ".repeat(2);

test("validates strict direction shape and bounded editable content", () => {
  assert.equal(isValidJobDirection(direction), true);
  assert.equal(isValidJobDirection({ ...direction, secretPrompt: "hidden" }), false);
  assert.equal(isValidJobDirection({ ...direction, priorityCompetencies: Array(6).fill("Skill") }), false);
  assert.equal(isValidJobDirection({ ...direction, productTeamContext: "x".repeat(281) }), false);
  assert.equal(isValidJobDirection({ ...direction, mainInterviewEmphasis: "What would you do?" }), false);
});

test("requests a bounded description and rejects question-like or extra response fields", async () => {
  let request;
  const result = await requestJobDirection(description, { targetRole: "", seniority: "mid-level" }, async (...args) => {
    request = args;
    return new Response(JSON.stringify(generatedDirection), { status: 200 });
  }, "https://backend.test/api/v1/thinking/job-direction");
  assert.deepEqual(result, generatedDirection);
  assert.equal(request[0], "https://backend.test/api/v1/thinking/job-direction");
  assert.equal(request[1].method, "POST");
  assert.equal(JSON.parse(request[1].body).jobDescription, description.trim());

  await assert.rejects(requestJobDirection("too short", { targetRole: "Engineer" }, async () => { throw new Error("should not run"); }), { code: "INVALID_INPUT" });
  await assert.rejects(requestJobDirection("x".repeat(jobDescriptionMaxLength + 1), { targetRole: "Engineer" }, async () => new Response()), { code: "INVALID_INPUT" });
  await assert.rejects(requestJobDirection(description, { targetRole: "Engineer" }, async () => new Response(JSON.stringify({ ...direction, questions: ["Why?"] }), { status: 200 })), { code: "INVALID_RESPONSE" });
  await assert.rejects(requestJobDirection(description, { targetRole: "Engineer" }, async () => new Response(JSON.stringify({ error: { code: "JOB_DIRECTION_TIMEOUT", message: "private detail" } }), { status: 504 })), { code: "JOB_DIRECTION_TIMEOUT", status: 504 });
  assert.ok(jobDescriptionMinLength >= 100);
});

test("handoff includes only the approved direction and drops it when role or seniority diverges", () => {
  const handoff = parseRoomHandoff(serializeRoomHandoff({ ...config, jobDescription: description, pastedDescription: description }, 1), 2);
  assert.equal(handoff.jobDirection.targetRole, config.role);
  assert.equal(handoff.jobDirection.suggestedSeniority, config.seniority);
  assert.equal(JSON.stringify(handoff).includes(description), false);
  assert.equal(parseRoomHandoff(serializeRoomHandoff({ ...config, role: "Different role" }, 1), 2).jobDirection, undefined);
  assert.equal(parseRoomHandoff(serializeRoomHandoff({ ...config, seniority: "staff" }, 1), 2).jobDirection, undefined);
});

test("handoff preserves a validated resume source without carrying the PDF", () => {
  const tailoredQuestions = ["How did you design the main service in your Atlas project?"];
  const resumeConfig = { ...config, interviewSource: "resume", jobDirection: { ...direction, tailoredQuestions }, resumeFile: "private.pdf" };
  const serialized = serializeRoomHandoff(resumeConfig, 1_000);
  const parsed = parseRoomHandoff(serialized, 1_000);
  assert.equal(parsed.interviewSource, "resume");
  assert.deepEqual(parsed.jobDirection.tailoredQuestions, tailoredQuestions);
  assert.equal("resumeFile" in parsed, false);
});

test("keeps the practice focus out of the snapshot and tolerates older backends without it", async () => {
  const withFocus = await requestJobDirection(description, { targetRole: "" }, async () => new Response(JSON.stringify({ ...generatedDirection, suggestedFocus: "behavioral" }), { status: 200 }));
  assert.equal(withFocus.suggestedFocus, "behavioral");
  const applied = applyJobAnalysis({ ...config, jobDirection: undefined }, withFocus);
  assert.equal(applied.focus, "behavioral");
  assert.equal(applied.role, direction.targetRole);
  assert.equal(applied.seniority, "senior");
  assert.equal("suggestedFocus" in applied.jobDirection, false);
  assert.equal(isValidJobDirection(applied.jobDirection), true);

  const legacy = await requestJobDirection(description, { targetRole: "" }, async () => new Response(JSON.stringify(generatedDirection), { status: 200 }));
  assert.equal(applyJobAnalysis(config, legacy).focus, config.focus);
  await assert.rejects(requestJobDirection(description, { targetRole: "" }, async () => new Response(JSON.stringify({ ...direction, suggestedFocus: "everything" }), { status: 200 })), { code: "INVALID_RESPONSE" });
});

test("switching modes parks and restores the direction without losing edits", () => {
  const auto = { mode: "auto", config, parkedDirection: undefined };
  const manual = switchSetupMode(auto, "manual");
  assert.equal(manual.config.jobDirection, undefined);
  assert.equal(manual.config.role, config.role);
  assert.deepEqual(manual.parkedDirection, direction);
  assert.equal(setupModeBlocksStart("manual", undefined), false);

  const edited = switchSetupMode({ ...manual, config: { ...manual.config, role: "Platform Engineer", seniority: "staff" } }, "auto");
  assert.equal(edited.config.jobDirection.targetRole, "Platform Engineer");
  assert.equal(edited.config.jobDirection.suggestedSeniority, "staff");
  assert.equal(edited.config.jobDirection.mainInterviewEmphasis, direction.mainInterviewEmphasis);
  assert.equal(edited.parkedDirection, undefined);

  const empty = switchSetupMode({ mode: "manual", config: { ...config, jobDirection: undefined }, parkedDirection: undefined }, "auto");
  assert.equal(empty.config.jobDirection, undefined);
  assert.equal(setupModeBlocksStart("auto", empty.config.jobDirection), true);
  assert.equal(setupModeBlocksStart("auto", direction), false);
  assert.equal(setupModeBlocksStart("resume", direction), true);
  assert.equal(setupModeBlocksStart("resume", { ...direction, tailoredQuestions: ["How did you design the main service in this project?"] }), false);
});

test("tailored questions remain backward-compatible in handoff but automatic analysis requires eight valid questions", async () => {
  const good = "How would you structure a Playwright test suite so it stays reliable?";
  const withQuestions = { ...direction, tailoredQuestions: [good] };
  assert.equal(isValidJobDirection(withQuestions), true);
  assert.equal(isValidJobDirection({ ...direction, tailoredQuestions: [] }), false);
  assert.equal(isValidJobDirection({ ...direction, tailoredQuestions: ["Two? Questions?"] }), false);
  assert.equal(isValidJobDirection({ ...direction, tailoredQuestions: ["Como você construiu seu projeto mais importante?"] }), false);
  assert.equal(isValidJobDirection({ ...direction, tailoredQuestions: ["Tell me about yourself and your recent work?"] }), false);
  assert.equal(isValidJobDirection({ ...direction, tailoredQuestions: Array(9).fill(0).map((_, i) => `Question number ${i} about testing?`) }), false);
  const parsed = parseRoomHandoff(serializeRoomHandoff({ ...config, jobDirection: withQuestions }, 1_000), 1_000);
  assert.deepEqual(parsed.jobDirection.tailoredQuestions, [good]);
  const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ ...direction, tailoredQuestions: [good, good, "bad", "Two? Questions?"] }) });
  await assert.rejects(requestJobDirection(description, { targetRole: direction.targetRole }, fetcher), { code: "INVALID_RESPONSE" });

  const complete = await requestJobDirection(description, { targetRole: direction.targetRole }, async () => new Response(JSON.stringify(generatedDirection), { status: 200 }));
  assert.deepEqual(complete.tailoredQuestions, generatedQuestions);
});
