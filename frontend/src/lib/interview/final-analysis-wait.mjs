// Bounded wait at submit for the speculative analysis of the FINAL transcript. Its revision is sent only after the tail
// segment is transcribed, so its follow-up usually lands a second or two after the answer completes. A real interviewer
// takes a short, natural pause before a follow-up; the instant acknowledgement ("Okay.") covers it.

/** Total wait for the pending final analysis, counted from submit. */
export const FINAL_ANALYSIS_WAIT_MS = 1_800;
/** Total cap (from submit) for the follow-up decision AND its first audio chunk; past it the fixed question is used. */
export const FOLLOW_UP_TOTAL_WAIT_MS = 3_000;

/** Milliseconds left of a budget counted from `startedAt`. */
export function remainingBudgetMs(totalMs, startedAt, now) {
  return Math.max(0, totalMs - Math.max(0, now - startedAt));
}

const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

/**
 * The pending entry worth waiting for: only the one whose transcript equals the final one. An older revision's follow-up
 * would need an OPEN verdict that can no longer arrive once the answer is final, so waiting for it only adds silence.
 * (`entries` are { transcript, revision, settled }). Returns a predicate for `registry.waitForPending`, or null.
 */
export function pendingFinalAnalysisPredicate(entries, finalTranscript) {
  const exact = entries.some((entry) => entry.settled === "pending" && same(entry.transcript, finalTranscript));
  return exact ? (entry) => same(entry.transcript, finalTranscript) : null;
}

/**
 * Whether submit should wait: normal answer path only (the caller guarantees not clarification / follow-up used / closing),
 * no ready value already accepted as a FOLLOW_UP, and a matching pending preparation exists. Returns the predicate or null.
 */
export function finalAnalysisWaitPredicate({ eligible, entries, readyValues, acceptFollowUp, finalTranscript }) {
  if (!eligible) return null;
  if (readyValues.some((value) => value?.decision?.decision === "FOLLOW_UP" && acceptFollowUp(value))) return null;
  return pendingFinalAnalysisPredicate(entries, finalTranscript);
}
