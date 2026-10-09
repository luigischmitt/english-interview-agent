export type NextTurnPreparationEntry<T> = {
  transcript: string;
  inputKey: string;
  controller: AbortController;
  settled: "pending" | "ready" | "failed" | "discarded";
  used: boolean;
  value: T | null;
  promise: Promise<T | null>;
};

export type NextTurnPreparationRegistry<T> = {
  prepare(input: {
    transcript: string;
    inputKey?: string;
    preserveReady?: boolean;
    preservePending?: boolean;
    maxPending?: number;
    run: (signal: AbortSignal, onCleanup: (cleanup: () => void) => void) => Promise<T | null>;
  }): NextTurnPreparationEntry<T> | null;
  pendingCount(): number;
  abort(): void;
  take(input: { transcript: string; inputKey?: string }): NextTurnPreparationEntry<T> | null;
  takeReady(input: { transcript: string; inputKey?: string }): NextTurnPreparationEntry<T> | null;
  takeAnyReady(input: { accept: (value: T) => boolean }): NextTurnPreparationEntry<T> | null;
  discardWhere(predicate: (value: T) => boolean): number;
  release(entry: NextTurnPreparationEntry<T> | null): void;
  hasPending(): boolean;
  stats(): { used: number; discarded: number };
};

export function createNextTurnPreparationRegistry<T = unknown>(): NextTurnPreparationRegistry<T>;
