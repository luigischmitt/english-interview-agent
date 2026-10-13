/** Continues practice synchronization in bounded batches and stops on failures. */
export async function syncPracticeGroupsUntilDone(themes, { maxBatches, sync, onBatch, shouldContinue = () => true }) {
  let current = themes;

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    if (!shouldContinue()) return;

    let result;
    try {
      result = await sync(current);
    } catch {
      return;
    }
    if (!shouldContinue()) return;

    onBatch?.(result, batch);
    if (!result?.ok || !result.value.remaining) return;
    current = result.value.themes;
  }
}
