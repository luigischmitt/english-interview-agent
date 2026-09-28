/** Versioned synthetic references for repeatable transcription checks. Text is sent only to local TTS. */
export type TranscriptionEvaluationCase = {
  key: string;
  reference: string;
  profile: "technical" | "acronyms" | "numbers" | "pauses" | "self-correction" | "quiet" | "noise" | "short" | "long";
};

export const transcriptionEvaluationCorpus: readonly TranscriptionEvaluationCase[] = [
  { key: "technical", profile: "technical", reference: "I would add an idempotency key to the REST API, store it in PostgreSQL, and use Redis only for short lived cache entries." },
  { key: "acronyms", profile: "acronyms", reference: "Our SRE team reviewed the SLA, then added tracing with OpenTelemetry and alerts in Grafana." },
  { key: "numbers", profile: "numbers", reference: "We reduced p ninety nine latency from four hundred milliseconds to one hundred and twenty milliseconds across three regions." },
  { key: "pauses", profile: "pauses", reference: "I would first check the logs. Then I would compare the query plan before changing the database." },
  { key: "self-correction", profile: "self-correction", reference: "I owned the migration, actually I mean I coordinated it with the platform team, and we rolled it out gradually." },
  { key: "quiet", profile: "quiet", reference: "I would isolate the failing service, inspect its dependencies, and restore traffic after the health checks pass." },
  { key: "noise", profile: "noise", reference: "The queue gives us back pressure, while a dead letter queue keeps failed messages available for investigation." },
  { key: "short", profile: "short", reference: "I fixed the cache." },
  { key: "long", profile: "long", reference: "In my last role, I improved a slow reporting service used by our support team. I reviewed query plans, added indexes supported by production data, and removed a repeated request with the frontend team. We measured the change with realistic workloads, released it gradually, watched error rates and latency, and documented the results. Response time fell from about four seconds to under one second. I shared those measurements with the team so they could guide the next reliability improvements." },
];

export function getTranscriptionEvaluationCase(key: string): TranscriptionEvaluationCase | undefined {
  return transcriptionEvaluationCorpus.find((item) => item.key === key);
}
