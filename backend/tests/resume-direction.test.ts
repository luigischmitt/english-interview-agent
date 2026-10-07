import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createResumeDirectionHandlers, extractResumePdf, maximumResumeBytes, redactResumeContactDetails } from "../src/controllers/resume-direction-controller.js";
import { JobDirectionUserLimit } from "../src/thinking/job-direction-user-limit.js";
import { maxResumeTailoredQuestions, OpenRouterResumeDirectionService, parseResumeDirection } from "../src/thinking/openrouter-resume-direction-service.js";
import type { ResumeDirectionInput, ResumeDirectionService } from "../src/thinking/types.js";

const resumeText = "Backend Engineer at Acme. Built a distributed payments platform with Node.js and PostgreSQL. Led observability improvements and reduced incidents by 30 percent. Collaborated with product and support teams across releases.";

const resumeAnchors = [
  "Backend Engineer", "Acme", "distributed payments platform", "Node.js", "PostgreSQL",
  "observability improvements", "reduced incidents by 30 percent", "product and support teams",
];

const providerResult = {
  targetRole: "Senior Backend Engineer",
  suggestedSeniority: "senior",
  suggestedFocus: "technical-depth",
  tailoredQuestions: resumeAnchors.map((sourceAnchor, index) => ({
    question: `What technical decision did you make in experience number ${index + 1}?`,
    sourceAnchor,
  })),
};

function simplePdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/gu, "\\$1");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function testApp(
  service: ResumeDirectionService | null,
  extractPdf = async () => ({ text: resumeText, pageCount: 2 }),
  userLimit = new JobDirectionUserLimit({ cooldownMs: 0 }),
) {
  const app = express();
  app.use((_request, response, next) => {
    response.locals.authenticatedUser = { userId: "user-1" };
    next();
  });
  app.post("/resume", ...createResumeDirectionHandlers(service, userLimit, extractPdf));
  return app;
}

describe("resume direction validation", () => {
  it("extracts text with the patched PDF.js build and redacts contact details", async () => {
    const extracted = await extractResumePdf(simplePdf(resumeText));
    expect(extracted.pageCount).toBe(1);
    expect(extracted.text).toContain("distributed payments platform");
    expect(redactResumeContactDetails("person@example.com https://example.com +55 (11) 99999-9999 Backend Engineer"))
      .toBe("[contact redacted] [link redacted] [phone redacted] Backend Engineer");
  });

  it("returns only grounded, spoken-friendly questions in the shared direction shape", () => {
    expect(parseResumeDirection(JSON.stringify(providerResult), { resumeText, pageCount: 2 })).toEqual({
      targetRole: "Backend Engineer",
      suggestedSeniority: "senior",
      suggestedFocus: "technical-depth",
      tailoredQuestions: Array.from({ length: 8 }, (_, index) => `What technical decision did you make in experience number ${index + 1}?`),
    });
  });

  it("rejects provider questions whose evidence is absent or exposes contact details", () => {
    expect(() => parseResumeDirection(JSON.stringify({
      ...providerResult,
      tailoredQuestions: [{ question: "How did you build the billing system?", sourceAnchor: "billing system" }],
    }), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
    expect(() => parseResumeDirection(JSON.stringify({
      ...providerResult,
      tailoredQuestions: [{ question: "How did you build that platform?", sourceAnchor: "person@example.com" }],
    }), { resumeText: `${resumeText} person@example.com`, pageCount: 2 })).toThrowError(/validar a análise/iu);
    expect(() => parseResumeDirection(JSON.stringify({
      ...providerResult,
      tailoredQuestions: [{ question: "How did person@example.com build the platform?", sourceAnchor: "distributed payments platform" }],
    }), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });

  it("requires exactly eight grounded resume questions", () => {
    const questions = resumeAnchors.map((sourceAnchor, index) => ({
      question: `What did you learn from experience number ${index + 1} with this work?`,
      sourceAnchor,
    }));
    const result = parseResumeDirection(JSON.stringify({ ...providerResult, tailoredQuestions: questions }), { resumeText, pageCount: 2 });
    expect(maxResumeTailoredQuestions).toBe(8);
    expect(result.tailoredQuestions).toHaveLength(8);
    expect(() => parseResumeDirection(JSON.stringify({ ...providerResult, tailoredQuestions: questions.slice(0, 7) }), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });
});

describe("OpenRouter resume direction service", () => {
  it("uses strict structured output, denies retention, and logs aggregates only", async () => {
    let sent: Record<string, unknown> | undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const service = new OpenRouterResumeDirectionService({
      key: "test-key",
      model: "test-model",
      timeoutMs: 1_000,
      fetchImplementation: async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ choices: [{ message: { content: JSON.stringify(providerResult) } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 } });
      },
    });
    const result = await service.analyze({ resumeText, pageCount: 2 });

    expect(result.tailoredQuestions).toHaveLength(8);
    expect(sent?.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(sent?.usage).toEqual({ include: true });
    expect(sent?.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    const log = info.mock.calls.map(([line]) => String(line)).join("\n");
    expect(log).toContain('"event":"interview_resume_analysis_timing"');
    expect(log).toContain('"pages":2');
    expect(log).not.toContain("distributed payments platform");
    info.mockRestore();
  });
});

describe("POST resume direction controller", () => {
  it("extracts a valid in-memory PDF and sends only normalized text to the service", async () => {
    const analyze = vi.fn<ResumeDirectionService["analyze"]>(async () => parseResumeDirection(JSON.stringify(providerResult), { resumeText, pageCount: 2 }));
    const response = await request(testApp({ analyze }))
      .post("/resume")
      .attach("resume", Buffer.from("%PDF-fake-test"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(200);
    expect(response.body.tailoredQuestions).toHaveLength(8);
    expect(analyze).toHaveBeenCalledWith({ resumeText, pageCount: 2 });
  });

  it("redacts contact details before model analysis", async () => {
    const analyze = vi.fn<ResumeDirectionService["analyze"]>(async () => parseResumeDirection(JSON.stringify(providerResult), { resumeText, pageCount: 2 }));
    const contactText = `${resumeText} person@example.com https://example.com +55 (11) 99999-9999`;
    const response = await request(testApp({ analyze }, async () => ({ text: contactText, pageCount: 2 })))
      .post("/resume")
      .attach("resume", Buffer.from("%PDF-fake-test"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(200);
    const analyzedText = analyze.mock.calls[0]?.[0].resumeText ?? "";
    expect(analyzedText).not.toContain("person@example.com");
    expect(analyzedText).not.toContain("example.com");
    expect(analyzedText).not.toContain("99999-9999");
  });

  it("rejects a concurrent request before PDF extraction or model analysis", async () => {
    let finishAnalysis: ((value: ReturnType<typeof parseResumeDirection>) => void) | undefined;
    const pending = new Promise<ReturnType<typeof parseResumeDirection>>((resolve) => { finishAnalysis = resolve; });
    const analyze = vi.fn<ResumeDirectionService["analyze"]>(() => pending);
    const app = testApp({ analyze }, undefined, new JobDirectionUserLimit({ cooldownMs: 0 }));
    const first = request(app).post("/resume")
      .attach("resume", Buffer.from("%PDF-first"), { filename: "resume.pdf", contentType: "application/pdf" });
    const firstResponse = first.then((value) => value);
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));

    const second = await request(app).post("/resume")
      .attach("resume", Buffer.from("%PDF-second"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(second.status).toBe(429);
    finishAnalysis?.(parseResumeDirection(JSON.stringify(providerResult), { resumeText, pageCount: 2 }));
    expect((await firstResponse).status).toBe(200);
  });

  it("rejects missing, non-PDF, oversized, unreadable, and overlong documents before model analysis", async () => {
    const analyze = vi.fn<ResumeDirectionService["analyze"]>();
    expect((await request(testApp({ analyze })).post("/resume")).status).toBe(400);
    expect((await request(testApp({ analyze })).post("/resume").attach("resume", Buffer.from("hello"), { filename: "resume.txt", contentType: "text/plain" })).status).toBe(400);
    expect((await request(testApp({ analyze })).post("/resume").attach("resume", Buffer.alloc(maximumResumeBytes + 1, 1), { filename: "resume.pdf", contentType: "application/pdf" })).status).toBe(413);
    const unreadable = await request(testApp({ analyze }, async () => { throw new Error("encrypted"); }))
      .post("/resume").attach("resume", Buffer.from("%PDF-fake"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(unreadable.status).toBe(422);
    expect(unreadable.body.error.code).toBe("RESUME_INVALID_PDF");
    const tooMany = await request(testApp({ analyze }, async () => ({ text: resumeText, pageCount: 21 })))
      .post("/resume").attach("resume", Buffer.from("%PDF-fake"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe("RESUME_TOO_MANY_PAGES");
    expect(analyze).not.toHaveBeenCalled();
  });
});
