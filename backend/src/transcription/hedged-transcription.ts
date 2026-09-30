import type { SlotReservation } from "./streaming-transcription.js";
import type { TranscriptionResult } from "./types.js";

/** Content-free outcome of a hedged call. */
export type HedgeOutcome = "not_needed" | "skipped_no_slot" | "primary_won" | "secondary_won" | "both_failed";

export type HedgedTranscriptionOptions = {
  /** Starts one identical provider call; it must honour the signal. */
  start: (signal: AbortSignal) => Promise<TranscriptionResult>;
  /** Milliseconds before an extra call is considered; a value of 0 or less disables hedging. */
  hedgeAfterMs: number;
  /** Claims one extra concurrency slot right now, or returns null when none is free. */
  tryReserve: () => SlotReservation | null;
  /** Aborts every call and prevents a hedge from starting. */
  signal: AbortSignal;
  /** Called once, when the hedged call settles, with the outcome. */
  onOutcome?: (outcome: HedgeOutcome) => void;
};

/**
 * Runs `start` and, if it is still pending after `hedgeAfterMs`, races one identical second call on an extra slot.
 * Resolves with the first success and aborts the other call. A failure waits for the remaining call; when both fail
 * it rejects with the primary's error so ENG-89 failure categories are preserved.
 */
export function hedgedTranscribe(options: HedgedTranscriptionOptions): Promise<TranscriptionResult> {
  const { start, hedgeAfterMs, tryReserve, signal: parent, onOutcome } = options;
  return new Promise<TranscriptionResult>((resolve, reject) => {
    const primary = new AbortController();
    let secondary: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let skippedNoSlot = false;
    let primaryDone = false;
    let secondaryDone = false;
    let primaryError: unknown;
    let secondaryStarted = false;

    const onParentAbort = () => {
      primary.abort();
      secondary?.abort();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const finish = (outcome: HedgeOutcome) => {
      finished = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      parent.removeEventListener("abort", onParentAbort);
      onOutcome?.(outcome);
    };
    const succeed = (winner: "primary" | "secondary", result: TranscriptionResult) => {
      if (finished) return;
      if (winner === "primary") secondary?.abort();
      else primary.abort();
      finish(!secondaryStarted ? (skippedNoSlot ? "skipped_no_slot" : "not_needed") : winner === "primary" ? "primary_won" : "secondary_won");
      resolve(result);
    };
    const maybeReject = () => {
      if (finished || !primaryDone) return;
      if (secondaryStarted && !secondaryDone) return;
      finish(secondaryStarted ? "both_failed" : skippedNoSlot ? "skipped_no_slot" : "not_needed");
      reject(primaryError);
    };

    if (parent.aborted) primary.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });

    (async () => start(primary.signal))().then(
      (result) => { primaryDone = true; succeed("primary", result); },
      (error) => { primaryDone = true; primaryError = error; maybeReject(); },
    );

    const startSecondary = () => {
      timer = null;
      if (finished || parent.aborted || primaryDone) return;
      const slot = tryReserve();
      if (!slot) {
        skippedNoSlot = true;
        return;
      }
      const controller = new AbortController();
      secondary = controller;
      secondaryStarted = true;
      (async () => start(controller.signal))().then(
        (result) => { secondaryDone = true; slot.release(); succeed("secondary", result); },
        () => { secondaryDone = true; slot.release(); maybeReject(); },
      );
    };

    if (hedgeAfterMs > 0 && !parent.aborted) timer = setTimeout(startSecondary, hedgeAfterMs);
  });
}
