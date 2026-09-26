export type VadConfig = {
  speechThreshold: number;
  silenceThreshold: number;
  minimumSpeechMs: number;
  trailingSilenceMs: number;
  resumedSpeechConfirmationMs: number;
  ambientActivityHoldMs: number;
  maxDurationMs: number;
  maxBytes: number;
};

export const defaultVadConfig: VadConfig = {
  speechThreshold: 0.025,
  silenceThreshold: 0.018,
  minimumSpeechMs: 600,
  // Interview answers often include a short thinking pause between clauses.
  // Preserve thinking pauses while keeping response handoff reasonably quick.
  trailingSilenceMs: 3_500,
  // Brief noise must not reset the full silence timer.
  resumedSpeechConfirmationMs: 300,
  // Ambiguous mid-band energy can be quiet speech or changing room noise.
  // Preserve a pause briefly, then make the handoff bounded if it never clears.
  ambientActivityHoldMs: 8_000,
  maxDurationMs: 180_000,
  maxBytes: 6 * 1024 * 1024,
};

export function getSilenceThreshold(speechThreshold: number): number {
  return Math.max(0.012, Math.min(0.12, speechThreshold * 0.65));
}

export type VadUpdate = { speechStarted: boolean; shouldFinalize: boolean };

export class VoiceActivityDetector {
  private speechCandidateStartedAt: number | null = null;
  private speechStartedAt: number | null = null;
  private silenceStartedAt: number | null = null;
  private resumedSpeechCandidateStartedAt: number | null = null;
  private resumedActivityCandidateStartedAt: number | null = null;
  private midBandStartedAt: number | null = null;
  private lastUpdatedAt = 0;
  private finalizationReasonValue: "silence" | "ambient_activity" | null = null;

  constructor(private readonly config: VadConfig = defaultVadConfig) {}

  update(level: number, now: number): VadUpdate {
    if (!Number.isFinite(level) || level < 0) return { speechStarted: false, shouldFinalize: false };
    this.lastUpdatedAt = now;

    if (this.speechStartedAt === null) {
      if (level >= this.config.speechThreshold) {
        this.speechCandidateStartedAt ??= now;
        if (now - this.speechCandidateStartedAt >= 200) {
          this.speechStartedAt = this.speechCandidateStartedAt;
          return { speechStarted: true, shouldFinalize: false };
        }
      } else {
        this.speechCandidateStartedAt = null;
      }
      return { speechStarted: false, shouldFinalize: false };
    }

    if (level >= this.config.speechThreshold) {
      // A single speech-level frame makes the fallback ambiguous. Do not wait
      // for the normal 300 ms speech confirmation before disabling it.
      this.midBandStartedAt = null;
      this.resumedSpeechCandidateStartedAt ??= now;
      if (now - this.resumedSpeechCandidateStartedAt >= this.config.resumedSpeechConfirmationMs) {
        this.silenceStartedAt = null;
        this.resumedSpeechCandidateStartedAt = null;
        this.resumedActivityCandidateStartedAt = null;
        this.midBandStartedAt = null;
      }
    } else if (level >= this.config.silenceThreshold) {
      this.resumedActivityCandidateStartedAt ??= now;
      if (now - this.resumedActivityCandidateStartedAt >= this.config.resumedSpeechConfirmationMs) {
        // Mid-band energy is ambiguous: it may be a reflective pause with room
        // noise, or quiet speech. Give it a finite grace period. Variable noise
        // must not keep a response open indefinitely.
        this.silenceStartedAt = null;
        this.midBandStartedAt ??= this.resumedActivityCandidateStartedAt;
        this.resumedActivityCandidateStartedAt = null;
      }
    } else {
      this.resumedSpeechCandidateStartedAt = null;
      this.resumedActivityCandidateStartedAt = null;
      this.midBandStartedAt = null;
    }

    if (level < this.config.silenceThreshold) {
      this.silenceStartedAt ??= now;
    }

    const duration = now - this.speechStartedAt;
    const silenceFinalized = duration >= this.config.minimumSpeechMs
      && this.silenceStartedAt !== null
      && this.resumedSpeechCandidateStartedAt === null
      && this.resumedActivityCandidateStartedAt === null
      && now - this.silenceStartedAt >= this.config.trailingSilenceMs;
    const ambientFinalized = duration >= this.config.minimumSpeechMs
      && this.midBandStartedAt !== null
      && now - this.midBandStartedAt >= this.config.ambientActivityHoldMs;
    if (silenceFinalized) this.finalizationReasonValue = "silence";
    else if (ambientFinalized) this.finalizationReasonValue = "ambient_activity";
    return {
      speechStarted: false,
      shouldFinalize: silenceFinalized || ambientFinalized,
    };
  }

  get hasSpeech(): boolean {
    return this.speechStartedAt !== null;
  }

  get speechDurationMs(): number {
    return this.speechStartedAt === null ? 0 : Math.max(0, this.lastUpdatedAt - this.speechStartedAt);
  }

  get finalizationReason(): "silence" | "ambient_activity" | null {
    return this.finalizationReasonValue;
  }

  get ambientActivityHoldMs(): number {
    return this.midBandStartedAt === null ? 0 : Math.max(0, this.lastUpdatedAt - this.midBandStartedAt);
  }
}
