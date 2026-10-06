export type VoiceReadinessState = "ready" | "warming" | "unavailable";

export const VOICE_POLL_INTERVAL_MS: number;
export const VOICE_POLL_MAX_MS: number;
export const voiceReadinessCopy: Record<VoiceReadinessState, string>;
export function voiceBlocksInterviewStart(playInterviewerAudio: boolean, state: VoiceReadinessState): boolean;

export function fetchVoiceStatus(
  endpoint: string,
  fetcher: (input: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  signal?: AbortSignal,
): Promise<VoiceReadinessState | null>;

export function startVoiceReadinessPolling(options: {
  fetchStatus: () => Promise<VoiceReadinessState | null>;
  onState: (state: VoiceReadinessState) => void;
  intervalMs?: number;
  maxMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (id: unknown) => void;
}): () => void;
