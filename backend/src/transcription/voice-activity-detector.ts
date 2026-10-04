export type VadConfig = {
  speechThreshold: number;
  silenceThreshold: number;
  minimumSpeechMs: number;
  trailingSilenceMs: number;
  finalizationGraceMs: number;
  resumedSpeechConfirmationMs: number;
  ambientActivityHoldMs: number;
  maxDurationMs: number;
  maxBytes: number;
  /** Silence that counts as a pause (`pauseStarted`); only used by incremental Whisper turn detection. Defaults to 800. */
  pauseMs?: number;
};

export const defaultVadConfig: VadConfig = {
  speechThreshold: 0.025,
  silenceThreshold: 0.018,
  minimumSpeechMs: 600,
  // Interview answers often include a short thinking pause between clauses.
  // Preserve thinking pauses while keeping response handoff reasonably quick.
  trailingSilenceMs: 3_500,
  finalizationGraceMs: 1_500,
  // Brief noise must not reset the full silence timer.
  resumedSpeechConfirmationMs: 300,
  // Ambiguous mid-band energy can be quiet speech or changing room noise.
  // Preserve a pause briefly, then make the handoff bounded if it never clears.
  // Quiet speech may stay below the strong-speech threshold for several
  // seconds. Keep it alive for a bounded interval; silence and the hard
  // response-duration limit still guarantee automatic handoff.
  ambientActivityHoldMs: 8_000,
  maxDurationMs: 180_000,
  maxBytes: 6 * 1024 * 1024,
};

export function getSilenceThreshold(speechThreshold: number): number {
  return Math.max(0.008, Math.min(0.08, speechThreshold * 0.55));
}

export type VadUpdate = { speechStarted: boolean; speechResumed: boolean; shouldFinalize: boolean; pauseStarted: boolean };

export class VoiceActivityDetector {
  private speechCandidateStartedAt: number | null = null;
  private speechStartedAt: number | null = null;
  private lastSpeechActivityAt: number | null = null;
  private silenceStartedAt: number | null = null;
  private resumedSpeechCandidateStartedAt: number | null = null;
  private resumedActivityCandidateStartedAt: number | null = null;
  private midBandStartedAt: number | null = null;
  private pauseSignalledFor: number | null = null;
  private lastUpdatedAt = 0;
  private finalizationReasonValue: "silence" | "ambient_activity" | null = null;

  constructor(private readonly config: VadConfig = defaultVadConfig) {}

  update(level: number, now: number): VadUpdate {
    if (!Number.isFinite(level) || level < 0) return { speechStarted: false, speechResumed: false, shouldFinalize: false, pauseStarted: false };
    this.lastUpdatedAt = now;
    let speechResumed = false;

    if (this.speechStartedAt === null) {
      if (level >= this.config.speechThreshold) {
        this.speechCandidateStartedAt ??= now;
        if (now - this.speechCandidateStartedAt >= 200) {
          this.speechStartedAt = this.speechCandidateStartedAt;
          this.lastSpeechActivityAt = now;
          return { speechStarted: true, speechResumed: false, shouldFinalize: false, pauseStarted: false };
        }
      } else {
        this.speechCandidateStartedAt = null;
      }
      return { speechStarted: false, speechResumed: false, shouldFinalize: false, pauseStarted: false };
    }

    if (level >= this.config.speechThreshold) {
      this.lastSpeechActivityAt = now;
      this.resumedSpeechCandidateStartedAt ??= now;
      if (now - this.resumedSpeechCandidateStartedAt >= this.config.resumedSpeechConfirmationMs) {
        speechResumed = this.silenceStartedAt !== null || this.midBandStartedAt !== null || this.finalizationReasonValue !== null;
        this.silenceStartedAt = null;
        this.resumedSpeechCandidateStartedAt = null;
        this.resumedActivityCandidateStartedAt = null;
        this.midBandStartedAt = null;
        this.finalizationReasonValue = null;
      }
    } else if (level >= this.config.silenceThreshold) {
      // A peak separated by mid-band frames is not sustained speech.
      this.resumedSpeechCandidateStartedAt = null;
      // Once ambient activity has started the reversible handoff, mid-band
      // energy cannot cancel it. Only confirmed strong speech may do that.
      if (this.finalizationReasonValue === "ambient_activity") {
        this.resumedActivityCandidateStartedAt = null;
      } else {
        this.resumedActivityCandidateStartedAt ??= now;
        if (now - this.resumedActivityCandidateStartedAt >= this.config.resumedSpeechConfirmationMs) {
          speechResumed = this.silenceStartedAt !== null || this.finalizationReasonValue !== null;
          // Mid-band energy is ambiguous: it may be a reflective pause with room
          // noise, or quiet speech. Give it a finite grace period. Variable noise
          // must not keep a response open indefinitely.
          this.silenceStartedAt = null;
          this.midBandStartedAt ??= this.resumedActivityCandidateStartedAt;
          this.resumedActivityCandidateStartedAt = null;
          this.finalizationReasonValue = null;
        }
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
    // One signal per silence episode, once the silence has lasted pauseMs (independent of the finalization flags).
    const pauseStarted = duration >= this.config.minimumSpeechMs
      && this.silenceStartedAt !== null
      && this.resumedSpeechCandidateStartedAt === null
      && this.resumedActivityCandidateStartedAt === null
      && this.pauseSignalledFor !== this.silenceStartedAt
      && now - this.silenceStartedAt >= (this.config.pauseMs ?? 800);
    if (pauseStarted) this.pauseSignalledFor = this.silenceStartedAt;
    return {
      speechStarted: false,
      speechResumed,
      shouldFinalize: silenceFinalized || ambientFinalized,
      pauseStarted,
    };
  }

  get hasSpeech(): boolean {
    return this.speechStartedAt !== null;
  }

  get speechThresholdBand(): "minimum" | "calibrated" | "maximum" {
    if (this.config.speechThreshold <= 0.015) return "minimum";
    if (this.config.speechThreshold >= 0.05) return "maximum";
    return "calibrated";
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

  /** Time since the last above-threshold frame at the actual finalize instant. */
  speechEndToFinalizationAt(now: number): number {
    return this.lastSpeechActivityAt === null || !Number.isFinite(now)
      ? 0
      : Math.max(0, now - this.lastSpeechActivityAt);
  }
}
