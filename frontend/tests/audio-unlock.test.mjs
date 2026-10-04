import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { SILENT_AUDIO_URI, createAudioPool, installAudioUnlockOnFirstGesture, resetSharedAudioPool } from "../src/lib/interview/audio-unlock.mjs";
import {
  AUTOPLAY_BLOCKED_REASON,
  autoplayBlockedMessage,
  clearRetainedSpeechBlobs,
  playInterviewerSegments,
  resetSpeechFlights,
  synthesizeInterviewerQuestion,
} from "../src/lib/interview/speech-playback.mjs";

beforeEach(() => { resetSpeechFlights(); clearRetainedSpeechBlobs(); resetSharedAudioPool(); });

class PoolAudio {
  constructor(log) { this.log = log; this.listeners = new Map(); this.src = ""; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  removeAttribute() { this.src = ""; }
  load() {}
  pause() {}
  play() { this.log.push(`play:${this.src}`); return this.playResult?.() ?? Promise.resolve(); }
  emit(type) { this.listeners.get(type)?.(); }
}

test("pool reuses its elements across chunks and unlocks each on the first gesture only", async () => {
  const log = [];
  const created = [];
  const pool = createAudioPool({ create: () => { const a = new PoolAudio(log); created.push(a); return a; } });
  assert.equal(pool.unlock(), true);
  assert.equal(created.length, 2);
  assert.deepEqual(log, [`play:${SILENT_AUDIO_URI}`, `play:${SILENT_AUDIO_URI}`]);
  assert.equal(pool.unlock(), false, "second gesture does nothing");
  assert.equal(log.length, 2);

  const first = pool.acquire("blob:1");
  const second = pool.acquire("blob:2");
  assert.notEqual(first, second);
  pool.release(first);
  assert.equal(pool.acquire("blob:3"), first, "released element is reused");
  assert.equal(created.length, 2, "no new element beyond the pool");
  assert.equal(first.src, "blob:3");
});

test("a rejected silent play re-arms the unlock", async () => {
  const log = [];
  const pool = createAudioPool({ create: () => { const a = new PoolAudio(log); a.playResult = () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })); return a; } });
  pool.unlock();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.isUnlocked, false);
  assert.equal(pool.unlock(), true);
});

test("the gesture listener fires once on the first gesture and detaches", () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const remove = installAudioUnlockOnFirstGesture(target);
  assert.ok(listeners.has("pointerdown") && listeners.has("touchend") && listeners.has("keydown"));
  assert.equal(typeof installAudioUnlockOnFirstGesture(target), "function", "second install is a no-op");
  remove();
  assert.equal(listeners.size, 0);
});

const blockedHarness = () => {
  const audio = new PoolAudio([]);
  audio.playResult = () => Promise.reject(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
  return {
    endpoint: "/speech",
    fetcher: async () => ({ ok: true, blob: async () => new Blob(["x"]) }),
    makeAudio: () => audio,
    createObjectUrl: () => "blob:x",
    revokeObjectUrl() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
};

test("NotAllowedError from play() becomes an autoplay-blocked result, not the generic message", async () => {
  const chunks = await playInterviewerSegments(["Tell me about a hard bug you fixed recently."], blockedHarness()).promise;
  assert.deepEqual(chunks, { status: "unavailable", message: autoplayBlockedMessage, reason: AUTOPLAY_BLOCKED_REASON });
  const single = await synthesizeInterviewerQuestion("Tell me about yourself.", blockedHarness()).promise;
  assert.equal(single.reason, AUTOPLAY_BLOCKED_REASON);
});

test("default playback reuses the shared pool elements across chunks and cancel returns them", async () => {
  const created = [];
  const previous = globalThis.Audio;
  globalThis.Audio = class extends PoolAudio {
    constructor() { super([]); created.push(this); }
    play() { queueMicrotask(() => this.emit("ended")); return Promise.resolve(); }
  };
  try {
    const result = await playInterviewerSegments(
      ["Thanks for that detailed answer about caching.", "How did you invalidate entries across regions?", "And what happened during a regional failover?"],
      { endpoint: "/speech", fetcher: async () => ({ ok: true, blob: async () => new Blob(["x"]) }), createObjectUrl: () => "blob:x", revokeObjectUrl() {}, setTimeout: () => 1, clearTimeout() {} },
    ).promise;
    assert.equal(result.status, "completed");
    assert.ok(created.length >= 1 && created.length <= 2, `at most the pool size was created, got ${created.length}`);
  } finally {
    globalThis.Audio = previous;
  }
});
