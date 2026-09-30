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
