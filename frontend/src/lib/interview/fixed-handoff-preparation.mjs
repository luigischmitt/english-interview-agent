// Content-free lifecycle for the predictable NEXT path. Text only reaches the supplied speech prewarmer; diagnostics
// expose counts, timings and an ephemeral turn id, never questions or interview content.

export const FIXED_HANDOFF_RETAIN_MS = 4 * 60_000;

export function createFixedHandoffPreparationRegistry({ now = () => Date.now(), createTurnId = () => crypto.randomUUID() } = {}) {
  let current = null;

  const cancelEntry = (entry) => {
    if (!entry || entry.cancelled || entry.used) return;
    entry.cancelled = true;
    for (const handle of entry.handles) handle.cancel();
  };

  return {
    begin({ voiceKey = "", transition, questions, prepareSpeech }) {
      cancelEntry(current);
      const startedAt = now();
      const items = [
        ...(transition ? [{ text: transition, planned: false }] : []),
        ...questions.map((question) => ({ text: question.prompt, planned: true })),
      ];
      const entry = {
        turnId: createTurnId(), voiceKey, transition, questions: [...questions], startedAt,
        readyAt: null, readyCount: 0, settledCount: 0, failedCount: 0, cancelled: false, used: false, handles: [],
      };
      entry.handles = items.map((item) => {
        const handle = prepareSpeech(item.text);
        void handle.promise.then((ready) => {
          if (entry.cancelled) return;
          entry.settledCount += 1;
          if (ready && item.planned) entry.readyCount += 1;
          if (!ready) entry.failedCount += 1;
          if (entry.settledCount === items.length) entry.readyAt = now();
        });
        return handle;
      });
      current = entry;
      return entry;
    },

    take({ turnId, voiceKey = "" }) {
      const entry = current;
      current = null;
      if (!entry || entry.turnId !== turnId || entry.voiceKey !== voiceKey || entry.cancelled) {
        cancelEntry(entry);
        return null;
      }
      entry.used = true;
      return entry;
    },

    peek() { return current; },
    cancel() { const entry = current; current = null; cancelEntry(entry); return entry; },
    metrics(entry, completedAt = now()) {
      return {
        turnId: entry.turnId,
        plannedCount: entry.questions.length,
        readyCount: entry.readyCount,
        startedBeforeCompleteMs: Math.max(0, completedAt - entry.startedAt),
        readyBeforeCompleteMs: entry.readyAt === null ? 0 : Math.max(0, completedAt - entry.readyAt),
      };
    },
  };
}
