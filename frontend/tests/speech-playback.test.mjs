import assert from "node:assert/strict";
import test from "node:test";
import { composeOpeningUtterance, getInterviewerCaption, synthesizeInterviewerQuestion } from "../src/lib/interview/speech-playback.mjs";

test("the first interviewer playback combines a short introduction and the first question", () => {
  assert.equal(
    composeOpeningUtterance("Welcome. Take your time.", "Tell me about yourself."),
    "Welcome. Take your time. Tell me about yourself.",
  );
  assert.equal(composeOpeningUtterance(" Welcome. ", " Tell me about yourself. "), "Welcome. Tell me about yourself.");
});

test("the opening caption remains through the first answer, then returns to the active question", () => {
  const caption = (overrides = {}) => getInterviewerCaption({
    isOpeningQuestion: true,
    phase: "answering",
    openingUtterance: "Welcome. Tell me about yourself.",
    questionPrompt: "Tell me about yourself.",
    ...overrides,
  });

  assert.equal(caption(), "Welcome. Tell me about yourself.");
  assert.equal(caption({ phase: "advancing" }), "Tell me about yourself.");
  assert.equal(caption({ isOpeningQuestion: false }), "Tell me about yourself.");
});

class FakeAudio {
  listeners = new Map();
  paused = false;
  removedSource = false;
  loaded = false;

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  emit(type) { this.listeners.get(type)?.(); }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === "src") this.removedSource = true; }
  load() { this.loaded = true; }
  play() {
    this.emit("ended");
    return Promise.resolve();
  }
}

function successfulOptions(audio, overrides = {}) {
  return {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async (_endpoint, init) => {
      assert.equal(JSON.parse(init.body).text, "Hello.");
      return { ok: true, blob: async () => new Blob(["mp3"]) };
    },
    makeAudio: () => audio,
    createObjectUrl: () => "blob:speech-preview",
    revokeObjectUrl: (url) => { assert.equal(url, "blob:speech-preview"); audio.revoked = true; },
    setTimeout: () => 1,
    clearTimeout: () => {},
    ...overrides,
  };
}

test("speech playback registers completion before play and releases the media URL", async () => {
  const audio = new FakeAudio();
  const playback = synthesizeInterviewerQuestion("Hello.", successfulOptions(audio));
  assert.deepEqual(await playback.promise, { status: "completed" });
  assert.equal(audio.paused, true);
  assert.equal(audio.removedSource, true);
  assert.equal(audio.loaded, true);
  assert.equal(audio.revoked, true);
});

test("repeated cancellation stops active playback and resolves without reporting success", async () => {
  const audio = new FakeAudio();
  audio.play = () => Promise.resolve();
  const playback = synthesizeInterviewerQuestion("Hello.", successfulOptions(audio));
  await new Promise((resolve) => setImmediate(resolve));
  playback.cancel();
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
  assert.equal(audio.paused, true);
  assert.equal(audio.removedSource, true);
  assert.equal(audio.revoked, true);
});

test("a rejected browser playback returns a recoverable unavailable result", async () => {
  const audio = new FakeAudio();
  audio.play = () => Promise.reject(new Error("autoplay blocked"));
  const playback = synthesizeInterviewerQuestion("Hello.", successfulOptions(audio));
  assert.deepEqual(await playback.promise, {
    status: "unavailable",
    message: "O áudio não está disponível agora. Você pode continuar sem ele.",
  });
  assert.equal(audio.revoked, true);
});
