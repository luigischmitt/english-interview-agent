import assert from "node:assert/strict";
import test from "node:test";
import { chooseAudioMimeType, createVoiceRecorder } from "../src/lib/practice/voice-recorder.mjs";

function setup({ supported = ["audio/webm;codecs=opus"], duration = 1000, maxSeconds = 20 } = {}) {
  let clock = 0;
  let timer;
  let stopped = 0;
  class FakeRecorder {
    static isTypeSupported = (type) => supported.includes(type);
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType ?? "audio/webm"; this.state = "inactive"; this.listeners = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.listeners.dataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) }); this.listeners.stop?.(); }
  }
  const tracks = [{ stop() { stopped += 1; } }, { stop() { stopped += 1; } }];
  const recorder = createVoiceRecorder({ MediaRecorderClass: FakeRecorder, mediaDevices: { getUserMedia: async () => ({ getTracks: () => tracks }) }, now: () => clock, setTimeoutFn: (fn) => { timer = fn; return 1; }, clearTimeoutFn: () => {}, maxSeconds, onStateChange() {} });
  return { recorder, advance: (ms) => { clock += ms; }, fireLimit: () => timer?.(), get stopped() { return stopped; }, duration };
}

test("chooses the first supported type, including Safari mp4 fallback", () => {
  assert.equal(chooseAudioMimeType({ isTypeSupported: (type) => type === "audio/mp4" }), "audio/mp4");
  assert.equal(chooseAudioMimeType({ isTypeSupported: () => false }), "");
});

test("stops at the configured time limit and releases every track", async () => {
  const fake = setup({ maxSeconds: 2 });
  await fake.recorder.start();
  const result = fake.recorder.completed();
  fake.advance(2000); fake.fireLimit();
  assert.equal((await result).durationMs, 2000);
  assert.equal(fake.stopped, 2);
});

test("rejects recordings shorter than 600ms and releases tracks", async () => {
  const fake = setup();
  await fake.recorder.start();
  const result = fake.recorder.completed();
  fake.advance(599); await fake.recorder.stop();
  assert.equal(await result, null);
  assert.equal(fake.recorder.state, "error");
  assert.equal(fake.stopped, 2);
});

test("cancel stops recorder and releases tracks without returning audio", async () => {
  const fake = setup();
  await fake.recorder.start();
  const result = fake.recorder.completed();
  fake.recorder.cancel();
  assert.equal(await result, null);
  assert.equal(fake.stopped, 2);
  assert.equal(fake.recorder.state, "idle");
});
