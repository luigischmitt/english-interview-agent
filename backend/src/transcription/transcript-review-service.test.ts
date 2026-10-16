import { describe, expect, it, vi } from "vitest";
import { OpenRouterTranscriptReviewService } from "./transcript-review-service.js";

const draft = "Since three years I work with FastAPI and Supabase";
const response = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("OpenRouter transcript review", () => {
  it("sends audio, model and denied data collection", async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response(draft));
    const service = new OpenRouterTranscriptReviewService({ key: "secret", fetchImplementation });
    await expect(service.review(Buffer.from("wav"), draft, "Tell me about your work")).resolves.toEqual({ transcript: draft, changed: false });
    const init = fetchImplementation.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "google/gemini-3.8-flash", temperature: 0, reasoning: { effort: "minimal" }, provider: { data_collection: "deny" } });
    expect(body.messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "input_audio", input_audio: { data: Buffer.from("wav").toString("base64"), format: "wav" } }),
      expect.objectContaining({ type: "text", text: expect.stringContaining(`Draft transcript: ${draft}`) }),
    ]));
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it.each(["", "Question: echoed", "Draft transcript: echoed", "You review an automatic transcript", "Only three words", "Since three years I work with FastAPI and Supabase and also improve this answer significantly every day at work"]) (
    "rejects invalid output %j", async (output) => {
      const service = new OpenRouterTranscriptReviewService({ key: "secret", fetchImplementation: async () => response(output) });
      await expect(service.review(Buffer.from("wav"), draft, null)).resolves.toBeNull();
    },
  );

  it("strips wrappers and honors disabled", async () => {
    const fetchImplementation = vi.fn(async () => response(`\"${draft}\"`));
    const service = new OpenRouterTranscriptReviewService({ key: "secret", fetchImplementation });
    await expect(service.review(Buffer.from("wav"), draft, null)).resolves.toEqual({ transcript: draft, changed: false });
    const disabled = new OpenRouterTranscriptReviewService({ key: "secret", enabled: false, fetchImplementation });
    await expect(disabled.review(Buffer.from("wav"), draft, null)).resolves.toBeNull();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
