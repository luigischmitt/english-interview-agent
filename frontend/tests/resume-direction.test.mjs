import assert from "node:assert/strict";
import test from "node:test";
import { removeResumeQuestion, requestResumeDirection, resumeMaxBytes, updateResumeQuestion, validateResumeFile } from "../src/lib/interview/resume-direction.mjs";
import { setupModeBlocksStart } from "../src/lib/interview/job-direction.mjs";

const direction = {
  targetRole: "Backend Engineer",
  suggestedSeniority: "senior",
  mainInterviewEmphasis: "Distributed systems and product impact",
  priorityCompetencies: ["System design", "Technical decisions"],
  productTeamContext: "Product engineering teams",
  tailoredQuestions: [
    "In your Atlas project, how did you design the event processing flow?",
    "What trade-off did you make while building the payment reconciliation service?",
  ],
};

function pdf(name = "resume.pdf", size = 128, type = "application/pdf") {
  return new File([new Uint8Array(size)], name, { type });
}

test("validates PDF files locally before uploading", () => {
  assert.equal(validateResumeFile(pdf()), null);
  assert.equal(validateResumeFile(pdf("resume.PDF", 64, "")), null);
  assert.equal(validateResumeFile(pdf("resume.txt", 64, "text/plain")), "INVALID_RESUME_REQUEST");
  assert.equal(validateResumeFile(pdf("resume.pdf", resumeMaxBytes + 1)), "RESUME_FILE_TOO_LARGE");
});

test("uploads the PDF as multipart data and accepts a valid analyzed direction", async () => {
  let request;
  const result = await requestResumeDirection(pdf(), async (...args) => {
    request = args;
    return new Response(JSON.stringify({ ...direction, suggestedFocus: "technical-depth" }), { status: 200 });
  }, "https://backend.test/api/v1/thinking/resume-direction");

  assert.equal(request[0], "https://backend.test/api/v1/thinking/resume-direction");
  assert.equal(request[1].method, "POST");
  assert.ok(request[1].body instanceof FormData);
  assert.equal(request[1].body.get("resume").name, "resume.pdf");
  assert.deepEqual([...request[1].body.keys()], ["resume"]);
  assert.deepEqual(result, { ...direction, suggestedFocus: "technical-depth" });
});

test("rejects provider errors, missing questions and invalid responses", async () => {
  await assert.rejects(
    requestResumeDirection(pdf(), async () => new Response(JSON.stringify({ error: { code: "RESUME_INVALID_PDF" } }), { status: 422 })),
    { code: "RESUME_INVALID_PDF", status: 422 },
  );
  await assert.rejects(
    requestResumeDirection(pdf(), async () => new Response(JSON.stringify({ ...direction, tailoredQuestions: [] }), { status: 200 })),
    { code: "INVALID_RESPONSE" },
  );
  await assert.rejects(
    requestResumeDirection(pdf(), async () => new Response(JSON.stringify({ ...direction, tailoredQuestions: ["Two? Questions?"] }), { status: 200 })),
    { code: "INVALID_RESPONSE" },
  );
});

test("supports reviewing and removing generated questions and blocks an empty resume plan", () => {
  const edited = updateResumeQuestion(direction, 0, "How did you measure the impact of the Atlas project?");
  assert.equal(edited.tailoredQuestions[0], "How did you measure the impact of the Atlas project?");
  const reduced = removeResumeQuestion(edited, 1);
  assert.equal(reduced.tailoredQuestions.length, 1);
  assert.equal(setupModeBlocksStart("resume", reduced), false);
  assert.equal(setupModeBlocksStart("resume", removeResumeQuestion(reduced, 0)), true);
  assert.equal(setupModeBlocksStart("resume", undefined), true);
  assert.equal(setupModeBlocksStart("manual", undefined), false);
});

test("accepts a full eight-question resume plan", async () => {
  const tailoredQuestions = Array(8).fill(0).map((_, index) => `In project number ${index + 1}, what technical decision did you make?`);
  const result = await requestResumeDirection(pdf(), async () => new Response(JSON.stringify({ ...direction, tailoredQuestions }), { status: 200 }));
  assert.equal(result.tailoredQuestions.length, 8);
});
