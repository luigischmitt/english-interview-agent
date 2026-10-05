/** Time allowed at the end of the interview for background turn analyses to settle. */
export const turnAnalysisWaitMs = 12_000;

/**
 * Wait (bounded) for the per-answer analyses started during the interview and
 * decide whether the fast consolidation path can be used.
 *
 * `pendingBySequence` maps each submitted pair's sequenceNumber to a promise that
 * resolves to the analysis, or to a falsy value on failure. Rejections count as
 * failures. The incremental path is only `complete` when every submitted pair has
 * a successful analysis; otherwise the caller must fall back to the full report.
 */
export async function collectTurnAnalyses(turns, pendingBySequence, { timeoutMs = turnAnalysisWaitMs } = {}) {
  const results = new Map();
  const tracked = turns.map((turn) => {
    const pending = pendingBySequence.get(turn.sequenceNumber);
    if (!pending) return Promise.resolve();
    return Promise.resolve(pending).then((analysis) => { results.set(turn.sequenceNumber, analysis); }, () => {});
  });
  let timer;
  await Promise.race([
    Promise.all(tracked),
    new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, timeoutMs)); }),
  ]);
  clearTimeout(timer);

  const analyses = [];
  for (const turn of turns) {
    const analysis = results.get(turn.sequenceNumber);
    if (!analysis) return { complete: false, analyses: [], missing: turns.length - analyses.length };
    analyses.push(analysis);
  }
  return { complete: turns.length > 0, analyses, missing: 0 };
}

/** Delay before the single background retry of a failed per-answer analysis. */
export const turnAnalysisRetryDelayMs = 1_500;
/** Deadline for each analysis re-requested at the end of the interview. */
export const finalTurnAnalysisMs = 30_000;

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Run one background analysis, retrying once after a short delay when it fails.
 * Aborted requests (leave/unmount) are never retried. Resolves to the analysis or null.
 * `analyze(turn, signal)` must reject on failure.
 */
export async function analyzeTurnWithRetry({ turn, analyze, signal, retryDelayMs = turnAnalysisRetryDelayMs, sleep = abortableSleep, onRetry = () => {} }) {
  try {
    return await analyze(turn, signal);
  } catch {
    if (signal?.aborted) return null;
  }
  await sleep(retryDelayMs, signal);
  if (signal?.aborted) return null;
  onRetry();
  try {
    return await analyze(turn, signal);
  } catch {
    return null;
  }
}

/** Wait (bounded) for the background analyses and return whatever succeeded, keyed by sequenceNumber. */
export async function settleTurnAnalyses(turns, pendingBySequence, { timeoutMs = turnAnalysisWaitMs } = {}) {
  const results = new Map();
  await collectTurnAnalyses(turns, new Map(turns.map((turn) => {
    const pending = pendingBySequence.get(turn.sequenceNumber);
    return [turn.sequenceNumber, pending ? Promise.resolve(pending).then((analysis) => { if (analysis) results.set(turn.sequenceNumber, analysis); return analysis; }) : undefined];
  })), { timeoutMs });
  return results;
}

/** Sequence numbers of the turns that still have no analysis, in turn order. */
export function missingSequenceNumbers(turns, analysesBySequence) {
  return turns.filter((turn) => !analysesBySequence.get(turn.sequenceNumber)).map((turn) => turn.sequenceNumber);
}

/**
 * End-of-interview flow. `settled` resolves to the Map of analyses available after the
 * bounded wait. Missing pairs are re-requested in parallel (each bounded by finalAttemptMs);
 * once every pair has an analysis they are consolidated. Only when a pair stays missing or
 * consolidation fails does it fall back to the full report.
 * Returns { result, path, missingAtEnd, recoveredAtEnd }.
 */
export async function resolveReportAtEnd({ turns, settled, analyze, consolidate, fullReport, finalAttemptMs = finalTurnAnalysisMs, signal, onEvent = () => {} }) {
  const analyses = new Map(await settled);
  const missing = missingSequenceNumbers(turns, analyses);
  const missingAtEnd = missing.length;
  let recoveredAtEnd = 0;

  // When more than half of the analyses are missing the provider is likely struggling; one full-report call beats N retries.
  if (missingAtEnd > 0 && missingAtEnd * 2 <= turns.length && !signal?.aborted) {
    const byKey = new Map(turns.map((turn) => [turn.sequenceNumber, turn]));
    await Promise.all(missing.map(async (sequenceNumber) => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), finalAttemptMs);
      try {
        const analysis = await analyze(byKey.get(sequenceNumber), controller.signal);
        if (analysis) { analyses.set(sequenceNumber, analysis); recoveredAtEnd += 1; }
      } catch {
        // stays missing; decided below
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }));
  }

  const stillMissing = missingSequenceNumbers(turns, analyses);
  let result = null;
  let path = "fallback";
  if (turns.length > 0 && stillMissing.length === 0) {
    try {
      onEvent("consolidation_started", { missingAtEnd, recoveredAtEnd });
      result = await consolidate(turns.map((turn) => analyses.get(turn.sequenceNumber)));
      path = "incremental";
    } catch {
      onEvent("consolidation_failed", { missingAtEnd, recoveredAtEnd });
    }
  } else {
    onEvent("incremental_skipped", { missingAtEnd, recoveredAtEnd, stillMissing: stillMissing.length });
  }
  if (!result) result = await fullReport();
  return { result, path, missingAtEnd, recoveredAtEnd };
}
