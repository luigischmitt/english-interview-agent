export const SILENT_AUDIO_URI: string;
export const AUDIO_POOL_SIZE: number;
export function isAutoplayBlockedError(error: unknown): boolean;
export function createAudioPool(options?: { create?: () => HTMLAudioElement; size?: number }): {
  acquire(url: string): HTMLAudioElement;
  release(audio: HTMLAudioElement): void;
  unlock(force?: boolean): boolean;
  readonly isUnlocked: boolean;
};
export function resetSharedAudioPool(): void;
export function acquireSharedAudio(url: string): HTMLAudioElement;
export function releaseSharedAudio(audio: HTMLAudioElement): void;
export function unlockSharedAudio(force?: boolean): boolean;
export function installAudioUnlockOnFirstGesture(target?: Pick<Document, "addEventListener" | "removeEventListener"> | null): () => void;
