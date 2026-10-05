import type { InterviewOrchestrationInput, InterviewOrchestrationResult } from "../thinking/types.js";
import {
  ACKNOWLEDGEMENT_PHRASES,
  composeAcknowledgedQuestion,
  composeInterviewClosing,
  interviewerChunkTexts,
  isAcknowledgeableAnswer,
  stripLeadingAcknowledgement,
} from "./interviewer-chunking.js";
import type { SpeechCache } from "./speech-cache.js";
import { normalizeTextForSpeech } from "./text-normalization.js";
import type { AudioFormat } from "./types.js";
import { resolveVoice } from "./voices.js";

/** Texts that never change (acknowledgements, the closing line): cached longer and synthesized ahead of the interview. */
export function staticSpeechTexts(): string[] {
  return [...ACKNOWLEDGEMENT_PHRASES, ...interviewerChunkTexts(composeInterviewClosing())].map((text) => normalizeTextForSpeech(text.trim()));
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
  prefetchDecision(input: Pick<InterviewOrchestrationInput, "transcript">, result: InterviewOrchestrationResult, voice?: unknown): void {
    try {
      const utterance = this.utteranceFor(input, result);
      if (utterance) this.prefetchUtterance(utterance, voice);
    } catch { /* Prefetching never affects the decision response. */ }
  }

  prefetchUtterance(utterance: string, voice?: unknown): void {
    for (const text of interviewerChunkTexts(utterance).slice(0, this.options.chunks)) this.prefetchText(text, voice);
  }

  prefetchText(text: string, voice?: unknown): void {
    const { cache, speed, format } = this.options;
    cache.prefetch({ text: normalizeTextForSpeech(text.trim()), voice: resolveVoice(voice, this.options.voice), speed, format });
  }

  /** Synthesizes the fixed phrases once so the instant acknowledgements and the closing line are ready before they are needed. */
  /** One at a time, outside the speculative in-flight cap, so startup never drops a phrase or competes with a live turn. */
  async prefetchStatic(): Promise<void> {
    const { cache, speed, format } = this.options;
    for (const text of staticSpeechTexts()) {
      try {
        await cache.synthesize({ text: normalizeTextForSpeech(text.trim()), voice: resolveVoice(undefined, this.options.voice), speed, format });
      } catch { /* A missing phrase is synthesized on demand later. */ }
    }
  }
}
