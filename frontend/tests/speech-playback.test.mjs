import assert from "node:assert/strict";
import test from "node:test";
import { composeAcknowledgedQuestion, composeContextualOpening, composeInterviewClosing, composeOpeningUtterance, playInterviewerSegments, resolveInterviewerCaption, resolveSkippedQuestion, speechUnavailableMessage, splitInterviewerSpeech, synthesizeInterviewerQuestion } from "../src/lib/interview/speech-playback.mjs";

import { hasSeniorityWord, looksPortuguese, roleForSpeech } from "../src/lib/interview/opening-copy.mjs";
import { createOpeningSpeechTiming, isOpeningTimingEnabled, openingTimingStorageKey } from "../src/lib/interview/opening-timing.mjs";

test("the first interviewer playback combines the introduction and the first question", () => {
  assert.equal(composeOpeningUtterance("Welcome.", "Tell me about yourself."), "Welcome. Tell me about yourself.");
  assert.equal(composeOpeningUtterance(" Welcome. ", " Tell me about yourself. "), "Welcome. Tell me about yourself.");
});

test("the opening is one concise, natural sentence for every seniority and focus", () => {
  const seniorityLabels = { junior: "junior", "mid-level": "mid-level", senior: "senior", staff: "staff-level" };
  const focusClauses = {
    "technical-depth": ", with a focus on technical depth",
    communication: ", with a focus on clear communication",
    behavioral: ", with a focus on behavioral questions",
    mixed: "",
  };
  const question = "Tell me about a project.";
  for (const [seniorityValue, seniorityLabel] of Object.entries(seniorityLabels)) {
    for (const [focusValue, clause] of Object.entries(focusClauses)) {
      const config = { role: "Backend Engineer", seniority: seniorityValue, focus: focusValue, duration: "10" };
      const opening = composeContextualOpening(config, question);
      assert.equal(opening, `Hi, I'm Tuk, and I'll be your interviewer today. We have about 10 minutes for your ${seniorityLabel} Backend Engineer role${clause}. ${question}`);
      const prefix = opening.slice(0, -question.length).trim();
      assert.equal(splitInterviewerSpeech(prefix).length, 2);
      assert.ok(prefix.split(/\s+/u).length <= 28, `${seniorityValue}/${focusValue} prefix was too long`);
      assert.ok(!opening.includes("balanced practice") && !opening.includes("focusing on"));
    }
  }
});

test("the opening never duplicates seniority already in the role, English or Portuguese", () => {
  const question = "Tell me about a project.";
  const open = (role, seniority = "senior") => composeContextualOpening({ role, seniority, focus: "mixed", duration: "5" }, question);
  assert.equal(open("Senior Backend Engineer"), `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for your Senior Backend Engineer role. ${question}`);
  assert.equal(open("Staff Software Engineer", "senior"), `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for your Staff Software Engineer role. ${question}`);
  assert.equal(open("Lead Data Analyst", "mid-level"), `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for your Lead Data Analyst role. ${question}`);
  assert.equal(open("Data Analyst", "junior"), `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for your junior Data Analyst role. ${question}`);
  assert.equal(open("Backend Engineer role"), `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for your senior Backend Engineer role. ${question}`);
});

test("a Portuguese role is never spliced into the English opening", () => {
  const question = "Tell me about a project.";
  for (const role of ["Analista de Dados Sênior", "Desenvolvedor Backend", "Engenheira de Software Pleno", "Gerente de Produto", "Arquiteto de Soluções"]) {
    const opening = composeContextualOpening({ role, seniority: "senior", focus: "mixed", duration: "5" }, question);
    assert.equal(opening, `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for this role. ${question}`, role);
  }
  assert.equal(composeContextualOpening({ role: "", seniority: "senior", focus: "mixed", duration: "5" }, question), `Hi, I'm Tuk, and I'll be your interviewer today. We have about 5 minutes for this role. ${question}`);
  assert.equal(looksPortuguese("Data Analyst"), false);
  assert.equal(looksPortuguese("Product Manager"), false);
  assert.equal(hasSeniorityWord("Sênior"), true);
  assert.equal(hasSeniorityWord("Software Engineer"), false);
});

test("the Portuguese role is also kept out of role-fit questions", () => {
  assert.equal(roleForSpeech("Backend Engineer"), "Backend Engineer");
  assert.equal(roleForSpeech("Analista de Dados Sênior"), "this role");
  assert.equal(roleForSpeech(""), "this role");
  assert.equal(roleForSpeech(undefined), "this role");
});

test("unknown opening labels use a safe generic fallback without leaking identifiers", () => {
  const opening = composeContextualOpening({ role: "Backend Engineer", seniority: "principal-engineer", focus: "technical-depth-plus", duration: "10" }, "Tell me about a project.");
  assert.equal(opening, "Hi, I'm Tuk, and I'll be your interviewer today. We have about 10 minutes for your Backend Engineer role. Tell me about a project.");
  assert.ok(!opening.includes("principal-engineer"));
  assert.ok(!opening.includes("technical-depth-plus"));
});

test("opening timing emits numeric synthesis-to-playback durations only once", () => {
  const marks = { "synthesis-started": 100, "synthesis-completed": 1_100, "playback-started": 1_240 };
  const metrics = [];
  const timing = createOpeningSpeechTiming({ now: () => marks.current, onComplete: (value) => metrics.push(value) });
  for (const [stage, time] of Object.entries(marks)) {
    marks.current = time;
    timing.mark(stage);
  }
  timing.mark("playback-started");

  assert.deepEqual(metrics, [{ synthesisMs: 1_000, playbackStartMs: 140 }]);
  assert.ok(Object.values(metrics[0]).every(Number.isFinite));
});

test("opening timing stays silent when synthesis or playback fails before playback starts", () => {
  const metrics = [];
  const timing = createOpeningSpeechTiming({ now: () => 100, onComplete: (value) => metrics.push(value) });
  timing.mark("synthesis-started");
  timing.mark("synthesis-completed");

  assert.deepEqual(metrics, []);
});

test("opening timing is opt-in through session storage", () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(isOpeningTimingEnabled(), false);
    globalThis.window = { sessionStorage: { getItem: (key) => key === openingTimingStorageKey ? "1" : null } };
    assert.equal(isOpeningTimingEnabled(), true);
    globalThis.window.sessionStorage.getItem = () => "true";
    assert.equal(isOpeningTimingEnabled(), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("the next spoken and captioned utterance uses an optional natural transition", () => {
  assert.equal(composeAcknowledgedQuestion("I see. That helps me understand your approach.", "What limit would you set?"), "I see. That helps me understand your approach. What limit would you set?");
  assert.equal(composeAcknowledgedQuestion(null, "What limit would you set?"), "What limit would you set?");
});

test("the interview closing is a short natural line that can be captioned by sentence", () => {
  const closing = composeInterviewClosing();
  assert.equal(closing, "Thanks for your time today. That brings us to the end of the interview. I’ll prepare your feedback now.");
  assert.deepEqual(splitInterviewerSpeech(closing), [
    "Thanks for your time today.",
    "That brings us to the end of the interview.",
    "I’ll prepare your feedback now.",
  ]);
});

test("a skipped question's next fixed prompt does not carry the previous acknowledgment", () => {
  const transition = resolveSkippedQuestion("Tell me about your recent project.");
  assert.deepEqual(transition, { question: "Tell me about your recent project.", acknowledgement: "" });
  assert.equal(composeAcknowledgedQuestion(transition.acknowledgement, transition.question), "Tell me about your recent project.");
});

test("interviewer speech is split into complete natural sentence excerpts", () => {
  assert.deepEqual(splitInterviewerSpeech("Thanks for joining. Take your time! Tell me about yourself?"), [
    "Thanks for joining.",
    "Take your time!",
    "Tell me about yourself?",
  ]);
  assert.deepEqual(splitInterviewerSpeech("  "), []);
});

test("interviewer captions show active excerpts during playback and only the question after playback", () => {
  const caption = (overrides = {}) => resolveInterviewerCaption({
    audioEnabled: true,
    isSpeaking: true,
    playbackFailed: false,
    activeSegment: "Take your time.",
    firstSegment: "Thanks for joining.",
    fallbackText: "Thanks. Let’s move on to another part of your experience. Tell me about yourself.",
    questionPrompt: "Tell me about yourself.",
    ...overrides,
  });

  assert.equal(caption(), "Take your time.");
  assert.equal(caption({ activeSegment: null }), "Thanks for joining.");
  assert.equal(caption({ isSpeaking: false }), "Tell me about yourself.");
  assert.equal(caption({ audioEnabled: false }), "Thanks. Let’s move on to another part of your experience. Tell me about yourself.");
  assert.equal(caption({ playbackFailed: true }), "Thanks. Let’s move on to another part of your experience. Tell me about yourself.");
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

test("speech playback reports synthesis completion and the first actual playing event", async () => {
  const audio = new FakeAudio();
  const timingEvents = [];
  audio.play = () => { audio.emit("playing"); audio.emit("ended"); return Promise.resolve(); };
  const playback = synthesizeInterviewerQuestion("Hello.", successfulOptions(audio, {
    onSynthesisStarted: () => timingEvents.push("synthesis-started"),
    onSynthesisCompleted: () => timingEvents.push("synthesis-completed"),
    onPlaybackStarted: () => timingEvents.push("playback-started"),
  }));

  assert.deepEqual(await playback.promise, { status: "completed" });
  assert.deepEqual(timingEvents, ["synthesis-started", "synthesis-completed", "playback-started"]);
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

test("matching consumers share synthesis while keeping their audio playback independent", async () => {
  let fetchCount = 0;
  const makeConsumer = () => {
    const audio = new FakeAudio();
    let plays = 0;
    audio.play = () => { plays += 1; audio.emit("ended"); return Promise.resolve(); };
    return {
      audio,
      get plays() { return plays; },
      playback: synthesizeInterviewerQuestion("Shared question.", successfulOptions(audio, {
        fetcher: async () => { fetchCount += 1; await new Promise((resolve) => setImmediate(resolve)); return { ok: true, blob: async () => new Blob(["shared"]) }; },
      })),
    };
  };
  const first = makeConsumer();
  const second = makeConsumer();
  assert.deepEqual(await Promise.all([first.playback.promise, second.playback.promise]), [
    { status: "completed" }, { status: "completed" },
  ]);
  assert.equal(fetchCount, 1);
  assert.equal(first.plays, 1);
  assert.equal(second.plays, 1);
  assert.notEqual(first.audio, second.audio);
});

test("cancelling one shared consumer leaves the other playing, and cancelled consumers never play or caption", async () => {
  let finishFetch;
  let fetchCount = 0;
  let firstAudioCount = 0;
  let secondAudio;
  const events = [];
  const options = (id, makeAudio) => ({
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: () => { fetchCount += 1; return new Promise((resolve) => { finishFetch = () => resolve({ ok: true, blob: async () => new Blob(["mp3"]) }); }); },
    makeAudio,
    createObjectUrl: () => `blob:${id}`,
    revokeObjectUrl: () => {},
    captionSegments: ["Same question."],
    onSegment: (segment) => events.push(`${id}:${segment}`),
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const first = synthesizeInterviewerQuestion("Same question.", options("first", () => { firstAudioCount += 1; return new FakeAudio(); }));
  const second = synthesizeInterviewerQuestion("Same question.", options("second", () => { secondAudio = new FakeAudio(); secondAudio.play = () => { secondAudio.emit("ended"); return Promise.resolve(); }; return secondAudio; }));
  await new Promise((resolve) => setImmediate(resolve));
  first.cancel();
  assert.deepEqual(await first.promise, { status: "cancelled" });
  finishFetch();
  assert.deepEqual(await second.promise, { status: "completed" });
  assert.equal(fetchCount, 1);
  assert.equal(firstAudioCount, 0);
  assert.equal(secondAudio.paused, true);
  assert.deepEqual(events, ["second:Same question."]);
});

test("different speech request keys do not share synthesis", async () => {
  let fetchCount = 0;
  const create = (voice) => synthesizeInterviewerQuestion("Question one.", {
    endpoint: "http://speech.test/api/v1/speech",
    requestBody: { text: "Question one.", voice },
    fetcher: async () => { fetchCount += 1; return { ok: true, blob: async () => new Blob([voice]) }; },
    makeAudio: () => { const audio = new FakeAudio(); audio.play = () => { audio.emit("ended"); return Promise.resolve(); }; return audio; },
    createObjectUrl: () => `blob:${voice}`,
    revokeObjectUrl: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  assert.deepEqual(await Promise.all([create("voice-a").promise, create("voice-b").promise]), [
    { status: "completed" }, { status: "completed" },
  ]);
  assert.equal(fetchCount, 2);
});

test("a failed flight is removed so the next attempt can retry", async () => {
  let fetchCount = 0;
  const options = {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async () => {
      fetchCount += 1;
      if (fetchCount === 1) throw new Error("temporary failure");
      return { ok: true, blob: async () => new Blob(["mp3"]) };
    },
    makeAudio: () => { const audio = new FakeAudio(); audio.play = () => { audio.emit("ended"); return Promise.resolve(); }; return audio; },
    createObjectUrl: () => "blob:retry",
    revokeObjectUrl: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  assert.equal((await synthesizeInterviewerQuestion("Retry me.", options).promise).status, "unavailable");
  assert.deepEqual(await synthesizeInterviewerQuestion("Retry me.", options).promise, { status: "completed" });
  assert.equal(fetchCount, 2);
});

test("a timed out flight is aborted and removed so a fresh request can retry", async () => {
  let fetchCount = 0;
  let networkTimeout;
  const options = {
    endpoint: "http://speech.test/api/v1/speech",
    timeoutMs: 10_000,
    firstAudioTimeoutMs: 10_000,
    fetcher: async (_endpoint, init) => {
      fetchCount += 1;
      if (fetchCount === 1) return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return { ok: true, blob: async () => new Blob(["mp3"]) };
    },
    makeAudio: () => { const audio = new FakeAudio(); audio.play = () => { audio.emit("ended"); return Promise.resolve(); }; return audio; },
    createObjectUrl: () => "blob:timeout-retry",
    revokeObjectUrl: () => {},
    setTimeout: (callback, delay) => { if (delay === 10_000) networkTimeout = callback; return 1; },
    clearTimeout: () => {},
  };
  const timedOut = synthesizeInterviewerQuestion("Timeout then retry.", options);
  await new Promise((resolve) => setImmediate(resolve));
  networkTimeout();
  assert.equal((await timedOut.promise).status, "unavailable");
  assert.deepEqual(await synthesizeInterviewerQuestion("Timeout then retry.", options).promise, { status: "completed" });
  assert.equal(fetchCount, 2);
});

test("the interview network deadline exceeds six seconds and completes a slower response", async () => {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  let networkTimeoutFired = false;
  let finishFetch;
  const advanceTime = (milliseconds) => {
    now += milliseconds;
    for (const [id, timer] of timers) {
      if (timer.deadline > now) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  const playback = synthesizeInterviewerQuestion("Slow question.", {
    endpoint: "http://speech.test/api/v1/speech",
    firstAudioTimeoutMs: 20_000,
    fetcher: () => new Promise((resolve) => { finishFetch = resolve; }),
    makeAudio: () => { const audio = new FakeAudio(); audio.play = () => { audio.emit("ended"); return Promise.resolve(); }; return audio; },
    createObjectUrl: () => "blob:slow",
    revokeObjectUrl: () => {},
    setTimeout: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { deadline: now + delay, callback: () => { if (delay === 20_000) networkTimeoutFired = true; callback(); } });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  await new Promise((resolve) => setImmediate(resolve));
  advanceTime(6_001);
  assert.equal(networkTimeoutFired, false, "the request remains pending after the former 6s cutoff");
  finishFetch({ ok: true, blob: async () => new Blob(["mp3"]) });
  assert.deepEqual(await playback.promise, { status: "completed" });
  assert.equal(networkTimeoutFired, false);
});

test("a rejected playback returns a recoverable unavailable result", async () => {
  const audio = new FakeAudio();
  audio.play = () => Promise.reject(new Error("autoplay blocked"));
  const playback = synthesizeInterviewerQuestion("Hello.", successfulOptions(audio));
  assert.deepEqual(await playback.promise, {
    status: "unavailable",
    message: speechUnavailableMessage,
  });
  assert.equal(audio.revoked, true);
});

test("a slow speech response times out and returns a text-fallback result", async () => {
  let onTimeout;
  const playback = synthesizeInterviewerQuestion("Hello.", {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: (_endpoint, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    setTimeout: (callback) => { onTimeout = callback; return 1; },
    clearTimeout: () => {},
  });

  onTimeout();
  assert.deepEqual(await playback.promise, {
    status: "unavailable",
    message: speechUnavailableMessage,
  });
});

for (const scenario of [
  { name: "play() promise", play: () => new Promise(() => {}) },
  { name: "ended event", play: () => Promise.resolve() },
]) {
  test(`a stalled ${scenario.name} falls back and releases its audio URL`, async () => {
    const timers = new Map();
    let nextTimerId = 0;
    let revoked = false;
    let audio;
    const playback = synthesizeInterviewerQuestion("Tell me about your work.", {
      endpoint: "http://speech.test/api/v1/speech",
      timeoutMs: 1_000,
      playbackTimeoutMs: 2_000,
      fetcher: async () => ({ ok: true, blob: async () => new Blob(["mp3"]) }),
      makeAudio: () => {
        audio = new FakeAudio();
        audio.play = scenario.play;
        return audio;
      },
      createObjectUrl: () => "blob:stalled-playback",
      revokeObjectUrl: (url) => { assert.equal(url, "blob:stalled-playback"); revoked = true; },
      setTimeout: (callback) => {
        const id = ++nextTimerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timers.size, 1, "the network timer is replaced by a media deadline");
    timers.values().next().value();
    assert.deepEqual(await playback.promise, {
      status: "unavailable",
      message: "A reprodução do áudio demorou demais. Você pode continuar sem ele.",
    });
    assert.equal(audio.paused, true);
    assert.equal(audio.removedSource, true);
    assert.equal(revoked, true);
    assert.equal(timers.size, 0);
  });
}

test("one utterance is synthesized once while sentence captions remain chunked", async () => {
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

  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(events.filter((event) => typeof event === "string"), [
    "fetch:First thought. Second thought.",
    "caption:First thought.",
    "play:blob:1:30",
  ]);
  assert.equal(events.filter((event) => event.startsWith("fetch:")).length, 1);
});

test("caption chunks advance against one continuous audio track", async () => {
  const captions = [];
  let audio;
  const playback = playInterviewerSegments(["First thought.", "Second thought here."], {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async () => ({ ok: true, blob: async () => new Blob(["mp3"]) }),
    makeAudio: () => {
      audio = new FakeAudio();
      audio.duration = 10;
      audio.play = () => Promise.resolve();
      return audio;
    },
    createObjectUrl: () => "blob:captioned",
    revokeObjectUrl: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    onSegment: (segment) => captions.push(segment),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(captions, ["First thought."]);
  audio.currentTime = 7;
  audio.emit("timeupdate");
  assert.deepEqual(captions, ["First thought.", "Second thought here."]);
  audio.emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
});

test("cancelling an utterance stops its single continuous audio track", async () => {
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
  assert.deepEqual(fetched, ["First thought. Second thought."]);
  assert.equal(audio.paused, true);
  assert.equal(revoked, true);
});

test("warming up posts to the speech warmup endpoint once and ignores failures", async () => {
  const { warmUpInterviewerSpeech } = await import("../src/lib/interview/speech-playback.mjs");
  const calls = [];
  warmUpInterviewerSpeech("https://api.test/api/v1/speech", async (url, init) => { calls.push([url, init.method]); throw new Error("offline"); });
  warmUpInterviewerSpeech("https://api.test/api/v1/speech", () => { throw new Error("sync failure"); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["https://api.test/api/v1/speech/warmup", "POST"]]);
});
