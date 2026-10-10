export function createCandidateStatusWait(): {
  notify(revision: number): void;
  wait(revision: number, timeoutMs: number, options?: { signal?: AbortSignal; timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } }): Promise<boolean>;
};
export function shouldWaitForCandidateStatus<T>(input: {
  pendingFollowUpCheck: { turnId: string; revision: number } | null;
  currentTurnId: string;
  readyValues: T[];
  hasStatus: boolean;
  accepted: (value: T) => boolean;
}): boolean;
