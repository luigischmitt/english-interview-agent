import { describe, expect, it, vi } from "vitest";
import { AzurePronunciationAssessmentService } from "./azure-pronunciation-assessment.js";

describe("Azure pronunciation assessment", () => {
  it("uses the final Whisper transcript as its scripted reference", async () => {
    const audio = Buffer.from("complete wav");
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(Buffer.from(init?.body as Uint8Array).toString()).toBe(audio.toString());
      const encoded = new Headers(init?.headers).get("Pronunciation-Assessment");
      expect(JSON.parse(Buffer.from(encoded ?? "", "base64").toString("utf8")).ReferenceText).toBe("the final answer transcript");
      return new Response(JSON.stringify({ RecognitionStatus: "Success", NBest: [{ PronunciationAssessment: { AccuracyScore: 80, FluencyScore: 75, ProsodyScore: 70 } }] }), { status: 200 });
    });
    const service = new AzurePronunciationAssessmentService({
      key: "test-key",
      region: "brazilsouth",
      timeoutMs: 1_000,
      convert: async (input) => input,
      fetchImplementation: fetcher,
    });

    await expect(service.assess(audio, "wav", "the final answer transcript"))
      .resolves.toMatchObject({ mode: "scripted", scores: { accuracy: 80, fluency: 75, prosody: 70 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
