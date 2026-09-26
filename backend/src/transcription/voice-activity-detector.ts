export type VadConfig = {
  speechThreshold: number;
  silenceThreshold: number;
  minimumSpeechMs: number;
  trailingSilenceMs: number;
  resumedSpeechConfirmationMs: number;
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
  private readonly midBandSamples: Array<{ level: number; at: number }> = [];
  private lastUpdatedAt = 0;

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
      this.midBandSamples.length = 0;
      this.resumedSpeechCandidateStartedAt ??= now;
      if (now - this.resumedSpeechCandidateStartedAt >= this.config.resumedSpeechConfirmationMs) {
        this.silenceStartedAt = null;
        this.resumedSpeechCandidateStartedAt = null;
        this.resumedActivityCandidateStartedAt = null;
        this.midBandStartedAt = null;
      }
    } else if (level >= this.config.silenceThreshold) {
      this.resumedActivityCandidateStartedAt ??= now;
      this.midBandSamples.push({ level, at: now });
      while (this.midBandSamples.length && now - this.midBandSamples[0].at > 1_000) this.midBandSamples.shift();
      const levels = this.midBandSamples.map((sample) => sample.level);
      const levelRange = levels.length ? Math.max(...levels) - Math.min(...levels) : Infinity;
      // Only use the fallback when a full second of mid-band activity is
      // nearly constant. Variation is treated as potentially quiet speech.
      if (levels.length < 10 || levelRange <= 0.0015) this.midBandStartedAt ??= now;
      else this.midBandStartedAt = null;
      if (now - this.resumedActivityCandidateStartedAt >= this.config.resumedSpeechConfirmationMs) {
        // Sustained low-level voice/activity cancels a pending silence decision.
        this.silenceStartedAt = null;
        this.resumedActivityCandidateStartedAt = null;
      }
    } else {
      this.resumedSpeechCandidateStartedAt = null;
      this.resumedActivityCandidateStartedAt = null;
      this.midBandStartedAt = null;
      this.midBandSamples.length = 0;
    }

    if (level < this.config.silenceThreshold) {
      this.silenceStartedAt ??= now;
    }

    const duration = now - this.speechStartedAt;
    return {
      speechStarted: false,
      shouldFinalize: duration >= this.config.minimumSpeechMs
        && ((this.silenceStartedAt !== null
          && this.resumedSpeechCandidateStartedAt === null
          && this.resumedActivityCandidateStartedAt === null
          && now - this.silenceStartedAt >= this.config.trailingSilenceMs)
          || (this.midBandStartedAt !== null && now - this.midBandStartedAt >= 5_800)),
    };
  }

  get hasSpeech(): boolean {
    return this.speechStartedAt !== null;
  }

  get speechDurationMs(): number {
    return this.speechStartedAt === null ? 0 : Math.max(0, this.lastUpdatedAt - this.speechStartedAt);
  }
}
