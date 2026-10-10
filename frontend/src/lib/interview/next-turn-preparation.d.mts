export type NextTurnPreparationEntry<T> = {
  transcript: string;
  inputKey: string;
  revision: number;
  controller: AbortController;
  settled: "pending" | "ready" | "failed" | "discarded";
  used: boolean;
  viaFallback?: boolean;
  value: T | null;
  promise: Promise<T | null>;
};

export type NextTurnPreparationRegistry<T> = {
  prepare(input: {
    transcript: string;
    inputKey?: string;
    revision?: number;
    preserveReady?: boolean;
    preservePending?: boolean;
    maxPending?: number;
    run: (signal: AbortSignal, onCleanup: (cleanup: () => void) => void) => Promise<T | null>;
  }): NextTurnPreparationEntry<T> | null;
  pendingCount(): number;
  abort(): void;
  take(input: { transcript: string; inputKey?: string }): NextTurnPreparationEntry<T> | null;
  takeReady(input: { transcript: string; inputKey?: string }): NextTurnPreparationEntry<T> | null;
  takeAnyReady(input: { accept: (value: T) => boolean; fallbackAccept?: (value: T) => boolean }): NextTurnPreparationEntry<T> | null;
  entries(): Array<{ transcript: string; revision: number; settled: "pending" | "ready" }>;
  waitForPending(
    predicate: (entry: { transcript: string; revision: number }) => boolean,
    timeoutMs: number,
    options?: { signal?: AbortSignal; timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> },
  ): Promise<boolean>;
  readyValues(): T[];
  discardWhere(predicate: (value: T) => boolean): number;
  release(entry: NextTurnPreparationEntry<T> | null): void;
  hasPending(): boolean;
  stats(): { used: number; discarded: number };
};

export function createNextTurnPreparationRegistry<T = unknown>(): NextTurnPreparationRegistry<T>;
