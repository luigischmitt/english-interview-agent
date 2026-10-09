import assert from "node:assert/strict";
import test from "node:test";
import { composeClosingLead, createClosingReactionTracker, isLastAnswerExpected, isReactionCompatible, startsWithAcknowledgement } from "../src/lib/interview/closing-reaction.mjs";
import { closingLinesFor, composeInterviewClosing, INTERVIEW_CLOSINGS, INTERVIEW_ENDED_CLOSINGS, pickInterviewClosing } from "../src/lib/interview/speech-playback.mjs";

const snapshot = "We traced the slow responses to the cache TTL, so I shortened it and the latency dropped by half.";
const longer = `${snapshot} Then we added an alert so the team notices stale entries early and fixes them quickly.`;

test("an answer is the last one when the next question would not fit once it ends, or when finishing was requested", () => {
  // 5 minute interview: 300 s; the next question needs 30 s left, and a 10 s lookahead is assumed for the answer's tail.
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 100, durationMinutes: 5 }), false);
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 259, durationMinutes: 5 }), false);
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 261, durationMinutes: 5 }), true);
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 300, durationMinutes: 5 }), true);
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 400, durationMinutes: 5 }), true);
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 10, durationMinutes: 5, finishAfter: true }), true);
  assert.equal(isLastAnswerExpected({ elapsedSeconds: 261, durationMinutes: 5, lookaheadSeconds: 0 }), false);
});

test("a reaction stays compatible while its words are still in the final transcript", () => {
  const reaction = "So you traced the slow responses to the cache TTL.";
  assert.equal(isReactionCompatible(reaction, snapshot, snapshot), true);
  assert.equal(isReactionCompatible(reaction, snapshot, longer), true);
  assert.equal(isReactionCompatible(reaction, snapshot, "We migrated billing to separate services because deploys were slow."), false);
  assert.equal(isReactionCompatible(reaction, snapshot, ""), false);
  assert.equal(isReactionCompatible("", snapshot, snapshot), false);
  // Same snapshot wins even when the reaction paraphrases beyond the transcript's words.
  assert.equal(isReactionCompatible("So you fixed the caching.", snapshot, snapshot), true);
});

test("an acknowledgement opening is detected", () => {
  assert.equal(startsWithAcknowledgement("Okay, so you traced it."), true);
  assert.equal(startsWithAcknowledgement("Got it. You traced it."), true);
  assert.equal(startsWithAcknowledgement("So you traced it."), false);
  assert.equal(startsWithAcknowledgement("The cache TTL was the cause."), false);
});

function deferredRequest() {
  const calls = [];
  const request = (text, signal) => new Promise((resolve) => { calls.push({ text, signal, resolve }); });
  return { calls, request };
}

test("the tracker makes at most two calls per answer, only from enough words and clear growth, and aborts the older one", async () => {
  const { calls, request } = deferredRequest();
  const tracker = createClosingReactionTracker({ request });
  assert.equal(tracker.update("q1:0", "Too short to react to."), false);
  assert.equal(tracker.update("q1:0", snapshot), true);
  assert.equal(tracker.update("q1:0", `${snapshot} Yes.`), false);
  assert.equal(tracker.update("q1:0", longer), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  assert.equal(tracker.update("q1:0", `${longer} And more and more and more words follow here to grow it again.`), false);
  assert.equal(tracker.callCount, 2);
  // A new answer window starts over and aborts what is pending.
  assert.equal(tracker.update("q2:0", snapshot), true);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(tracker.callCount, 1);
  tracker.cancel();
  assert.equal(calls[2].signal.aborted, true);
});

test("the tracker returns a ready, compatible reaction at once and tells the caller when one is ready", async () => {
  const ready = [];
  const tracker = createClosingReactionTracker({ request: async () => "So you traced the slow responses to the cache TTL.", onReaction: (reaction, source, context) => ready.push([reaction, source, context]) });
  tracker.update("q:0", snapshot, { tag: "ctx" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(ready, [["So you traced the slow responses to the cache TTL.", snapshot, { tag: "ctx" }]]);
  assert.equal(tracker.peek("q:0")?.reaction, "So you traced the slow responses to the cache TTL.");
  const started = Date.now();
  assert.equal(await tracker.resolve("q:0", snapshot), "So you traced the slow responses to the cache TTL.");
  assert.ok(Date.now() - started < 50);
  // The candidate changed the story: the reaction is discarded.
  assert.equal(await tracker.resolve("q:0", "We rewrote the whole billing service in Rust last year."), null);
});

test("the tracker never waits for a pending reaction longer than the cap", async () => {
  const { request } = deferredRequest();
  const tracker = createClosingReactionTracker({ request });
  tracker.update("q:0", snapshot);
  const started = Date.now();
  assert.equal(await tracker.resolve("q:0", snapshot, { waitMs: 60 }), null);
  const waited = Date.now() - started;
  assert.ok(waited >= 50 && waited < 300, `waited ${waited}`);
  const pending = createClosingReactionTracker({ request: async () => null });
  assert.equal(await pending.resolve("q:0", snapshot), null);
});

test("a reaction that arrives within the wait is used, and failures or nulls fall back to nothing", async () => {
  const tracker = createClosingReactionTracker({ request: () => new Promise((resolve) => setTimeout(() => resolve("So you traced the slow responses to the cache TTL."), 30)) });
  tracker.update("q:0", snapshot);
  assert.equal(await tracker.resolve("q:0", snapshot, { waitMs: 400 }), "So you traced the slow responses to the cache TTL.");
  const failing = createClosingReactionTracker({ request: async () => { throw new Error("boom"); } });
  failing.update("q:0", snapshot);
  assert.equal(await failing.resolve("q:0", snapshot, { waitMs: 100 }), null);
  const empty = createClosingReactionTracker({ request: async () => "   " });
  empty.update("q:0", snapshot);
  assert.equal(await empty.resolve("q:0", snapshot, { waitMs: 100 }), null);
});

test("an older ready reaction is used when the newer call has not finished in time", async () => {
  let call = 0;
  const tracker = createClosingReactionTracker({ request: (_text, signal) => new Promise((resolve) => {
    call += 1;
    if (call === 1) setTimeout(() => resolve("So you traced the slow responses to the cache TTL."), 1);
    else signal.addEventListener("abort", () => resolve(null));
  }) });
  tracker.update("q:0", snapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  tracker.update("q:0", longer);
  assert.equal(await tracker.resolve("q:0", longer, { waitMs: 20 }), "So you traced the slow responses to the cache TTL.");
});

test("closing composition: reaction then the rotating closing line, or the closing line alone", () => {
  const reaction = "So you traced the slow responses to the cache TTL.";
  assert.equal(composeInterviewClosing(reaction, INTERVIEW_CLOSINGS[3]), `${reaction} ${INTERVIEW_CLOSINGS[3]}`);
  assert.equal(composeInterviewClosing(null, INTERVIEW_CLOSINGS[3]), INTERVIEW_CLOSINGS[3]);
  // Text-only: the acknowledgement word is part of the lead text.
  assert.equal(composeInterviewClosing(`Okay. ${reaction}`, INTERVIEW_CLOSINGS[0]), `Okay. ${reaction} ${INTERVIEW_CLOSINGS[0]}`);
});

const reactionText = "So you traced the slow responses to the cache TTL.";
const readyTracker = async (key = "q1:0") => {
  const tracker = createClosingReactionTracker({ request: async () => reactionText });
  tracker.update(key, snapshot);
  await new Promise((resolve) => setTimeout(resolve, 5));
  return tracker;
};

test("a reaction prepared for a previous turn is never used for another turn", async () => {
  const tracker = await readyTracker("q1:0");
  assert.equal(tracker.peek("q1:0")?.reaction, reactionText);
  assert.equal(tracker.peek("q2:0"), null);
  assert.equal(await tracker.resolve("q2:0", snapshot), null);
  assert.equal(await tracker.resolve("q1:0", snapshot), reactionText);
  assert.equal(tracker.peek(), null);
});

test("cancelling the tracker (a turn change) forgets the reactions and aborts pending calls", async () => {
  const tracker = await readyTracker("q1:0");
  tracker.cancel();
  assert.equal(tracker.peek("q1:0"), null);
  assert.equal(await tracker.resolve("q1:0", snapshot), null);
  const { calls, request } = deferredRequest();
  const pending = createClosingReactionTracker({ request });
  pending.update("q1:0", snapshot);
  pending.cancel();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(pending.callCount, 0);
});

const leadDeps = (tracker, overrides = {}) => ({ tracker, key: "q1:0", answer: snapshot, acknowledge: true, canAcknowledge: true, playAcknowledgement: () => true, audio: true, pickWord: () => "Okay.", ...overrides });

test("the closing lead ignores a stale reaction from another turn", async () => {
  const tracker = await readyTracker("q1:0");
  assert.equal(await composeClosingLead(leadDeps(tracker, { key: "q2:0" })), null);
  assert.equal(await composeClosingLead(leadDeps(tracker)), reactionText);
});

test("a leading acknowledgement of the reaction is stripped when the acknowledgement already played", async () => {
  const tracker = createClosingReactionTracker({ request: async () => `Okay, ${reactionText.charAt(0).toLowerCase()}${reactionText.slice(1)}` });
  tracker.update("q1:0", snapshot);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await composeClosingLead(leadDeps(tracker, { acknowledge: false })), reactionText);
  // The acknowledgement is not played again either.
  let played = 0;
  await composeClosingLead(leadDeps(tracker, { playAcknowledgement: () => { played += 1; return true; } }));
  assert.equal(played, 0);
});

test("text-only closing lead adds the acknowledgement word; finishNow without a transcript has no lead at all", async () => {
  const tracker = await readyTracker();
  assert.equal(await composeClosingLead(leadDeps(tracker, { audio: false })), `Okay. ${reactionText}`);
  assert.equal(await composeClosingLead(leadDeps(tracker, { audio: false, acknowledge: false })), reactionText);
  const empty = createClosingReactionTracker({ request: async () => null });
  assert.equal(await composeClosingLead(leadDeps(empty, { audio: true })), null);
  // No transcript: the room skips the lead and speaks only the ended closing.
  assert.equal(composeInterviewClosing(null, INTERVIEW_ENDED_CLOSINGS[0]), INTERVIEW_ENDED_CLOSINGS[0]);
});

test("questions exhausted: ready reaction for this turn plus the ended closing", async () => {
  const tracker = await readyTracker();
  const lead = await composeClosingLead(leadDeps(tracker, { acknowledge: false }));
  const line = pickInterviewClosing(null, () => 0, "ended");
  assert.equal(composeInterviewClosing(lead, line), `${reactionText} ${INTERVIEW_ENDED_CLOSINGS[0]}`);
});

test("closing reason picks its own set and rotates inside it", () => {
  assert.equal(closingLinesFor("ended"), INTERVIEW_ENDED_CLOSINGS);
  assert.equal(closingLinesFor("time_up"), INTERVIEW_CLOSINGS);
  assert.equal(closingLinesFor(), INTERVIEW_CLOSINGS);
  for (const line of INTERVIEW_ENDED_CLOSINGS) {
    assert.doesNotMatch(line, /\b(?:time|out of time)\b/i);
    assert.match(line, /feedback/i);
    for (const random of [0, 0.4, 0.999]) assert.notEqual(pickInterviewClosing(line, () => random, "ended"), line);
  }
  assert.ok(INTERVIEW_ENDED_CLOSINGS.length >= 3 && INTERVIEW_ENDED_CLOSINGS.length <= 4);
  for (const random of [0, 0.5, 0.999]) {
    assert.ok(INTERVIEW_CLOSINGS.includes(pickInterviewClosing(null, () => random, "time_up")));
    assert.ok(INTERVIEW_ENDED_CLOSINGS.includes(pickInterviewClosing(null, () => random, "ended")));
    // A last-used line from the other set does not restrict this set.
    assert.ok(INTERVIEW_ENDED_CLOSINGS.includes(pickInterviewClosing(INTERVIEW_CLOSINGS[0], () => random, "ended")));
  }
  assert.equal(new Set(INTERVIEW_ENDED_CLOSINGS.map((_l, i) => pickInterviewClosing(null, () => i / INTERVIEW_ENDED_CLOSINGS.length, "ended"))).size, INTERVIEW_ENDED_CLOSINGS.length);
});
