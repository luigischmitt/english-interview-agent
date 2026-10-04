// Tiny batched, fire-and-forget reporter of content-free audio diagnostics (POST /api/v1/client-events).
// It never throws and never blocks playback: events are queued, flushed after a short debounce (or at the batch
// limit) and dropped silently if the request fails.

import { detectPlatform } from "./client-environment.mjs";

export const DIAGNOSTICS_BATCH_LIMIT = 20;
export const DIAGNOSTICS_DEBOUNCE_MS = 1_000;
// Bounds memory if the network is down for a long time.
const MAX_QUEUED = 100;

/**
 * @param {{ send: (events: object[]) => unknown, debounceMs?: number, batchLimit?: number, platform?: string,
 *   setTimeout?: Function, clearTimeout?: Function, now?: () => number }} options
 */
export function createDiagnosticsReporter({ send, debounceMs = DIAGNOSTICS_DEBOUNCE_MS, batchLimit = DIAGNOSTICS_BATCH_LIMIT, platform, setTimeout: schedule = (callback, delay) => globalThis.setTimeout(callback, delay), clearTimeout: unschedule = (id) => globalThis.clearTimeout(id) }) {
  let queue = [];
  let timer = null;
  const basePlatform = platform;

  const flush = () => {
    if (timer !== null) { try { unschedule(timer); } catch { /* Best effort. */ } timer = null; }
    while (queue.length) {
      const batch = queue.slice(0, batchLimit);
      queue = queue.slice(batchLimit);
      try {
        void Promise.resolve(send(batch)).catch(() => {});
      } catch { /* Diagnostics must never throw. */ }
    }
  };

  return {
    report(event) {
      try {
        if (!event || typeof event.kind !== "string") return;
        queue.push({ platform: basePlatform ?? detectPlatform(), ...event });
        if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED);
        if (queue.length >= batchLimit) { flush(); return; }
        if (timer === null) timer = schedule(flush, debounceMs);
      } catch { /* Diagnostics must never throw. */ }
    },
    flush,
    get pending() { return queue.length; },
  };
}
