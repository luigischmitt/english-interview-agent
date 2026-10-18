import test from "node:test";
import assert from "node:assert/strict";
import { voiceDeliveryInterpretation, voiceMetricInterpretation } from "../src/lib/interview/voice-report-insights.mjs";

const metric = (mean, totalDurationMs = 25_000) => ({ mean, sampleCount: 1, totalDurationMs });

test("interprets voice metrics with the shared good, attention, and focus levels", () => {
  assert.match(voiceMetricInterpretation("accuracy", metric(80)), /próximos/u);
  assert.match(voiceMetricInterpretation("fluency", metric(60)), /oscilou/u);
  assert.match(voiceMetricInterpretation("prosody", metric(59)), /palavra-chave/u);
  assert.doesNotMatch(voiceMetricInterpretation("prosody", metric(59)), /sotaque/u);
});

test("withholds a metric interpretation when assessed audio is insufficient", () => {
  assert.match(voiceMetricInterpretation("accuracy", metric(72, 4_000)), /áudio avaliado suficiente/u);
});

test("describes pace, pauses, and the filler words actually used", () => {
  const result = voiceDeliveryInterpretation([
    { delivery: { wordsPerMinute: 176, pauseCount: 4, longestPauseMs: 2_000, fillerCount: 3, fillers: { um: 2, like: 1 } } },
  ]);
  assert.equal(result?.wordsPerMinute, 176);
  assert.match(result?.insight ?? "", /acelerado/u);
  assert.match(result?.insight ?? "", /pausas/u);
  assert.deepEqual(result?.insights.find((item) => item.values)?.values, { fillers: "“um”, “like”" });
});

test("only calls out pauses when an answer has a pause of at least two seconds", () => {
  const shortPause = voiceDeliveryInterpretation([
    { delivery: { wordsPerMinute: 130, pauseCount: 5, longestPauseMs: 1_300 } },
  ]);
  assert.doesNotMatch(shortPause?.insight ?? "", /interromper a linha de raciocínio/u);

  const longPause = voiceDeliveryInterpretation([
    { delivery: { wordsPerMinute: 130, pauseCount: 1, longestPauseMs: 2_000 } },
  ]);
  assert.match(longPause?.insight ?? "", /interromper a linha de raciocínio/u);
});

test("does not invent delivery feedback when speaking speed is unavailable", () => {
  assert.equal(voiceDeliveryInterpretation([{ delivery: { pauseCount: 4, fillers: { um: 1 } } }]), null);
});
