import assert from "node:assert/strict";
import test from "node:test";
import { fetchVoiceStatus, startVoiceReadinessPolling, voiceReadinessCopy } from "../src/lib/interview/voice-readiness.mjs";

function harness(results, { maxMs = 120_000 } = {}) {
  let time = 0;
  const timers = [];
  const states = [];
  let calls = 0;
  const stop = startVoiceReadinessPolling({
    fetchStatus: async () => { calls += 1; return results.length > 1 ? results.shift() : results[0]; },
    onState: (state) => states.push(state),
    maxMs,
    now: () => time,
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => { timers.length = 0; },
  });
  const advance = async () => {
    await new Promise((r) => setImmediate(r));
    const next = timers.shift();
    if (next) { time += next.delay; next.callback(); await new Promise((r) => setImmediate(r)); }
  };
  return { stop, states, timers, advance, calls: () => calls };
}

test("polls every 3 s while warming and stops once ready", async () => {
  const h = harness(["warming", "warming", "ready"]);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.timers[0].delay, 3_000);
  await h.advance(); await h.advance();
  assert.deepEqual(h.states, ["warming", "ready"]);
  assert.equal(h.timers.length, 0);
  assert.equal(h.calls(), 3);
});

test("shows the fallback message on unavailable, keeps polling, and recovers", async () => {
  const h = harness(["unavailable", "ready"]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.states, ["warming", "unavailable"]);
  await h.advance();
  assert.deepEqual(h.states, ["warming", "unavailable", "ready"]);
});

test("a null result keeps the previous state and gives up as unavailable after maxMs", async () => {
  const h = harness([null], { maxMs: 9_000 });
  await h.advance(); await h.advance(); await h.advance();
  assert.deepEqual(h.states, ["warming", "unavailable"]);
  assert.equal(h.timers.length, 0);
});

test("stop cancels the pending poll and ignores late results", async () => {
  const h = harness(["warming"]);
  await new Promise((r) => setImmediate(r));
  h.stop();
  assert.equal(h.timers.length, 0);
  assert.deepEqual(h.states, ["warming"]);
});

test("fetchVoiceStatus validates the response and never rejects", async () => {
  const ok = (voice) => async () => ({ ok: true, json: async () => ({ voice }) });
  assert.equal(await fetchVoiceStatus("/s", ok("ready")), "ready");
  assert.equal(await fetchVoiceStatus("/s", ok("weird")), null);
  assert.equal(await fetchVoiceStatus("/s", async () => ({ ok: false, json: async () => ({}) })), null);
  assert.equal(await fetchVoiceStatus("/s", async () => { throw new Error("net"); }), null);
  let url;
  await fetchVoiceStatus("http://b/api/v1/speech", async (u) => { url = u; return { ok: true, json: async () => ({}) }; });
  assert.equal(url, "http://b/api/v1/speech/warmup-status");
});

test("copy is in Portuguese for every state", () => {
  assert.match(voiceReadinessCopy.warming, /1 minuto/);
  assert.match(voiceReadinessCopy.ready, /pronta/);
  assert.match(voiceReadinessCopy.unavailable, /voz do navegador/);
});
