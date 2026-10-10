// Submit-time wait for the backend verdict of a follow-up candidate revision that was still being judged when the answer
// completed. Resolved by the status message; bounded by the caller's remaining budget. Content-free: only revisions.

export function createCandidateStatusWait() {
  const waiters = new Set();
  return {
    /** A status for `revision` arrived: resolves its waiters with true. */
    notify(revision) {
      for (const waiter of [...waiters]) if (waiter.revision === revision) waiter.resolve(true);
    },
    /** Resolves true when `notify(revision)` is called within `timeoutMs`; false on timeout or abort. */
    async wait(revision, timeoutMs, { signal, timers = globalThis } = {}) {
      if (signal?.aborted) return false;
      let timeoutId;
      let onAbort;
      let waiter;
      const outcome = new Promise((resolve) => {
        waiter = { revision, resolve };
        waiters.add(waiter);
        timeoutId = timers.setTimeout(() => resolve(false), Math.max(0, timeoutMs));
        onAbort = () => resolve(false);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      try { return await outcome; } finally {
        waiters.delete(waiter);
        timers.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** The wait applies when the answer completed with a check in flight for this turn and that revision's verdict is unknown. */
export function shouldWaitForCandidateStatus({ pendingFollowUpCheck, currentTurnId, readyValues, hasStatus, accepted }) {
  if (!pendingFollowUpCheck || pendingFollowUpCheck.turnId !== currentTurnId) return false;
  if (hasStatus) return false;
  return readyValues.some((value) => value?.decision?.decision === "FOLLOW_UP" && value.turnId === currentTurnId
    && value.revision === pendingFollowUpCheck.revision && value.followUpReleased !== true && !accepted(value));
}
