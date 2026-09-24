export type VadConfig = {
  speechThreshold: number;
  silenceThreshold: number;
  minimumSpeechMs: number;
  trailingSilenceMs: number;
  maxDurationMs: number;
  maxBytes: number;
};

export const defaultVadConfig: VadConfig = {
  speechThreshold: 0.025,
  silenceThreshold: 0.018,
  minimumSpeechMs: 600,
  trailingSilenceMs: 1_500,
  maxDurationMs: 30_000,
  maxBytes: 4 * 1024 * 1024,
};

export function getSilenceThreshold(speechThreshold: number): number {
  return Math.max(0.012, Math.min(0.12, speechThreshold * 0.65));
}

export type VadUpdate = { speechStarted: boolean; shouldFinalize: boolean };

export class VoiceActivityDetector {
  private speechCandidateStartedAt: number | null = null;
  private speechStartedAt: number | null = null;
  private silenceStartedAt: number | null = null;
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

    if (level < this.config.silenceThreshold) {
      this.silenceStartedAt ??= now;
    } else {
      this.silenceStartedAt = null;
    }

    const duration = now - this.speechStartedAt;
    return {
      speechStarted: false,
      shouldFinalize: duration >= this.config.minimumSpeechMs
        && this.silenceStartedAt !== null
        && now - this.silenceStartedAt >= this.config.trailingSilenceMs,
    };
  }

  get hasSpeech(): boolean {
    return this.speechStartedAt !== null;
  }

  get speechDurationMs(): number {
    return this.speechStartedAt === null ? 0 : Math.max(0, this.lastUpdatedAt - this.speechStartedAt);
  }
}
