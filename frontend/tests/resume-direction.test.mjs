import assert from "node:assert/strict";
import test from "node:test";
import { requestResumeDirection, resumeMaxBytes, validateResumeFile } from "../src/lib/interview/resume-direction.mjs";

const direction = {
  targetRole: "Backend Engineer",
  suggestedSeniority: "senior",
  tailoredQuestions: Array.from({ length: 8 }, (_, index) => `In project number ${index + 1}, what technical decision did you make?`),
};
const approvedDirection = {
  ...direction,
  mainInterviewEmphasis: "Experiências, projetos e decisões descritos no currículo.",
  priorityCompetencies: ["Experiências e projetos do currículo"],
  productTeamContext: "Entrevista orientada exclusivamente pelo currículo enviado.",
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
  assert.deepEqual(result, { ...approvedDirection, suggestedFocus: "technical-depth" });
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

test("accepts a full eight-question resume plan", async () => {
  const tailoredQuestions = Array(8).fill(0).map((_, index) => `In project number ${index + 1}, what technical decision did you make?`);
  const result = await requestResumeDirection(pdf(), async () => new Response(JSON.stringify({ ...direction, tailoredQuestions }), { status: 200 }));
  assert.equal(result.tailoredQuestions.length, 8);
});
