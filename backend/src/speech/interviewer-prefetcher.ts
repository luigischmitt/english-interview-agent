import type { InterviewOrchestrationInput, InterviewOrchestrationResult } from "../thinking/types.js";
import {
  ACKNOWLEDGEMENT_PHRASES,
  CLOSING_FALLBACK_REACTIONS,
  composeAcknowledgedQuestion,
  INTERVIEW_CLOSINGS,
  INTERVIEW_ENDED_CLOSINGS,
  interviewerChunkTexts,
  isAcknowledgeableAnswer,
  stripLeadingAcknowledgement,
} from "./interviewer-chunking.js";
import type { SpeechCache } from "./speech-cache.js";
import { normalizeTextForSpeech } from "./text-normalization.js";
import type { AudioFormat } from "./types.js";
import { resolveKokoroVoice, resolveVoice } from "./voices.js";

/** Texts that never change (acknowledgements, the closing line, the closing fallback reactions): cached longer and synthesized ahead of the interview. */
export function staticSpeechTexts(): string[] {
  const texts = [...ACKNOWLEDGEMENT_PHRASES, ...CLOSING_FALLBACK_REACTIONS.flatMap((reaction) => interviewerChunkTexts(reaction)), ...[...INTERVIEW_CLOSINGS, ...INTERVIEW_ENDED_CLOSINGS].flatMap((closing) => interviewerChunkTexts(closing))].map((text) => normalizeTextForSpeech(text.trim()));
  return [...new Set(texts)];
}

export type InterviewerPrefetcherOptions = {
  cache: SpeechCache;
  voice: string;
  speed: number;
  format: AudioFormat;
  /** How many leading chunks of the utterance to synthesize ahead (the first one is what delays the interviewer's voice). */
  chunks: number;
  /** Opens (or refreshes) the connection to the speech upstream; optional. */
  warmConnection?: () => void;
};

/**
 * Starts synthesizing the interviewer's next utterance the moment the next-turn decision exists, without waiting for the
 * client to ask. It builds the spoken text the way the client does (acknowledged question) and splits it with the same
 * chunking, so the client's later POST /speech for a chunk joins the request in flight or gets the cached audio. A decision
 * the client ends up discarding is simply never requested: its audio expires from the cache.
 */
export class InterviewerSpeechPrefetcher {
  private readonly options: InterviewerPrefetcherOptions;

  constructor(options: InterviewerPrefetcherOptions) {
    this.options = options;
  }

  /** Called when a next-turn request arrives: the speech upstream is about to be needed. */
  onTurnStarted(): void {
    try { this.options.warmConnection?.(); } catch { /* Best effort. */ }
  }

  /** The text the interviewer will speak for this decision, or null when it speaks nothing new (clarifications, no question). */
  utteranceFor(input: Pick<InterviewOrchestrationInput, "transcript">, result: InterviewOrchestrationResult): string | null {
    if (result.decision !== "FOLLOW_UP" && result.decision !== "NEXT") return null;
    const question = result.decision === "FOLLOW_UP" ? result.followUpQuestion : result.nextQuestion;
    if (!question?.trim()) return null;
    // The client drops the bridge's own "Okay." when its instant acknowledgement plays, which it does for any answer of enough words.
    const acknowledgement = result.acknowledgement && isAcknowledgeableAnswer(input.transcript)
      ? stripLeadingAcknowledgement(result.acknowledgement)
      : result.acknowledgement;
    return composeAcknowledgedQuestion(acknowledgement, question);
  }

  /** `voice` is what the client sent with the next-turn request; only selectable voices are honoured. */
  prefetchDecision(input: Pick<InterviewOrchestrationInput, "transcript">, result: InterviewOrchestrationResult, voice?: unknown, speed?: unknown): void {
    try {
      const utterance = this.utteranceFor(input, result);
      if (utterance) this.prefetchUtterance(utterance, voice, speed);
    } catch { /* Prefetching never affects the decision response. */ }
  }

  prefetchUtterance(utterance: string, voice?: unknown, speed?: unknown): void {
    for (const text of interviewerChunkTexts(utterance).slice(0, this.options.chunks)) this.prefetchText(text, voice, speed);
  }

  prefetchText(text: string, voice?: unknown, requestedSpeed?: unknown): void {
    const { cache, speed, format } = this.options;
    const resolvedVoice = this.options.voice.includes("Neural") ? resolveVoice(voice, this.options.voice) : resolveKokoroVoice(voice, this.options.voice);
    const resolvedSpeed = typeof requestedSpeed === "number" && Number.isFinite(requestedSpeed) && requestedSpeed >= 0.25 && requestedSpeed <= 4 ? requestedSpeed : speed;
    cache.prefetch({ text: normalizeTextForSpeech(text.trim()), voice: resolvedVoice, speed: resolvedSpeed, format });
  }

  /** Synthesizes the fixed phrases for a selectable voice and speed, joining cache work already in flight. */
  async prefetchStaticFor(voice?: unknown, requestedSpeed?: unknown, options: { concurrency: number; deadlineMs?: number } = { concurrency: 1 }): Promise<void> {
    const { cache, speed, format } = this.options;
    const resolvedVoice = this.options.voice.includes("Neural") ? resolveVoice(voice, this.options.voice) : resolveKokoroVoice(voice, this.options.voice);
    const resolvedSpeed = typeof requestedSpeed === "number" && Number.isFinite(requestedSpeed) && requestedSpeed >= 0.25 && requestedSpeed <= 4 ? requestedSpeed : speed;
    const texts = staticSpeechTexts();
    let next = 0;
    const work = async () => {
      for (;;) {
        const text = texts[next++];
        if (!text) return;
        try { await cache.synthesize({ text, voice: resolvedVoice, speed: resolvedSpeed, format }); } catch { /* A missing phrase is synthesized on demand later. */ }
      }
    };
    const complete = Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency), texts.length) }, work)).then(() => undefined);
    if (!options.deadlineMs || options.deadlineMs <= 0) { await complete; return; }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([complete, new Promise<void>((resolve) => { timeout = setTimeout(resolve, options.deadlineMs); })]);
    if (timeout) clearTimeout(timeout);
  }

  /** Synthesizes the fixed phrases once so the instant acknowledgements and the closing line are ready before they are needed. */
  /** One at a time, outside the speculative in-flight cap, so startup never drops a phrase or competes with a live turn. */
  async prefetchStatic(): Promise<void> {
    await this.prefetchStaticFor(undefined, undefined, { concurrency: 1 });
  }
}
