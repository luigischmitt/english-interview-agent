// Speculative preparation of the next interviewer turn while the backend is still waiting out its answer grace.
// Only the latest provisional transcript is kept. A preparation is used only when the final transcript equals the
// provisional one (after trim) and the decision inputs are identical; anything else is discarded. Transcripts and
// decisions are never logged: `stats()` exposes counts only.

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createNextTurnPreparationRegistry() {
  let current = null;
  let used = 0;
  let discarded = 0;

  const discard = (entry) => {
    if (entry.settled === "discarded" || entry.used) return;
    entry.settled = "discarded";
    discarded += 1;
    entry.controller.abort();
    entry.cleanup?.();
  };

  return {
    /**
     * Starts a preparation, aborting and discarding the previous one. `run(signal, onCleanup)` resolves with the prepared
     * value (or null/throws when unavailable); `onCleanup(fn)` registers work to undo if the entry is discarded unused.
     */
    prepare({ transcript, inputKey, run }) {
      const text = normalize(transcript);
      if (current) discard(current);
      current = null;
      if (!text) return null;
      const controller = new AbortController();
      const entry = { transcript: text, inputKey: inputKey ?? "", controller, settled: "pending", used: false, value: null, cleanup: null };
      let started;
      try {
        started = Promise.resolve(run(controller.signal, (cleanup) => { entry.cleanup = cleanup; }));
      } catch (error) {
        started = Promise.reject(error);
      }
      entry.promise = started
        .then((value) => {
          if (controller.signal.aborted || value == null) { entry.settled = entry.settled === "discarded" ? "discarded" : "failed"; return null; }
          entry.settled = "ready";
          entry.value = value;
          return value;
        }, () => {
          if (entry.settled === "pending") entry.settled = "failed";
          return null;
        });
      current = entry;
      return entry;
    },

    /** Aborts and discards the current preparation (speech resumed, new turn, leave, unmount). */
    abort() {
      if (!current) return;
      const entry = current;
      current = null;
      discard(entry);
    },

    /**
     * Claims the preparation for the final transcript. Returns the entry (pending or ready; await `entry.promise`) when the
     * transcript and inputs match, otherwise discards whatever was prepared and returns null.
     */
    take({ transcript, inputKey }) {
      const entry = current;
      current = null;
      if (!entry) return null;
      if (entry.settled === "discarded" || entry.settled === "failed"
        || entry.transcript !== normalize(transcript) || entry.inputKey !== (inputKey ?? "")) {
        discard(entry);
        return null;
      }
      entry.used = true;
      used += 1;
      return entry;
    },

    /** Claims only an already-ready preparation. Closing never waits for speculative model or speech work. */
    takeReady({ transcript, inputKey }) {
      if (current?.settled !== "ready") {
        if (current) { const entry = current; current = null; discard(entry); }
        return null;
      }
      return this.take({ transcript, inputKey });
    },

    /** The prepared value was unusable after all (it resolved to nothing): count it as discarded instead of used. */
    release(entry) {
      if (!entry?.used) return;
      entry.used = false;
      used -= 1;
      discard(entry);
    },

    hasPending() {
      return current !== null;
    },

    stats() {
      return { used, discarded };
    },
  };
}
