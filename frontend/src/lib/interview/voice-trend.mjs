/** The three Azure voice metrics, in the fixed order every chart and legend uses. */
export const voiceTrendMetrics = ["accuracy", "fluency", "prosody"];

export const voiceTrendCopy = {
  accuracy: { label: "Precisão", measure: "Quão próximos os sons ficaram da pronúncia esperada." },
  fluency: { label: "Ritmo", measure: "Fluidez entre palavras e pausas, sem quebras no meio da ideia." },
  prosody: { label: "Prosódia", measure: "Entonação e acento das palavras. Não é nota de sotaque." },
};

const isScore = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Joins the per-metric series (ProgressPoint[] keyed by session id, already chronological) into one row per interview.
 * A metric missing for an interview stays null, so a line never invents a value.
 */
export function mergeVoiceSeries(series) {
  const rows = new Map();
  const order = [];
  for (const metric of voiceTrendMetrics) {
    for (const point of series?.[metric] ?? []) {
      if (!point || typeof point.id !== "string" || !isScore(point.value)) continue;
      if (!rows.has(point.id)) {
        rows.set(point.id, { id: point.id, date: point.date ?? null, label: point.label ?? "", values: { accuracy: null, fluency: null, prosody: null } });
        order.push(point);
      }
      rows.get(point.id).values[metric] = point.value;
    }
  }
  const time = (row) => (row.date ? Date.parse(row.date) : Number.NaN);
  return order
    .map((point) => rows.get(point.id))
    .sort((a, b) => (Number.isFinite(time(a)) && Number.isFinite(time(b)) ? time(a) - time(b) : 0));
}

/** Y domain for the trend: starts at a round 10 below the lowest value (never below 0) and ends at 100. */
export function voiceTrendDomain(rows) {
  const values = rows.flatMap((row) => voiceTrendMetrics.map((metric) => row.values[metric])).filter(isScore);
  if (!values.length) return [0, 100];
  const low = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  return [Math.min(low, 90), 100];
}

/** Latest value, first value and the change between them for one metric (null when it has fewer than one point). */
export function voiceMetricSummary(rows, metric) {
  const values = rows.map((row) => row.values[metric]).filter(isScore);
  if (!values.length) return null;
  const first = values[0];
  const latest = values[values.length - 1];
  return { latest, first, change: values.length > 1 ? Math.round(latest - first) : null, count: values.length };
}
