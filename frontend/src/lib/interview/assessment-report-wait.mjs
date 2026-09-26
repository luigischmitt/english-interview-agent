/** Give assessments already in flight time to finish before requesting the report. */
export async function waitForPendingAssessments(readPendingCount, { timeoutMs = 10_000, pollMs = 100 } = {}) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (readPendingCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  return readPendingCount();
}

/** Include Azure summary changes in the idempotency key for feedback upserts. */
export function createFeedbackPersistenceSignature({ sessionId, status, result, azureSummary }) {
  return JSON.stringify({ sessionId, status, result: status === "ready" ? result : null, azure: azureSummary });
}
