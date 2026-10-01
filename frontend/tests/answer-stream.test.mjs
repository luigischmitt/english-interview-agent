import assert from "node:assert/strict";
import test from "node:test";
import { createAnswerStream, StreamConnectionError, StreamSetupError } from "../src/lib/interview/answer-stream.mjs";
import { FakeSocket, tick } from "./mic-fakes.mjs";

function harness(overrides = {}) {
  const sockets = [];
  const timers = [];
  const events = { messages: [], closes: [], failures: [] };
  const stream = createAnswerStream({
    openSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    buildStartMessage: async () => ({ type: "start", accessToken: "token", speechThreshold: 0.02 }),
    encodeFrame: (samples) => new Int16Array(samples.length).buffer,
    onMessage: (message) => events.messages.push(message.type),
    onClose: (event) => events.closes.push(event.code),
    onFailure: (reason) => events.failures.push(reason),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
    ...overrides,
  });
  return { stream, sockets, timers, events };
}
const frame = (level = 0.1) => ({ samples: new Float32Array(1_600), level });

async function connectReady(h) {
  const connecting = h.stream.connect();
  await tick();
  h.sockets.at(-1).open();
  h.sockets.at(-1).serverSays({ type: "ready", features: { pronunciationAssessment: true } });
  return connecting;
}

test("pre-connect authenticates and waits for ready but sends no audio and no levels", async () => {
  const h = harness();
  await connectReady(h);
  assert.equal(h.stream.state, "ready");
  assert.deepEqual(h.sockets[0].messageTypes(), ["start"]);
  assert.equal(h.sockets[0].json()[0].accessToken, "token");

  h.stream.pushFrame(frame()); // the answer window has not opened: dropped
  h.stream.pushFrame(frame());
  assert.deepEqual(h.sockets[0].sent.length, 1);
});

test("begin on a ready socket streams from that instant with zero wait", async () => {
  const h = harness();
  await connectReady(h);
  const begun = h.stream.begin();
  assert.equal(h.stream.state, "streaming", "streaming is synchronous when the socket is ready");
  const result = await begun;
  assert.equal(result.preconnected, true);
  assert.equal(result.readyMessage.features.pronunciationAssessment, true);
  h.stream.pushFrame(frame(0.3));
  assert.deepEqual(h.sockets[0].messageTypes(), ["start", "level"]);
  assert.equal(h.sockets[0].audioFrames().length, 1);
  assert.equal(h.sockets[0].json()[1].value, 0.3);
  assert.equal(h.sockets.length, 1, "no second connection");
});

test("when the socket is not ready at begin, post-begin frames are buffered and sent in order once ready", async () => {
  const h = harness();
  const pre = h.stream.connect();
  await tick();
  const socket = h.sockets[0];
  socket.open();
  const begun = h.stream.begin();
  h.stream.pushFrame(frame(0.1));
  h.stream.pushFrame(frame(0.2));
  assert.equal(h.stream.state, "connecting");
  assert.deepEqual(socket.messageTypes(), ["start"], "nothing is sent before ready");
  socket.serverSays({ type: "ready" });
  await pre;
  h.stream.pushFrame(frame(0.3)); // arrives between ready and the begin continuation
  const result = await begun;
  assert.equal(result.preconnected, false);
  h.stream.pushFrame(frame(0.4));
  const levels = socket.json().filter((message) => message.type === "level").map((message) => message.value);
  assert.deepEqual(levels, [0.1, 0.2, 0.3, 0.4]);
  assert.equal(socket.audioFrames().length, 4);
});

test("begin without a pre-connect connects fresh and keeps the frames captured meanwhile", async () => {
  const h = harness();
  const begun = h.stream.begin();
  h.stream.pushFrame(frame(0.5));
  await tick();
  h.sockets[0].open();
  h.sockets[0].serverSays({ type: "ready" });
  await begun;
  assert.deepEqual(h.sockets[0].messageTypes(), ["start", "level"]);
});

test("a failed pre-connect is retried once with a fresh socket and no frame is lost", async () => {
  const h = harness();
  h.stream.connect();
  await tick();
  h.sockets[0].open();
  const begun = h.stream.begin();
  h.stream.pushFrame(frame(0.7));
  h.sockets[0].onerror();
  await tick();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  h.sockets[1].serverSays({ type: "ready" });
  await begun;
  assert.deepEqual(h.sockets[1].messageTypes(), ["start", "level"]);
  assert.equal(h.sockets[0].audioFrames().length, 0);
});

test("a pre-opened socket that dropped while idle is replaced at begin", async () => {
  const h = harness();
  await connectReady(h);
  h.sockets[0].serverClose(1006);
  assert.equal(h.stream.state, "failed");
  assert.deepEqual(h.events.closes, [], "an idle pre-connect failure is silent");
  const begun = h.stream.begin();
  await tick();
  h.sockets[1].open();
  h.sockets[1].serverSays({ type: "ready" });
  await begun;
  assert.equal(h.stream.state, "streaming");
});

test("cancel of a pre-opened socket sends cancel, closes it and sends no audio", async () => {
  const h = harness();
  await connectReady(h);
  h.stream.cancel();
  assert.deepEqual(h.sockets[0].messageTypes(), ["start", "cancel"]);
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.sockets[0].onmessage, null);
  assert.equal(h.stream.state, "closed");
  h.stream.pushFrame(frame());
  assert.equal(h.sockets[0].audioFrames().length, 0);
  await assert.rejects(h.stream.begin(), StreamConnectionError);
});

test("cancel while the start message is still being built opens no socket", async () => {
  let release;
  const h = harness({ buildStartMessage: () => new Promise((resolve) => { release = () => resolve({ type: "start" }); }) });
  const connecting = h.stream.connect();
  connecting.catch(() => {});
  h.stream.cancel();
  release();
  await tick();
  assert.equal(h.sockets.length, 0);
});

test("setup errors and timeouts reject with typed errors", async () => {
  const rejected = harness();
  const attempt = rejected.stream.connect();
  await tick();
  rejected.sockets[0].open();
  rejected.sockets[0].serverSays({ type: "error", code: "UNAUTHENTICATED" });
  await assert.rejects(attempt, (error) => error instanceof StreamSetupError && error.code === "UNAUTHENTICATED");
  assert.equal(rejected.sockets[0].closed, true);

  const slow = harness();
  const waiting = slow.stream.connect();
  await tick();
  slow.timers[0].callback();
  await assert.rejects(waiting, (error) => error instanceof StreamConnectionError && error.kind === "timeout");
});

test("messages are ignored before the gate opens and delivered afterwards; an idle error invalidates the socket", async () => {
  const h = harness();
  await connectReady(h);
  h.sockets[0].serverSays({ type: "caption" });
  assert.deepEqual(h.events.messages, []);
  const begun = h.stream.begin();
  await begun;
  h.sockets[0].serverSays({ type: "speech-started" });
  h.sockets[0].serverClose(1011);
  assert.deepEqual(h.events.messages, ["speech-started"]);
  assert.deepEqual(h.events.closes, [1011]);

  const idle = harness();
  await connectReady(idle);
  idle.sockets[0].serverSays({ type: "error", code: "STREAM_UNAVAILABLE" });
  assert.equal(idle.stream.state, "failed");
});

test("the pending buffer is bounded and a slow or closed socket is reported", async () => {
  const bounded = harness({ maxBufferedFrames: 3 });
  bounded.stream.begin().catch(() => {});
  for (let index = 0; index < 5; index += 1) bounded.stream.pushFrame(frame());
  assert.deepEqual(bounded.events.failures, ["buffer"]);

  const slow = harness({ maxSocketBufferBytes: 10 });
  await connectReady(slow);
  await slow.stream.begin();
  slow.sockets[0].bufferedAmount = 11;
  slow.stream.pushFrame(frame());
  assert.deepEqual(slow.events.failures, ["slow"]);
  assert.equal(slow.sockets[0].audioFrames().length, 0);

  const closed = harness();
  await connectReady(closed);
  await closed.stream.begin();
  closed.sockets[0].readyState = 3;
  closed.stream.pushFrame(frame());
  assert.deepEqual(closed.events.failures, ["closed"]);
});
