import { describe, expect, it, vi } from "vitest";
import { AzureAssessmentError, AzurePronunciationAssessmentService, categorizeAzureAssessmentFailure } from "../src/transcription/azure-pronunciation-assessment.js";

const responseWith = (status: number, payload: unknown = {}) => new Response(JSON.stringify(payload), { status });

describe("Azure pronunciation assessment failure categories", () => {
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [400, "provider_rejected"],
    [503, "provider_unavailable"],
  ] as const)("maps HTTP %i to a safe category", async (status, category) => {
    const fetcher = vi.fn(async () => responseWith(status, { error: "private response body must not escape" }));
    const service = new AzurePronunciationAssessmentService({
      key: "test-key", region: "test-region", timeoutMs: 100,
      convert: async (audio) => Buffer.from(audio), fetchImplementation: fetcher,
    });
    const error = await service.assess(Buffer.from([1, 2, 3]), "wav", "known words").catch((failure: unknown) => failure);
    expect(error).toMatchObject({ category, name: "AzureAssessmentError" });
    expect(error instanceof Error && error.message.includes("private response body")).toBe(false);
  });

  it("retries a rate-limited request within the deadline and honours Retry-After", async () => {
    const success = { RecognitionStatus: "Success", NBest: [{ AccuracyScore: 80, FluencyScore: 70, ProsodyScore: 60, Words: [] }] };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(responseWith(200, success));
    const sleeps: number[] = [];
    const service = new AzurePronunciationAssessmentService({
      key: "test-key", region: "test-region", timeoutMs: 10_000,
      convert: async (audio) => Buffer.from(audio), fetchImplementation: fetcher,
      sleepImplementation: async (ms) => { sleeps.push(ms); },
    });
    const result = await service.assess(Buffer.from([1, 2, 3]), "wav", "known words");
    expect(result.scores).toEqual({ accuracy: 80, fluency: 70, prosody: 60 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_000]);
  });

  it("gives up as rate_limited after three attempts", async () => {
    const fetcher = vi.fn(async () => responseWith(429));
    const service = new AzurePronunciationAssessmentService({
      key: "test-key", region: "test-region", timeoutMs: 10_000,
      convert: async (audio) => Buffer.from(audio), fetchImplementation: fetcher,
      sleepImplementation: async () => undefined,
    });
    await expect(service.assess(Buffer.from([1, 2, 3]), "wav", "known words")).rejects.toMatchObject({ category: "rate_limited" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("distinguishes no-match responses and clears the converted audio buffer", async () => {
    const converted = Buffer.from([7, 8, 9]);
    const service = new AzurePronunciationAssessmentService({
      key: "test-key", region: "test-region", timeoutMs: 100,
      convert: async () => converted,
      fetchImplementation: async () => responseWith(200, { RecognitionStatus: "NoMatch" }),
    });
    await expect(service.assess(Buffer.from([1, 2, 3]), "wav", "known words"))
      .rejects.toMatchObject({ category: "no_match" });
    expect(converted.every((byte) => byte === 0)).toBe(true);
  });

  it("clears converted audio when cancellation arrives between conversion and the request", async () => {
    const converted = Buffer.from([4, 5, 6]);
    const controller = new AbortController();
    const service = new AzurePronunciationAssessmentService({
      key: "test-key", region: "test-region", timeoutMs: 100,
      convert: async () => { controller.abort(); return converted; },
      fetchImplementation: async () => { throw new Error("fetch must not run"); },
    });
    await expect(service.assess(Buffer.from([1, 2, 3]), "wav", "known words", controller.signal))
      .rejects.toMatchObject({ category: "cancelled" });
    expect(converted.every((byte) => byte === 0)).toBe(true);
  });

  it.each(["not-json", "null"])("classifies malformed successful JSON %s as invalid_response and clears converted audio", async (body) => {
    const converted = Buffer.from([4, 5, 6]);
    const service = new AzurePronunciationAssessmentService({
      key: "test-key", region: "test-region", timeoutMs: 100,
      convert: async () => converted,
      fetchImplementation: async () => new Response(body, { status: 200 }),
    });
    await expect(service.assess(Buffer.from([1, 2, 3]), "wav", "known words"))
      .rejects.toMatchObject({ category: "invalid_response" });
    expect(converted.every((byte) => byte === 0)).toBe(true);
  });

  it("categorizes cancellations and timeouts without exposing error text", () => {
    expect(categorizeAzureAssessmentFailure(new Error("Azure pronunciation assessment timed out"))).toBe("timeout");
    expect(categorizeAzureAssessmentFailure(new Error("response includes secret key value"))).toBe("unknown");
    expect(categorizeAzureAssessmentFailure(new AzureAssessmentError("cancelled"))).toBe("cancelled");
  });
});
