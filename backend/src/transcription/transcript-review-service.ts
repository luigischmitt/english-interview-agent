const instruction = `You review an automatic transcript of a Brazilian candidate answering a job interview question in English. Listen to the audio and output the VERBATIM transcript of what the speaker actually said. Fix only words that the draft mis-recognized (wrong words, invented words, misspelled names or technical terms such as FastAPI, Supabase, LangChain). NEVER correct the speaker's grammar, tenses, articles, prepositions, agreement or word choice: if the speaker said "since three years" or "the customers is", keep it exactly. Keep non-standard forms exactly as heard, for example "explain him the decision", "I choosed", "it depends of", "get worst", "people is", "make a question", "I have 25 years", "discuss about", "help me to do". Do not add, remove or reorder words that were spoken, and do not add missing words. When unsure between the draft and what you hear, keep the draft wording. Output only the transcript.\nQuestion: <question>\nDraft transcript: <draft>`;

export type TranscriptReview = { transcript: string; changed: boolean };
export type TranscriptReviewService = { review(audioWav: Buffer, draft: string, question: string | null, signal?: AbortSignal): Promise<TranscriptReview | null> };
export type TranscriptReviewOptions = { key: string; model?: string; timeoutMs?: number; enabled?: boolean; fetchImplementation?: typeof fetch };

export class OpenRouterTranscriptReviewService implements TranscriptReviewService {
  private readonly fetchImplementation: typeof fetch;
  constructor(private readonly options: TranscriptReviewOptions) { this.fetchImplementation = options.fetchImplementation ?? fetch; }

  async review(audioWav: Buffer, draft: string, question: string | null, signal?: AbortSignal): Promise<TranscriptReview | null> {
    if (this.options.enabled === false) return null;
    const startedAt = Date.now();
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let status = "unavailable";
    let changed = false;
    let lengthRatio = "unknown";
    try {
      const response = await this.fetchImplementation("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${this.options.key}`, "Content-Type": "application/json" }, signal: requestSignal,
        body: JSON.stringify({ model: this.options.model ?? "google/gemini-3.8-flash", temperature: 0, provider: { data_collection: "deny" }, messages: [{ role: "user", content: [
          { type: "text", text: instruction.replace("<question>", question ?? "").replace("<draft>", draft) },
          { type: "input_audio", input_audio: { data: audioWav.toString("base64"), format: "wav" } },
        ] }] }),
      });
      if (!response.ok) return null;
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") return null;
      const transcript = cleanTranscript(content);
      const draftCount = wordCount(draft);
      const outputCount = wordCount(transcript);
      const ratio = draftCount ? outputCount / draftCount : 0;
      lengthRatio = ratio < 0.8 ? "short" : ratio > 1.25 ? "long" : "similar";
      if (!transcript || transcript.length > 6_000 || /draft transcript|question:|you review an automatic transcript|output only the transcript/iu.test(transcript) || ratio < 0.6 || ratio > 1.6) return null;
      changed = normalize(transcript) !== normalize(draft);
      status = "success";
      return { transcript, changed };
    } catch {
      return null;
    } finally {
      console.info(JSON.stringify({ event: "transcript_review", status, durationMs: Date.now() - startedAt, changed, lengthRatio }));
    }
  }
}

function cleanTranscript(value: string): string {
  let text = value.trim().replace(/^```(?:[\w-]+)?\s*/u, "").replace(/\s*```$/u, "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) || (text.startsWith("“") && text.endsWith("”"))) text = text.slice(1, -1).trim();
  if (text.startsWith("**") && text.endsWith("**")) text = text.slice(2, -2).trim();
  return text;
}
function wordCount(value: string): number { return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0; }
function normalize(value: string): string { return value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
