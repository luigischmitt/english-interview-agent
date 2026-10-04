import assert from "node:assert/strict";
import test from "node:test";
import { buildStreamStartMessage, createAccessTokenReader, createAuthorizedFetch, onSessionExpired, sessionExpiredEvent, sessionExpiredMessage, UnauthenticatedError } from "../src/lib/auth/access-token.mjs";
import { synthesizeInterviewerQuestion, clearRetainedSpeechBlobs } from "../src/lib/interview/speech-playback.mjs";

import { transcriptionFailureMessage } from "../src/lib/interview/transcription-state.mjs";

test("reads the access token from the current session", async () => {
  const getToken = createAccessTokenReader(async () => ({ access_token: "token-1" }), new EventTarget());
  assert.equal(await getToken(), "token-1");
});

test("without a session it throws UnauthenticatedError and raises the session-expired notice", async () => {
  const target = new EventTarget();
  let notices = 0;
  onSessionExpired(() => { notices += 1; }, target);
  for (const session of [null, {}, { access_token: "" }]) {
    await assert.rejects(createAccessTokenReader(async () => session, target)(), (error) => error instanceof UnauthenticatedError && error.message === sessionExpiredMessage);
  }
  await assert.rejects(createAccessTokenReader(async () => { throw new Error("boom"); }, target)(), UnauthenticatedError);
  assert.equal(notices, 4);
  assert.equal(typeof sessionExpiredEvent, "string");
});

test("authorized fetch adds the bearer token and keeps the caller's headers", async () => {
  let seen;
  const authorized = createAuthorizedFetch(async () => "abc", async (input, init) => { seen = { input, init }; return new Response("{}", { status: 200 }); }, new EventTarget());
  const response = await authorized("http://backend/api/v1/thinking/next-turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  assert.equal(seen.init.headers.get("authorization"), "Bearer abc");
  assert.equal(seen.init.headers.get("content-type"), "application/json");
  assert.equal(seen.init.method, "POST");
});

test("authorized fetch raises the session-expired notice on 401 and does not call the backend without a token", async () => {
  const target = new EventTarget();
  let notices = 0;
  onSessionExpired(() => { notices += 1; }, target);
  const rejected = createAuthorizedFetch(async () => "abc", async () => new Response("{}", { status: 401 }), target);
  assert.equal((await rejected("http://backend/x")).status, 401);
  assert.equal(notices, 1);

  let called = false;
  const noSession = createAuthorizedFetch(createAccessTokenReader(async () => null, target), async () => { called = true; return new Response("{}"); }, target);
  await assert.rejects(noSession("http://backend/x"), UnauthenticatedError);
  assert.equal(called, false);
  assert.equal(notices, 2);
});

const timers = { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (id) => clearTimeout(id) };

test("speech synthesis sends the token through the supplied fetcher and surfaces a missing session", async () => {
  clearRetainedSpeechBlobs();
  let auth = null;
  const fetcher = createAuthorizedFetch(async () => "speech-token", async (_input, init) => { auth = init.headers.get("authorization"); return new Response(JSON.stringify({ error: { message: sessionExpiredMessage } }), { status: 401 }); }, new EventTarget());
  const result = await synthesizeInterviewerQuestion("Hello there", { endpoint: "http://backend/api/v1/speech", fetcher, ...timers }).promise;
  assert.equal(auth, "Bearer speech-token");
  assert.deepEqual(result, { status: "unavailable", message: sessionExpiredMessage });

  const noSession = createAuthorizedFetch(createAccessTokenReader(async () => null, new EventTarget()), fetch, new EventTarget());
  const second = await synthesizeInterviewerQuestion("Hello again", { endpoint: "http://backend/api/v1/speech", fetcher: noSession, ...timers }).promise;
  assert.deepEqual(second, { status: "unavailable", message: sessionExpiredMessage });
});

test("the transcription start message carries the access token", () => {
  const message = buildStreamStartMessage({ accessToken: "ws-token", speechThreshold: 0.025, sampleRate: 16_000, captions: true, question: "Why?" });
  assert.deepEqual(message, { type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, accessToken: "ws-token", captions: true, question: "Why?" });
  assert.equal("captions" in buildStreamStartMessage({ accessToken: "t", speechThreshold: 0.1, sampleRate: 16_000, captions: false }), false);
});

test("an UNAUTHENTICATED stream error maps to the session-expired message", () => {
  assert.match(transcriptionFailureMessage("UNAUTHENTICATED"), /sessão expirou/u);
});

test("buildStreamStartMessage carries a valid transcription engine and drops anything else", () => {
  const base = { accessToken: "t", speechThreshold: 0.025, sampleRate: 16_000 };
  assert.equal(buildStreamStartMessage({ ...base, transcriptionEngine: "whisper" }).transcriptionEngine, "whisper");
  assert.equal(buildStreamStartMessage({ ...base, transcriptionEngine: "ink-2" }).transcriptionEngine, "ink-2");
  assert.equal("transcriptionEngine" in buildStreamStartMessage(base), false);
  assert.equal("transcriptionEngine" in buildStreamStartMessage({ ...base, transcriptionEngine: "other" }), false);
});
