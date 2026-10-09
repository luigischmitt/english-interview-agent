import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { maxClientEventsPerRequest, sanitizeClientEvent } from "../src/controllers/client-events-controller.js";
import type { SpeechConfig } from "../src/speech/config.js";
import { createTestKey, fakeJwksFetch, signToken, testSupabaseUrl } from "./auth-helper.js";
import { createAccessTokenVerifier } from "../src/auth/access-token-verifier.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8880", kokoroTimeoutMs: 15_000, interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3" };

function appWithLog() {
  const lines: string[] = [];
  const app = createApp({ speechConfig, accessTokenVerifier: null, clientEventLogger: (line) => lines.push(line) });
  return { app, lines };
}

describe("sanitizeClientEvent", () => {
  it("keeps only whitelisted, well-typed fields", () => {
    const event = sanitizeClientEvent({
      kind: "playback_ended", chunkIndex: 2, mediaMuted: false, mediaVolume: 1, audioSessionType: "play-and-record", platform: "ios", errorName: "NotAllowedError",
      text: "secret answer", url: "blob:https://x/1", token: "abc", userId: "u1", mediaVolume2: 3,
    });
    expect(event).toEqual({ kind: "playback_ended", errorName: "NotAllowedError", audioSessionType: "play-and-record", platform: "ios", chunkIndex: 2, mediaVolume: 1, mediaMuted: false });
  });

  it("keeps mic_error with a whitelisted errorName and inAppBrowser only", () => {
    expect(sanitizeClientEvent({ kind: "mic_error", errorName: "NotAllowedError", inAppBrowser: "google", message: "x" })).toEqual({ kind: "mic_error", errorName: "NotAllowedError", inAppBrowser: "google" });
    expect(sanitizeClientEvent({ kind: "unlock", inAppBrowser: "none" })).toEqual({ kind: "unlock", inAppBrowser: "none" });
    expect(sanitizeClientEvent({ kind: "mic_error", errorName: "free text", inAppBrowser: "whatsapp" })).toEqual({ kind: "mic_error" });
  });

  it("keeps inputDeviceKind and peakLevel on mic events but never a device label", () => {
    expect(sanitizeClientEvent({ kind: "mic_open", micActive: true, inputDeviceKind: "continuity", label: "iPhone de Lucas", deviceId: "abc" }))
      .toEqual({ kind: "mic_open", inputDeviceKind: "continuity", micActive: true });
    expect(sanitizeClientEvent({ kind: "mic_level_check", peakLevel: 0.0421, inputDeviceKind: "builtin" }))
      .toEqual({ kind: "mic_level_check", inputDeviceKind: "builtin", peakLevel: 0.042 });
    expect(sanitizeClientEvent({ kind: "mic_level_check", peakLevel: 3, inputDeviceKind: "iPhone de Lucas" })).toEqual({ kind: "mic_level_check" });
  });

  it("keeps content-free acknowledgement diagnostics with their timing fields", () => {
    expect(sanitizeClientEvent({ kind: "ack_play", answerToAckMs: 452, phrase: "Okay.", text: "secret" })).toEqual({ kind: "ack_play", answerToAckMs: 452 });
    expect(sanitizeClientEvent({ kind: "ack_ended", ackDurationMs: 640 })).toEqual({ kind: "ack_ended", ackDurationMs: 640 });
    expect(sanitizeClientEvent({ kind: "ack_question_gap", ackToQuestionMs: 321 })).toEqual({ kind: "ack_question_gap", ackToQuestionMs: 321 });
    expect(sanitizeClientEvent({ kind: "ack_skipped", reason: "question_started" })).toEqual({ kind: "ack_skipped", reason: "question_started" });
    expect(sanitizeClientEvent({ kind: "ack_skipped", reason: "free text" })).toEqual({ kind: "ack_skipped" });
    expect(sanitizeClientEvent({ kind: "ack_preloaded", loaded: 5, total: 5 })).toEqual({ kind: "ack_preloaded", loaded: 5, total: 5 });
    for (const kind of ["ack_play_resolved", "ack_play_failed", "ack_overlap"]) expect(sanitizeClientEvent({ kind })).toEqual({ kind });
  });

  it("keeps only allowlisted preparation, handoff and transcription failure metrics", () => {
    expect(sanitizeClientEvent({ kind: "turn_preparation", preparationType: "speculative", outcome: "prepared_used", preparationReason: "mismatch", usedCount: 1, discardedCount: 2, transcript: "secret" }))
      .toEqual({ kind: "turn_preparation", preparationType: "speculative", outcome: "prepared_used", preparationReason: "mismatch", usedCount: 1, discardedCount: 2 });
    expect(sanitizeClientEvent({ kind: "turn_preparation", preparationType: "fixed", outcome: "used", plannedCount: 2, readyCount: 1, startedBeforeCompleteMs: 90000, readyBeforeCompleteMs: 3000, usedIndex: 0, question: "secret" }))
      .toEqual({ kind: "turn_preparation", preparationType: "fixed", outcome: "used", plannedCount: 2, readyCount: 1, startedBeforeCompleteMs: 90000, readyBeforeCompleteMs: 3000, usedIndex: 0 });
    expect(sanitizeClientEvent({ kind: "question_start_timing", confirmationToFirstAudioMs: 120, confirmationToQuestionAudioMs: 850, confirmationToFinalChunkStartMs: 1_100, firstAudioToFinalChunkStartMs: 980, maxInterChunkGapMs: 80, text: "secret" }))
      .toEqual({ kind: "question_start_timing", confirmationToFirstAudioMs: 120, confirmationToQuestionAudioMs: 850, confirmationToFinalChunkStartMs: 1_100, firstAudioToFinalChunkStartMs: 980, maxInterChunkGapMs: 80 });
    expect(sanitizeClientEvent({ kind: "transcription_failure", failureReason: "timeout", code: "free text" }))
      .toEqual({ kind: "transcription_failure", failureReason: "timeout" });
    expect(sanitizeClientEvent({ kind: "transcription_failure", failureReason: "answer text" })).toEqual({ kind: "transcription_failure" });
    expect(sanitizeClientEvent({ kind: "turn_preparation", preparationType: "speculative", outcome: "ready", plannedCount: 2, revision: 3, elapsedMs: 81, prepared: true }))
      .toEqual({ kind: "turn_preparation", preparationType: "speculative", outcome: "ready", plannedCount: 2, revision: 3, elapsedMs: 81, prepared: true });
    expect(sanitizeClientEvent({ kind: "turn_preparation", preparationType: "speculative", outcome: "decision_ready", revision: 3, elapsedMs: 81, prepared: false }))
      .toEqual({ kind: "turn_preparation", preparationType: "speculative", outcome: "decision_ready", revision: 3, elapsedMs: 81, prepared: false });
    expect(sanitizeClientEvent({ kind: "handoff_timing", totalMs: 1_200, whisperMs: 500, decisionMs: 200, prepared: true, transcript: "secret" }))
      .toEqual({ kind: "handoff_timing", totalMs: 1_200, whisperMs: 500, decisionMs: 200, prepared: true });
  });

  it("drops invalid enums, out-of-range numbers and wrong types", () => {
    expect(sanitizeClientEvent({ kind: "playback_error", errorName: "Some free text", platform: "windows", mediaVolume: 5, elapsedMs: -1, chunkIndex: "1", micActive: "yes", readyState: Number.NaN }))
      .toEqual({ kind: "playback_error" });
  });

  it("rejects events without a known kind", () => {
    expect(sanitizeClientEvent({ kind: "my transcript" })).toBeNull();
    expect(sanitizeClientEvent({})).toBeNull();
    expect(sanitizeClientEvent("x")).toBeNull();
    expect(sanitizeClientEvent(null)).toBeNull();
  });
});

describe("POST /api/v1/client-events", () => {
  it("logs one structured line per valid event and never leaks extra fields", async () => {
    const { app, lines } = appWithLog();
    const response = await request(app).post("/api/v1/client-events").send([
      { kind: "unlock", platform: "ios", text: "hello" },
      { kind: "nope" },
      { kind: "mic_open", micActive: true, audioContextState: "running", url: "http://x" },
    ]);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: 2 });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "client_audio_diagnostic", kind: "unlock", platform: "ios" },
      { event: "client_audio_diagnostic", kind: "mic_open", audioContextState: "running", micActive: true },
    ]);
    expect(lines.join("")).not.toMatch(/hello|http/);
  });

  it("accepts an { events } envelope", async () => {
    const { app, lines } = appWithLog();
    expect((await request(app).post("/api/v1/client-events").send({ events: [{ kind: "audio_session" }] })).status).toBe(202);
    expect(lines).toHaveLength(1);
  });

  it("rejects empty, oversized and non-array bodies", async () => {
    const { app, lines } = appWithLog();
    const many = Array.from({ length: maxClientEventsPerRequest + 1 }, () => ({ kind: "unlock" }));
    expect((await request(app).post("/api/v1/client-events").send(many)).status).toBe(400);
    expect((await request(app).post("/api/v1/client-events").send([])).status).toBe(400);
    expect((await request(app).post("/api/v1/client-events").send({ kind: "unlock" })).status).toBe(400);
    expect(lines).toHaveLength(0);
  });

  it("requires an access token", async () => {
    const key = createTestKey();
    const verifier = createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl: fakeJwksFetch(() => [key]).fetchImpl });
    const lines: string[] = [];
    const app = createApp({ speechConfig, accessTokenVerifier: verifier, clientEventLogger: (line) => lines.push(line) });
    expect((await request(app).post("/api/v1/client-events").send([{ kind: "unlock" }])).status).toBe(401);
    const ok = await request(app).post("/api/v1/client-events").set("Authorization", `Bearer ${signToken(key)}`).send([{ kind: "unlock" }]);
    expect(ok.status).toBe(202);
    expect(lines).toHaveLength(1);
  });
});
