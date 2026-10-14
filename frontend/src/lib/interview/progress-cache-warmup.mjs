/** Refresh the dashboard's progress cache after a successful report save, without surfacing background failures. */
export function warmProgressCacheAfterFeedbackSave(result, loadProgressRecords) {
  if (result?.ok !== true || typeof loadProgressRecords !== "function") return;
  void Promise.resolve().then(loadProgressRecords).catch(() => {});
}
