import assert from "node:assert/strict";
import test from "node:test";
import { isValidJobDirection, jobDescriptionMaxLength, jobDescriptionMinLength, requestJobDirection } from "../src/lib/interview/job-direction.mjs";
import { parseRoomHandoff, serializeRoomHandoff } from "../src/lib/interview/room-handoff.mjs";

const direction = {
  targetRole: "Senior Backend Engineer",
  suggestedSeniority: "senior",
  mainInterviewEmphasis: "Arquitetura de APIs e confiabilidade.",
  priorityCompetencies: ["Sistemas distribuídos", "Observabilidade"],
  productTeamContext: "Plataforma de logística B2B em uma equipe multidisciplinar.",
};
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
    return new Response(JSON.stringify(direction), { status: 200 });
  }, "https://backend.test/api/v1/thinking/job-direction");
  assert.deepEqual(result, direction);
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
