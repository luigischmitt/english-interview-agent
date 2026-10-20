export async function requestPersistedReport(interviewId, azureSummary, locale, fetcher, endpoint) {
  const response = await fetcher(`${endpoint}/api/v1/thinking/report/interview/${encodeURIComponent(interviewId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale, azureSummary }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "ready" || !body.report) {
    throw new Error(body?.error?.message ?? "Não foi possível gerar o relatório agora. Tente novamente.");
  }
  return body.report;
}
