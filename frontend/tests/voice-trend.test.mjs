import assert from "node:assert/strict";
import test from "node:test";

import { mergeVoiceSeries, voiceMetricSummary, voiceTrendDomain } from "../src/lib/interview/voice-trend.mjs";

const point = (id, date, value) => ({ id, date, label: id, value });

test("joins the three metrics per interview in chronological order and keeps gaps as null", () => {
  const rows = mergeVoiceSeries({
    accuracy: [point("a", "2026-10-01", 80), point("b", "2026-10-05", 84)],
    fluency: [point("b", "2026-10-05", 76)],
    prosody: [point("c", "2026-10-09", 70), point("a", "2026-10-01", 66)],
  });
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"]);
  assert.deepEqual(rows[0].values, { accuracy: 80, fluency: null, prosody: 66 });
  assert.deepEqual(rows[2].values, { accuracy: null, fluency: null, prosody: 70 });
});

test("domain starts a round step below the lowest value and ends at 100", () => {
  const rows = mergeVoiceSeries({ accuracy: [point("a", "2026-10-01", 88)], prosody: [point("a", "2026-10-01", 63)] });
  assert.deepEqual(voiceTrendDomain(rows), [50, 100]);
  assert.deepEqual(voiceTrendDomain([]), [0, 100]);
});

test("summary reports latest, first and change only when there is more than one value", () => {
  const rows = mergeVoiceSeries({ fluency: [point("a", "2026-10-01", 74), point("b", "2026-10-03", 79.4)] });
  assert.deepEqual(voiceMetricSummary(rows, "fluency"), { latest: 79.4, first: 74, change: 5, count: 2 });
  assert.equal(voiceMetricSummary(rows, "accuracy"), null);
  const single = mergeVoiceSeries({ prosody: [point("a", "2026-10-01", 70)] });
  assert.equal(voiceMetricSummary(single, "prosody").change, null);
});
