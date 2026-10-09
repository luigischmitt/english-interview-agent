import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createResumeDirectionHandlers, extractResumePdf, maximumResumeBytes, redactResumeContactDetails } from "../src/controllers/resume-direction-controller.js";
import { JobDirectionUserLimit } from "../src/thinking/job-direction-user-limit.js";
import { maxResumeTailoredQuestions, OpenRouterResumeDirectionService, openRouterProviderSlug, parseResumeDirection, resumeQuestionDimensions } from "../src/thinking/openrouter-resume-direction-service.js";
import { ThinkingServiceError } from "../src/thinking/errors.js";
import { defaultResumeDirectionHedgeAfterMs, defaultResumeDirectionTimeoutMs, loadThinkingConfig } from "../src/thinking/config.js";
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
    question: [
      "What part of the payments platform did you own directly?",
      "How did Node.js fit into the platform's architecture?",
      "What trade-off shaped your database design?",
      "What was the hardest technical issue during the work?",
      "How did you measure the reduction in incidents?",
      "How did product and support teams shape the releases?",
      "What checks helped keep the payment flow reliable?",
      "What skill did you develop while building this system?",
    ][index]!,
    sourceAnchor,
    subject: "distributed payments platform",
    dimension: resumeQuestionDimensions[index]!,
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
      tailoredQuestions: providerResult.tailoredQuestions.map(({ question }) => question),
    });
  });

  it("accepts one short resume experience when questions explore distinct dimensions", () => {
    const shortResume = "Backend Engineer. Built a payments platform with Node.js and PostgreSQL.";
    const result = parseResumeDirection(JSON.stringify(providerResult), { resumeText: shortResume, pageCount: 1 });
    expect(result.tailoredQuestions).toHaveLength(8);
  });

  it("requires subject breadth for a rich resume even when the model labels every question alike", () => {
    const richResume = `${resumeText} ${"Led a separate customer identity project, improved service reliability, coached teammates, and delivered a data migration. ".repeat(8)}`;
    expect(richResume.length).toBeGreaterThanOrEqual(800);
    expect(() => parseResumeDirection(JSON.stringify(providerResult), { resumeText: richResume, pageCount: 4 })).toThrowError(/validar a análise/iu);
  });

  it("rejects eight paraphrases of one intent even when source anchors and subjects differ", () => {
    const repetitive = {
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((question, index) => ({
        ...question,
        question: `How did you make a technical decision about ${["Node.js", "PostgreSQL", "payments", "observability", "incidents", "releases", "support", "Acme"][index]}?`,
        subject: `subject ${index + 1}`,
        dimension: "decision_tradeoff",
      })),
    };
    expect(() => parseResumeDirection(JSON.stringify(repetitive), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });

  it("limits one subject to four questions when the plan contains at least three subjects", () => {
    const concentrated = {
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((question, index) => ({
        ...question,
        subject: index < 5 ? "payments platform" : `subject ${index}`,
      })),
    };
    expect(() => parseResumeDirection(JSON.stringify(concentrated), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });

  it("rejects an opening tailored question that repeats the presentation prompt", () => {
    const repeatedOpening = {
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((question, index) => index === 0
        ? { ...question, question: "Tell me about a project you built with Node.js." }
        : question),
    };
    expect(() => parseResumeDirection(JSON.stringify(repeatedOpening), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });

  it("rejects a broad overview paraphrase as the first tailored question", () => {
    const repeatedOpening = {
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((question, index) => index === 0
        ? { ...question, question: "Can you give a quick overview of the work that best represents your experience?" }
        : question),
    };
    expect(() => parseResumeDirection(JSON.stringify(repeatedOpening), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });

  it("accepts translated evidence anchors but rejects contact details", () => {
    expect(parseResumeDirection(JSON.stringify({
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((item, index) => index === 0
        ? { ...item, sourceAnchor: "translated professional experience" }
        : item),
    }), { resumeText, pageCount: 2 }).tailoredQuestions).toHaveLength(8);
    expect(() => parseResumeDirection(JSON.stringify({
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((item, index) => index === 0
        ? { ...item, sourceAnchor: "person@example.com" }
        : item),
    }), { resumeText: `${resumeText} person@example.com`, pageCount: 2 })).toThrowError(/validar a análise/iu);
    expect(() => parseResumeDirection(JSON.stringify({
      ...providerResult,
      tailoredQuestions: providerResult.tailoredQuestions.map((item, index) => index === 0
        ? { ...item, question: "How did person@example.com build the platform?" }
        : item),
    }), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });

  it("requires exactly eight resume questions", () => {
    const questions = resumeAnchors.map((sourceAnchor, index) => ({
      question: `What did you learn from experience number ${index + 1} with this work?`,
      sourceAnchor,
      subject: `experience ${index + 1}`,
      dimension: resumeQuestionDimensions[index]!,
    }));
    const result = parseResumeDirection(JSON.stringify({ ...providerResult, tailoredQuestions: questions }), { resumeText, pageCount: 2 });
    expect(maxResumeTailoredQuestions).toBe(8);
    expect(result.tailoredQuestions).toHaveLength(8);
    expect(() => parseResumeDirection(JSON.stringify({ ...providerResult, tailoredQuestions: questions.slice(0, 7) }), { resumeText, pageCount: 2 })).toThrowError(/validar a análise/iu);
  });
});

describe("OpenRouter resume direction service", () => {
  it("uses a dedicated 30-second default and honors its dedicated environment override", () => {
    expect(defaultResumeDirectionTimeoutMs).toBe(30_000);
    expect(loadThinkingConfig({}).resumeDirectionTimeoutMs).toBe(30_000);
    expect(loadThinkingConfig({ INTERVIEW_RESUME_DIRECTION_TIMEOUT_MS: "26000" }).resumeDirectionTimeoutMs).toBe(26_000);
    expect(() => loadThinkingConfig({ INTERVIEW_RESUME_DIRECTION_TIMEOUT_MS: "24000" })).toThrow(/between 25000 and 30000/iu);
    expect(() => loadThinkingConfig({ INTERVIEW_RESUME_DIRECTION_TIMEOUT_MS: "31000" })).toThrow(/between 25000 and 30000/iu);
  });

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
    const responseFormat = sent?.response_format as { json_schema?: { schema?: Record<string, unknown> } } | undefined;
    const schemaProperties = responseFormat?.json_schema?.schema?.properties as Record<string, unknown> | undefined;
    const tailoredSchema = schemaProperties?.tailoredQuestions as { items?: { properties?: Record<string, { enum?: string[] }> } } | undefined;
    const questionSchema = tailoredSchema?.items?.properties;
    expect(questionSchema).toHaveProperty("subject");
    expect(questionSchema?.dimension?.enum).toEqual(resumeQuestionDimensions);
    const log = info.mock.calls.map(([line]) => String(line)).join("\n");
    expect(log).toContain('"event":"interview_resume_analysis_timing"');
    expect(log).toContain('"pages":2');
    expect(log).not.toContain("distributed payments platform");
    info.mockRestore();
  });

  it("retries one invalid response while excluding its provider and preserving privacy and strict schema", async () => {
    const sent: Array<Record<string, unknown>> = [];
    let call = 0;
    const service = new OpenRouterResumeDirectionService({
      key: "test-key",
      model: "test-model",
      timeoutMs: 1_000,
      fetchImplementation: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        call += 1;
        return call === 1
          ? Response.json({ openrouter_metadata: { endpoints: { available: [{ provider: "Example Cloud", selected: true }] } }, choices: [{ message: { content: "not json" } }] })
          : Response.json({ provider: "other-cloud", choices: [{ message: { content: JSON.stringify(providerResult) } }] });
      },
    });

    await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toMatchObject({ tailoredQuestions: expect.arrayContaining([expect.any(String)]) });
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body.provider).toMatchObject({ require_parameters: true, data_collection: "deny" });
      expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    }
    expect(sent[0]?.provider).not.toHaveProperty("ignore");
    expect(sent[1]?.provider).toMatchObject({ ignore: ["example-cloud"] });
  });

  it("ignores malformed routing metadata and still retries an invalid response", async () => {
    let call = 0;
    const service = new OpenRouterResumeDirectionService({
      key: "test-key",
      model: "test-model",
      timeoutMs: 1_000,
      fetchImplementation: async () => {
        call += 1;
        return call === 1
          ? Response.json({ openrouter_metadata: { endpoints: { available: { provider: "not-an-array" } } }, choices: [{ message: { content: "not json" } }] })
          : Response.json({ choices: [{ message: { content: JSON.stringify(providerResult) } }] });
      },
    });

    await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toMatchObject({ tailoredQuestions: expect.arrayContaining([expect.any(String)]) });
    expect(call).toBe(2);
  });

  it("configures the hedge delay with a bounded environment override", () => {
    expect(loadThinkingConfig({}).resumeDirectionHedgeAfterMs).toBe(defaultResumeDirectionHedgeAfterMs);
    expect(loadThinkingConfig({ INTERVIEW_RESUME_DIRECTION_HEDGE_AFTER_MS: "8000" }).resumeDirectionHedgeAfterMs).toBe(8_000);
    expect(() => loadThinkingConfig({ INTERVIEW_RESUME_DIRECTION_HEDGE_AFTER_MS: "500" })).toThrow(/hedge/iu);
  });

  it("job-direction limit: a failed release waives the cooldown, a success keeps it", () => {
    let now = 0;
    const limit = new JobDirectionUserLimit({ cooldownMs: 5_000, now: () => now });
    const first = limit.acquire("u");
    if (!first.allowed) throw new Error("expected lease");
    expect(limit.acquire("u")).toMatchObject({ allowed: false, reason: "in_flight" });
    first.release("failure");
    const second = limit.acquire("u");
    expect(second.allowed).toBe(true);
    if (second.allowed) second.release("success");
    expect(limit.acquire("u")).toMatchObject({ allowed: false, reason: "cooldown" });
  });

  describe("hedged attempts", () => {
    const ok = () => Response.json({ choices: [{ message: { content: JSON.stringify(providerResult) } }] });
    const hang = (init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    const quiet = () => vi.spyOn(console, "info").mockImplementation(() => undefined);

    it("starts B at the threshold, excluding the pinned provider, and B wins while A is cancelled", async () => {
      vi.stubEnv("OPENROUTER_PINNED_PROVIDER", "parasail");
      const info = quiet();
      const sent: Array<Record<string, any>> = [];
      let aborted = false;
      const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        if (sent.length === 1) { init?.signal?.addEventListener("abort", () => { aborted = true; }); return hang(init); }
        return ok();
      });
      vi.stubGlobal("fetch", fetchImplementation);
      try {
        const service = new OpenRouterResumeDirectionService({ key: "k", model: "m", timeoutMs: 2_000, hedgeAfterMs: 100 });
        const started = Date.now();
        await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toMatchObject({ tailoredQuestions: expect.any(Array) });
        expect(Date.now() - started).toBeGreaterThanOrEqual(95);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(sent).toHaveLength(2);
        expect(sent[0]?.provider.ignore).toBeUndefined();
        expect(sent[1]?.provider).toMatchObject({ ignore: ["parasail"] });
        expect(aborted).toBe(true);
        const logs = info.mock.calls.map(String).join("\n");
        expect(logs).toContain("hedge_started");
        expect(logs).toContain("hedge_won_B");
      } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); info.mockRestore(); }
    });

    it("does not start B when A answers before the threshold", async () => {
      const info = quiet();
      let call = 0;
      const service = new OpenRouterResumeDirectionService({ key: "k", model: "m", timeoutMs: 2_000, hedgeAfterMs: 500, fetchImplementation: async () => { call += 1; return ok(); } });
      await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(call).toBe(1);
      expect(info.mock.calls.map(String).join("\n")).not.toContain("hedge_started");
      info.mockRestore();
    });

    it("keeps waiting for B when A is invalid, and a fast A failure starts B immediately", async () => {
      const info = quiet();
      let call = 0;
      const started = Date.now();
      const service = new OpenRouterResumeDirectionService({
        key: "k", model: "m", timeoutMs: 2_000, hedgeAfterMs: 1_500,
        fetchImplementation: async () => {
          call += 1;
          if (call === 1) return Response.json({ choices: [{ message: { content: "not json" } }] });
          await new Promise((resolve) => setTimeout(resolve, 50));
          return ok();
        },
      });
      await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toBeDefined();
      expect(call).toBe(2);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(info.mock.calls.map(String).join("\n")).toContain("fast_failure");
      info.mockRestore();
    });

    it("keeps A when B is invalid and A answers later", async () => {
      const info = quiet();
      let call = 0;
      const service = new OpenRouterResumeDirectionService({
        key: "k", model: "m", timeoutMs: 2_000, hedgeAfterMs: 50,
        fetchImplementation: async () => {
          call += 1;
          if (call === 1) { await new Promise((resolve) => setTimeout(resolve, 300)); return ok(); }
          return Response.json({ choices: [{ message: { content: "not json" } }] });
        },
      });
      await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toBeDefined();
      expect(call).toBe(2);
      info.mockRestore();
    });

    it("times out at the shared deadline when both attempts hang", async () => {
      const info = quiet();
      const started = Date.now();
      const service = new OpenRouterResumeDirectionService({ key: "k", model: "m", timeoutMs: 400, hedgeAfterMs: 100, fetchImplementation: async (_url, init) => hang(init) });
      await expect(service.analyze({ resumeText, pageCount: 2 })).rejects.toMatchObject({ code: "RESUME_DIRECTION_TIMEOUT", status: 504 });
      expect(Date.now() - started).toBeLessThan(700);
      info.mockRestore();
    });

    it("fails with the invalid-response error when both attempts are invalid", async () => {
      const info = quiet();
      const service = new OpenRouterResumeDirectionService({ key: "k", model: "m", timeoutMs: 1_000, fetchImplementation: async () => Response.json({ choices: [{ message: { content: "not json" } }] }) });
      await expect(service.analyze({ resumeText, pageCount: 2 })).rejects.toMatchObject({ code: "RESUME_DIRECTION_INVALID_PROVIDER_RESPONSE" });
      info.mockRestore();
    });
  });

  it("maps OpenRouter display names to provider slugs", () => {
    expect(openRouterProviderSlug("Novita AI")).toBe("novita");
    expect(openRouterProviderSlug("Google")).toBe("google-vertex");
    expect(openRouterProviderSlug("  Google   Vertex ")).toBe("google-vertex");
    expect(openRouterProviderSlug("Fireworks")).toBe("fireworks");
    expect(openRouterProviderSlug("Some New Provider")).toBe("some-new-provider");
    expect(openRouterProviderSlug("parasail/fp8")).toBe("parasail-fp8");
    expect(openRouterProviderSlug("???")).toBeUndefined();
    expect(openRouterProviderSlug("")).toBeUndefined();
    expect(openRouterProviderSlug(undefined)).toBeUndefined();
  });

  it("ignores the mapped provider on retry and logs content-free when the name cannot be mapped", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const run = async (provider: string) => {
      const sent: Array<Record<string, any>> = [];
      let call = 0;
      const service = new OpenRouterResumeDirectionService({
        key: "test-key", model: "test-model", timeoutMs: 1_000,
        fetchImplementation: async (_input, init) => {
          sent.push(JSON.parse(String(init?.body)));
          call += 1;
          if (call === 1) return Response.json({ provider, choices: [{ message: { content: "not json" } }] });
          return Response.json({ choices: [{ message: { content: JSON.stringify(providerResult) } }] });
        },
      });
      await service.analyze({ resumeText, pageCount: 2 });
      return sent;
    };
    expect((await run("Novita AI"))[1]?.provider.ignore).toEqual(["novita"]);
    expect(info.mock.calls.map(String).join("\n")).not.toContain("provider_unmappable");
    expect((await run("???"))[1]?.provider.ignore).toBeUndefined();
    const logged = info.mock.calls.map(String).join("\n");
    expect(logged).toContain("provider_unmappable");
    expect(logged).not.toContain("???");
    info.mockRestore();
  });

  it("retries once after a first-attempt network error", async () => {
    let call = 0;
    const service = new OpenRouterResumeDirectionService({
      key: "test-key",
      model: "test-model",
      timeoutMs: 1_000,
      fetchImplementation: async () => {
        call += 1;
        if (call === 1) throw new TypeError("network unavailable");
        return Response.json({ choices: [{ message: { content: JSON.stringify(providerResult) } }] });
      },
    });

    await expect(service.analyze({ resumeText, pageCount: 2 })).resolves.toMatchObject({ tailoredQuestions: expect.arrayContaining([expect.any(String)]) });
    expect(call).toBe(2);
  });

  it("stops after exactly two invalid provider responses", async () => {
    let call = 0;
    const service = new OpenRouterResumeDirectionService({
      key: "test-key",
      model: "test-model",
      timeoutMs: 1_000,
      fetchImplementation: async () => {
        call += 1;
        return Response.json({ choices: [{ message: { content: "not json" } }] });
      },
    });

    await expect(service.analyze({ resumeText, pageCount: 2 })).rejects.toMatchObject({ code: "RESUME_DIRECTION_INVALID_PROVIDER_RESPONSE", status: 502 });
    expect(call).toBe(2);
  });

  it("shares the timeout across retry and logs safe invalid-response reasons without response content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let call = 0;
    const service = new OpenRouterResumeDirectionService({
      key: "test-key",
      model: "test-model",
      timeoutMs: 60,
      fetchImplementation: async (_url, init) => {
        call += 1;
        if (call === 1) return Response.json({ provider: "first-provider", choices: [{ message: { content: "PRIVATE_RESPONSE_CONTENT" } }] });
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      },
    });

    await expect(service.analyze({ resumeText, pageCount: 2 })).rejects.toMatchObject({ code: "RESUME_DIRECTION_TIMEOUT", status: 504 });
    expect(call).toBe(2);
    const logs = info.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logs).toContain('"invalidReason":"invalid_json"');
    expect(logs).not.toContain("PRIVATE_RESPONSE_CONTENT");
    expect(logs).not.toContain("distributed payments platform");
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

  it("waives the cooldown after a failed analysis but keeps it after a success", async () => {
    let now = 1_000;
    const limit = new JobDirectionUserLimit({ cooldownMs: 5_000, now: () => now });
    const failing = vi.fn<ResumeDirectionService["analyze"]>(async () => { throw new ThinkingServiceError("RESUME_DIRECTION_TIMEOUT", 504, "x"); });
    const failingApp = testApp({ analyze: failing }, undefined, limit);
    const attach = (app: ReturnType<typeof testApp>) => request(app).post("/resume").attach("resume", Buffer.from("%PDF-x"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect((await attach(failingApp)).status).toBe(504);
    expect((await attach(failingApp)).status).toBe(504);
    const succeeding = testApp({ analyze: async () => parseResumeDirection(JSON.stringify(providerResult), { resumeText, pageCount: 2 }) }, undefined, limit);
    expect((await attach(succeeding)).status).toBe(200);
    const cooled = await attach(succeeding);
    expect(cooled.status).toBe(429);
    now += 5_000;
    expect((await attach(succeeding)).status).toBe(200);
  });

  it("rejects a concurrent request before PDF extraction or model analysis", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(info.mock.calls.map(([line]) => String(line)).join("\n")).toContain('"outcome":"rate_limited_in_flight"');
    info.mockRestore();
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
