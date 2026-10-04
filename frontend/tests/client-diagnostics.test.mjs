import assert from "node:assert/strict";
import test from "node:test";

import { createDiagnosticsReporter } from "../src/lib/interview/client-diagnostics.mjs";
import { describeMedia, detectPlatform, errorNameOf, readAudioSessionType, setAudioSessionType } from "../src/lib/interview/client-environment.mjs";
import { synthesizeInterviewerQuestion } from "../src/lib/interview/speech-playback.mjs";

function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (callback) => { const id = next++; pending.set(id, callback); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    fire() { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(); },
    get size() { return pending.size; },
  };
}

test("events are batched into one request per debounce window", () => {
  const timers = manualTimers();
  const sent = [];
  const reporter = createDiagnosticsReporter({ send: (events) => { sent.push(events); }, platform: "ios", ...timers });
  reporter.report({ kind: "unlock" });
  reporter.report({ kind: "playback_start", chunkIndex: 0 });
  assert.equal(sent.length, 0);
  assert.equal(timers.size, 1, "one debounce timer");
  timers.fire();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map((event) => event.kind), ["unlock", "playback_start"]);
  assert.ok(sent[0].every((event) => event.platform === "ios"));
  assert.equal(reporter.pending, 0);
});

test("a full batch flushes immediately and never exceeds the batch limit", () => {
  const timers = manualTimers();
  const sent = [];
  const reporter = createDiagnosticsReporter({ send: (events) => { sent.push(events.length); }, batchLimit: 20, ...timers });
  for (let index = 0; index < 45; index += 1) reporter.report({ kind: "unlock" });
  assert.deepEqual(sent, [20, 20]);
  assert.equal(reporter.pending, 5);
  reporter.flush();
  assert.deepEqual(sent, [20, 20, 5]);
});

test("send failures and sync throws are swallowed", async () => {
  const timers = manualTimers();
  const reporter = createDiagnosticsReporter({ send: () => Promise.reject(new Error("offline")), ...timers });
  reporter.report({ kind: "unlock" });
  assert.doesNotThrow(() => timers.fire());
  const throwing = createDiagnosticsReporter({ send: () => { throw new Error("boom"); }, ...timers });
  throwing.report({ kind: "unlock" });
  assert.doesNotThrow(() => throwing.flush());
  assert.doesNotThrow(() => throwing.report(null));
  assert.doesNotThrow(() => throwing.report({ nokind: true }));
  await new Promise((resolve) => setImmediate(resolve));
});

test("environment helpers expose only whitelisted, content-free values", () => {
  assert.equal(detectPlatform({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }), "ios");
  assert.equal(detectPlatform({ userAgent: "Android", platform: "", maxTouchPoints: 5 }), "android");
  assert.equal(detectPlatform({ userAgent: "Windows", platform: "Win32", maxTouchPoints: 0 }), "desktop");
  assert.equal(readAudioSessionType({ audioSession: { type: "auto" } }), "auto");
  assert.equal(readAudioSessionType({ audioSession: { type: "weird" } }), undefined);
  assert.equal(readAudioSessionType({}), undefined);
  const nav = { audioSession: { type: "auto" } };
  assert.equal(setAudioSessionType("play-and-record", nav), true);
  assert.equal(nav.audioSession.type, "play-and-record");
  assert.equal(setAudioSessionType("play-and-record", {}), false, "no Audio Session API: no-op");
  assert.equal(errorNameOf({ name: "NotAllowedError", message: "secret" }), "NotAllowedError");
  assert.equal(errorNameOf({ name: "CustomThing" }), "other");
  assert.deepEqual(describeMedia({ muted: false, volume: 1, paused: false, currentTime: 1.2344, duration: Number.NaN, readyState: 4 }), { mediaMuted: false, mediaVolume: 1, mediaPaused: false, mediaCurrentTimeMs: 1234, readyState: 4 });
});

class Element {
  listeners = new Map();
  muted = false; volume = 1; paused = true; currentTime = 0; duration = 2; readyState = 4;
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  emit(type) { this.listeners.get(type)?.(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
  play() { this.paused = false; this.emit("playing"); this.currentTime = 2; this.emit("ended"); return Promise.resolve(); }
}

test("synthesizeInterviewerQuestion reports play, playing and ended with the element state and no content", async () => {
  const diagnostics = [];
  const playback = synthesizeInterviewerQuestion("Tell me about yourself.", {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async () => ({ ok: true, blob: async () => new Blob(["mp3"]) }),
    makeAudio: () => new Element(),
    createObjectUrl: () => "blob:secret-url",
    revokeObjectUrl: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    onDiagnostic: (event) => diagnostics.push(event),
  });
  assert.deepEqual(await playback.promise, { status: "completed" });
  assert.deepEqual(diagnostics.map((event) => event.kind), ["playback_start", "playback_playing", "playback_ended", "playback_play_resolved"]);
  const ended = diagnostics.find((event) => event.kind === "playback_ended");
  assert.equal(ended.mediaMuted, false);
  assert.equal(ended.mediaVolume, 1);
  assert.equal(ended.mediaCurrentTimeMs, 2000);
  assert.equal(ended.output, "element");
  assert.equal(ended.pooled, false, "an injected element is not the pool");
  assert.ok(!JSON.stringify(diagnostics).includes("secret-url"));
  assert.ok(!JSON.stringify(diagnostics).includes("yourself"));
});

test("a throwing onDiagnostic never breaks playback", async () => {
  const playback = synthesizeInterviewerQuestion("Hello.", {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async () => ({ ok: true, blob: async () => new Blob(["mp3"]) }),
    makeAudio: () => new Element(),
    createObjectUrl: () => "blob:x",
    revokeObjectUrl: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    onDiagnostic: () => { throw new Error("nope"); },
  });
  assert.deepEqual(await playback.promise, { status: "completed" });
});
