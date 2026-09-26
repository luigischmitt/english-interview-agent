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

  it("categorizes cancellations and timeouts without exposing error text", () => {
    expect(categorizeAzureAssessmentFailure(new Error("Azure pronunciation assessment timed out"))).toBe("timeout");
    expect(categorizeAzureAssessmentFailure(new Error("response includes secret key value"))).toBe("unknown");
    expect(categorizeAzureAssessmentFailure(new AzureAssessmentError("cancelled"))).toBe("cancelled");
  });
});
