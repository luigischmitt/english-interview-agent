import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserVoiceAvailable, loadBrowserVoice, pickBrowserVoice, speakWithBrowserVoice } from "../src/lib/interview/browser-voice.mjs";

const voice = (name, lang, extra = {}) => ({ name, lang, ...extra });

test("voice picking prefers natural en-US voices, then other English, and ignores non-English", () => {
  assert.equal(pickBrowserVoice([voice("Thomas", "fr-FR"), voice("Samantha", "en-US"), voice("Fred", "en-US")]).name, "Samantha");
  assert.equal(pickBrowserVoice([voice("Daniel", "en-GB"), voice("Alex", "en-US")]).name, "Alex");
  assert.equal(pickBrowserVoice([voice("Google UK English Female", "en-GB"), voice("Google US English", "en-US")]).name, "Google US English");
  assert.equal(pickBrowserVoice([voice("Daniel", "en-GB"), voice("Alex", "en_US")]).name, "Alex");
  assert.equal(pickBrowserVoice([voice("Microsoft Aria Online (Natural) - English (United States)", "en-US"), voice("Microsoft David", "en-US")]).name, "Microsoft Aria Online (Natural) - English (United States)");
  assert.equal(pickBrowserVoice([voice("Ava (Premium)", "en-US"), voice("Allison", "en-US")]).name, "Ava (Premium)");
  assert.equal(pickBrowserVoice([voice("Ralph", "en-US"), voice("Moira", "en-IE")]).name, "Moira");
  assert.equal(pickBrowserVoice([voice("Thomas", "fr-FR")]), null);
  assert.equal(pickBrowserVoice([]), null);
  assert.equal(pickBrowserVoice(undefined), null);
});

class FakeUtterance { constructor(text) { this.text = text; } }

function fakeSynthesis(voices = []) {
  const spoken = [];
  const listeners = new Map();
  const synthesis = {
    spoken, cancelled: 0, voices,
    getVoices: () => synthesis.voices,
    speak: (utterance) => spoken.push(utterance),
    cancel: () => { synthesis.cancelled += 1; },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    fire: (type) => listeners.get(type)?.(),
  };
  return synthesis;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const manualTimers = () => {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: (timerId) => timers.delete(timerId),
  };
};

test("availability needs speechSynthesis and an utterance constructor", () => {
  assert.equal(isBrowserVoiceAvailable({ speechSynthesis: fakeSynthesis(), makeUtterance: (t) => new FakeUtterance(t) }), true);
  assert.equal(isBrowserVoiceAvailable({ speechSynthesis: null }), false);
  assert.equal(isBrowserVoiceAvailable({ speechSynthesis: fakeSynthesis() }), false);
});

test("voices that load late are awaited at most once and then cached", async () => {
  const synthesis = fakeSynthesis([]);
  const { timers, ...clock } = manualTimers();
  const pending = loadBrowserVoice({ speechSynthesis: synthesis, ...clock });
  assert.equal([...timers.values()][0].delay, 500);
  synthesis.voices = [voice("Samantha", "en-US")];
  synthesis.fire("voiceschanged");
  assert.equal((await pending).name, "Samantha");
  synthesis.voices = [];
  assert.equal((await loadBrowserVoice({ speechSynthesis: synthesis, ...clock })).name, "Samantha");

  const empty = fakeSynthesis([]);
  const waiting = loadBrowserVoice({ speechSynthesis: empty, ...clock });
  [...timers.values()].pop().callback();
  assert.equal(await waiting, null);
});

test("sentences are spoken one utterance at a time with callbacks in order", async () => {
  const synthesis = fakeSynthesis([voice("Samantha", "en-US")]);
  const events = [];
  const clock = manualTimers();
  const speech = speakWithBrowserVoice(["One here.", "Two here now."], {
    speechSynthesis: synthesis, makeUtterance: (t) => new FakeUtterance(t), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    onStart: () => events.push("start"), onSegment: (s, i) => events.push(`segment:${i}:${s}`), onEnd: () => events.push("end"),
  });
  await flush();
  assert.equal(synthesis.spoken.length, 1);
  const [first] = synthesis.spoken;
  assert.equal(first.lang, "en-US");
  assert.equal(first.voice.name, "Samantha");
  assert.ok(first.rate >= 0.95 && first.rate <= 1);
  first.onstart();
  first.onend();
  assert.equal(synthesis.spoken.length, 2);
  synthesis.spoken[1].onstart();
  synthesis.spoken[1].onend();
  assert.deepEqual(await speech.promise, { status: "completed" });
  assert.deepEqual(events, ["start", "segment:0:One here.", "segment:1:Two here now.", "end"]);
  assert.equal(clock.timers.size, 0);
});

test("a sentence that never ends is bounded by words * 600 ms + 3 s and keeps the interview moving", async () => {
  const synthesis = fakeSynthesis([voice("Alex", "en-US")]);
  const clock = manualTimers();
  const speech = speakWithBrowserVoice("Four words right here.", {
    speechSynthesis: synthesis, makeUtterance: (t) => new FakeUtterance(t), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  await flush();
  const bound = [...clock.timers.values()].find((timer) => timer.delay === 4 * 600 + 3_000);
  assert.ok(bound);
  bound.callback();
  assert.deepEqual(await speech.promise, { status: "completed" });
  assert.equal(synthesis.cancelled, 1);
});

test("cancel stops speaking immediately and an engine error reports unavailable", async () => {
  const synthesis = fakeSynthesis([voice("Alex", "en-US")]);
  const clock = manualTimers();
  const options = { speechSynthesis: synthesis, makeUtterance: (t) => new FakeUtterance(t), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  const speech = speakWithBrowserVoice(["Hello there."], options);
  await flush();
  speech.cancel();
  assert.equal(synthesis.cancelled, 1);
  assert.deepEqual(await speech.promise, { status: "cancelled" });

  const failing = speakWithBrowserVoice(["Hello there."], options);
  await flush();
  synthesis.spoken.at(-1).onerror({ error: "synthesis-failed" });
  assert.deepEqual(await failing.promise, { status: "unavailable" });
  assert.deepEqual(await speakWithBrowserVoice("x", { speechSynthesis: null }).promise, { status: "unavailable" });
});
