import assert from "node:assert/strict";
import test from "node:test";
import { composeOpeningUtterance, playInterviewerSegments, resolveInterviewerCaption, splitInterviewerSpeech, synthesizeInterviewerQuestion } from "../src/lib/interview/speech-playback.mjs";

test("the first interviewer playback combines a short introduction and the first question", () => {
  assert.equal(
    composeOpeningUtterance("Welcome. Take your time.", "Tell me about yourself."),
    "Welcome. Take your time. Tell me about yourself.",
  );
  assert.equal(composeOpeningUtterance(" Welcome. ", " Tell me about yourself. "), "Welcome. Tell me about yourself.");
});

test("interviewer speech is split into complete natural sentence excerpts", () => {
  assert.deepEqual(splitInterviewerSpeech("Thanks for joining. Take your time! Tell me about yourself?"), [
    "Thanks for joining.",
    "Take your time!",
    "Tell me about yourself?",
  ]);
  assert.deepEqual(splitInterviewerSpeech("  "), []);
});

test("interviewer captions show only the active excerpt during audio and the full fallback when needed", () => {
  const caption = (overrides = {}) => resolveInterviewerCaption({
    audioEnabled: true,
    isSpeaking: true,
    playbackFailed: false,
    activeSegment: "Take your time.",
    firstSegment: "Thanks for joining.",
    fallbackText: "Thanks for joining. Tell me about yourself.",
    questionPrompt: "Tell me about yourself.",
    ...overrides,
  });

  assert.equal(caption(), "Take your time.");
  assert.equal(caption({ activeSegment: null }), "Thanks for joining.");
  assert.equal(caption({ isSpeaking: false }), "Tell me about yourself.");
  assert.equal(caption({ audioEnabled: false }), "Thanks for joining. Tell me about yourself.");
  assert.equal(caption({ playbackFailed: true }), "Thanks for joining. Tell me about yourself.");
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
      assert.equal(JSON.parse(init.body).text, overrides.expectedText ?? "Hello.");
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

test("a slow speech response times out and returns a text-fallback result", async () => {
  let onTimeout;
  const playback = synthesizeInterviewerQuestion("Hello.", {
    endpoint: "http://speech.test/api/v1/speech",
    timeoutMs: 25,
    fetcher: (_endpoint, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    setTimeout: (callback) => { onTimeout = callback; return 1; },
    clearTimeout: () => {},
  });

  onTimeout();
  assert.deepEqual(await playback.promise, {
    status: "unavailable",
    message: "O áudio demorou demais para responder. Você pode continuar sem ele.",
  });
});

test("interviewer excerpts are synthesized and played sequentially", async () => {
  const events = [];
  let blobIndex = 0;
  const playback = playInterviewerSegments(["First thought.", "Second thought."], {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async (_endpoint, init) => {
      const text = JSON.parse(init.body).text;
      events.push(`fetch:${text}`);
      return { ok: true, blob: async () => new Blob([text]) };
    },
    createObjectUrl: (blob) => `blob:${++blobIndex}:${blob.size}`,
    revokeObjectUrl: () => {},
    makeAudio: (url) => ({
      addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; },
      removeEventListener() {},
      removeAttribute() {},
      load() {},
      pause() {},
      play() { events.push(`play:${url}`); this.listeners.ended(); return Promise.resolve(); },
    }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    onSegment: (segment) => events.push(`caption:${segment}`),
  });

  assert.deepEqual(await playback.promise, { status: "completed" });
  assert.deepEqual(events.filter((event) => typeof event === "string"), [
    "caption:First thought.",
    "fetch:First thought.",
    "play:blob:1:14",
    "caption:Second thought.",
    "fetch:Second thought.",
    "play:blob:2:15",
  ]);
});

test("cancelling a segment queue stops the active clip and does not fetch later excerpts", async () => {
  const fetched = [];
  let audio;
  let revoked = false;
  const playback = playInterviewerSegments(["First thought.", "Second thought."], {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async (_endpoint, init) => {
      fetched.push(JSON.parse(init.body).text);
      return { ok: true, blob: async () => new Blob(["mp3"]) };
    },
    makeAudio: () => {
      audio = new FakeAudio();
      audio.play = () => Promise.resolve();
      return audio;
    },
    createObjectUrl: () => "blob:queued",
    revokeObjectUrl: () => { revoked = true; },
    setTimeout: () => 1,
    clearTimeout: () => {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
  assert.deepEqual(fetched, ["First thought."]);
  assert.equal(audio.paused, true);
  assert.equal(revoked, true);
});
