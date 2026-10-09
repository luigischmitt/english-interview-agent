import assert from "node:assert/strict";
import test from "node:test";
import { requestResumeDirection, resumeDirectionClientTimeoutMs, resumeMaxBytes, validateResumeFile } from "../src/lib/interview/resume-direction.mjs";

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

test("client timeout outlasts the backend maximum budget and maps an abort to the timeout code", async () => {
  assert.ok(resumeDirectionClientTimeoutMs >= 30_000 + 3_000);
  let signal;
  await assert.rejects(
    requestResumeDirection(pdf(), async (_url, init) => {
      signal = init.signal;
      throw new DOMException("timed out", "TimeoutError");
    }),
    { code: "RESUME_DIRECTION_TIMEOUT", status: 504 },
  );
  assert.ok(signal instanceof AbortSignal);
  await assert.rejects(requestResumeDirection(pdf(), async () => { throw new TypeError("network"); }), { code: "REQUEST_FAILED" });
});

test("reports content-free diagnostics for each failure stage and for success", async () => {
  const events = [];
  const onDiagnostic = (event) => events.push(event);
  const url = "https://backend.test/resume-direction";
  const run = (fetcher, file = pdf()) => requestResumeDirection(file, fetcher, url, onDiagnostic).catch(() => undefined);

  await run(async () => new Response(JSON.stringify({ error: { code: "RESUME_DIRECTION_TIMEOUT", message: "PRIVATE" } }), { status: 504 }));
  await run(async () => { throw new TypeError("network"); });
  await run(async () => { const error = new Error("late"); error.name = "TimeoutError"; throw error; });
  await run(async () => new Response(JSON.stringify({ ...direction, tailoredQuestions: direction.tailoredQuestions.slice(0, 7) }), { status: 200 }));
  await run(async () => new Response(JSON.stringify({ ...direction, targetRole: "" }), { status: 200 }));
  await run(async () => new Response("not json", { status: 200 }));
  await run(async () => new Response("{}", { status: 200 }), pdf("resume.txt", 64, "text/plain"));
  await run(async () => new Response(JSON.stringify(direction), { status: 200 }));

  assert.deepEqual(events.map((event) => [event.resumeStage, event.resumeCode, event.resumeReason, event.httpStatus]), [
    ["response", "RESUME_DIRECTION_TIMEOUT", undefined, 504],
    ["request", "REQUEST_FAILED", undefined, undefined],
    ["request", "RESUME_DIRECTION_TIMEOUT", undefined, 504],
    ["validation", "INVALID_RESPONSE", "INVALID_QUESTIONS", 200],
    ["validation", "INVALID_RESPONSE", "INVALID_PROFILE", 200],
    ["validation", "INVALID_RESPONSE", undefined, 200],
    ["file", "INVALID_RESUME_REQUEST", undefined, 400],
    ["success", undefined, undefined, 200],
  ]);
  assert.equal(events[3].receivedQuestions, 7);
  assert.equal(events[3].validQuestions, 7);
  assert.ok(events.every((event) => event.kind === "resume_analysis" && Number.isFinite(event.elapsedMs)));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("a throwing diagnostics callback never changes the outcome", async () => {
  const result = await requestResumeDirection(pdf(), async () => new Response(JSON.stringify(direction), { status: 200 }), undefined, () => { throw new Error("boom"); });
  assert.equal(result.tailoredQuestions.length, 8);
});
