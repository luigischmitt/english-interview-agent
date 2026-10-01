export const handoffTimingStorageKey = "english-interview:handoff-timing";

const timingStages = [
  "finalizingReceived",
  "transcriptionQueued",
  "transcriptionStarted",
  "transcriptionCompleted",
  "decisionStarted",
  "decisionCompleted",
  "synthesisStarted",
  "synthesisCompleted",
  "playbackStarted",
];

function elapsedBetween(marks, start, end) {
  if (!Number.isFinite(marks[start]) || !Number.isFinite(marks[end])) return null;
  return Math.max(0, Math.round(marks[end] - marks[start]));
}

function safeDuration(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

export function isHandoffTimingEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(handoffTimingStorageKey) === "1";
  } catch {
    return false;
  }
}

export function createInterviewHandoffTiming({ speechEndToFinalizationMs = 0, now = () => performance.now(), onComplete = () => {} } = {}) {
  const marks = {};
  const serverVadMs = safeDuration(speechEndToFinalizationMs);
  let completed = false;
  let prepared = false;

  return {
    /** The next turn was decided and pre-synthesized before the final transcript arrived. */
    markPrepared() {
      if (!completed) prepared = true;
    },
    mark(stage) {
      if (completed || !timingStages.includes(stage) || Number.isFinite(marks[stage])) return;
      marks[stage] = now();
      if (stage !== "playbackStarted") return;
      completed = true;

      const queueBoundary = Number.isFinite(marks.transcriptionQueued) ? "transcriptionQueued" : "transcriptionStarted";
      const finalizingToQueueMs = elapsedBetween(marks, "finalizingReceived", queueBoundary) ?? 0;
      const vadFinalizationMs = serverVadMs + finalizingToQueueMs;
      const queueWaitMs = Number.isFinite(marks.transcriptionQueued)
        ? elapsedBetween(marks, "transcriptionQueued", "transcriptionStarted")
        : 0;
      const whisperMs = elapsedBetween(marks, "transcriptionStarted", "transcriptionCompleted");
      const decisionMs = elapsedBetween(marks, "decisionStarted", "decisionCompleted");
      const synthesisMs = elapsedBetween(marks, "synthesisStarted", "synthesisCompleted");
      const playbackStartMs = elapsedBetween(marks, "synthesisCompleted", "playbackStarted");
      const totalMs = serverVadMs + (elapsedBetween(marks, "finalizingReceived", "playbackStarted") ?? 0);
      const measuredStages = [vadFinalizationMs, queueWaitMs, whisperMs, decisionMs, synthesisMs, playbackStartMs]
        .filter((value) => value !== null);
      const unaccountedMs = Math.max(0, totalMs - measuredStages.reduce((sum, value) => sum + value, 0));

      onComplete({
        totalMs,
        vadFinalizationMs,
        queueWaitMs,
        whisperMs,
        decisionMs,
        synthesisMs,
        playbackStartMs,
        unaccountedMs,
        prepared,
      });
    },
  };
}

/**
 * Zero-wait handoff metric (content-free): milliseconds from the interviewer's playback ending to the candidate's
 * stream listening. Mark the end when playback completes and the listening instant when the stream is live.
 */
export function createListeningHandoffTiming({ now = () => performance.now(), onComplete = () => {} } = {}) {
  let endedAt = null;
  return {
    markPlaybackEnded() {
      endedAt = now();
    },
    markListening({ preconnected = false } = {}) {
      if (endedAt === null) return;
      const playbackEndedToListeningMs = Math.max(0, Math.round(now() - endedAt));
      endedAt = null;
      onComplete({ playbackEndedToListeningMs, preconnected: preconnected === true });
    },
  };
}
