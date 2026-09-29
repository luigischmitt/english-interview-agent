export const openingTimingStorageKey = "english-interview:opening-timing";

export function isOpeningTimingEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(openingTimingStorageKey) === "1";
  } catch {
    return false;
  }
}

export function createOpeningSpeechTiming({ now = () => performance.now(), onComplete = () => {} } = {}) {
  const marks = {};
  let completed = false;
  const stages = ["synthesis-started", "synthesis-completed", "playback-started"];

  return {
    mark(stage) {
      if (completed || !stages.includes(stage) || Number.isFinite(marks[stage])) return;
      marks[stage] = now();
      if (stage !== "playback-started" || !Number.isFinite(marks["synthesis-started"]) || !Number.isFinite(marks["synthesis-completed"])) return;
      completed = true;

      onComplete({
        synthesisMs: Math.max(0, Math.round(marks["synthesis-completed"] - marks["synthesis-started"])),
        playbackStartMs: Math.max(0, Math.round(marks["playback-started"] - marks["synthesis-completed"])),
      });
    },
  };
}
