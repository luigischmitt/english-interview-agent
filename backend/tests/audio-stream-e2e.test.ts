import { createServer } from "node:http";

import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { aggregateAudioE2EMetrics, applyEvaluationAudioProfile, buildSpeechUrl, buildStreamUrl, calculateTranscriptErrors, calculateTranscriptSimilarity, exerciseStream, fetchSpeechAudio, framePcm, isSuccessfulAudioE2ERun, parseArgs, rmsLevel, type AudioE2EMetrics } from "../src/transcription/audio-stream-e2e.js";
import { transcriptionEvaluationCorpus } from "../src/transcription/transcription-evaluation-corpus.js";

describe("real-time audio E2E harness utilities", () => {
  it("parses CLI configuration and rejects URLs that could expose credentials", () => {
    const options = parseArgs(["--backend-url", "http://localhost:3001", "--speed=1.2", "--text=A short=answer."], {});
    expect(options.backendUrl.href).toBe("http://localhost:3001/");
    expect(options.speed).toBe(1.2);
    expect(options.text).toBe("A short=answer.");
    expect(() => parseArgs(["--backend-url", "https://user:secret@example.test"], {})).toThrow(/without credentials/);
    expect(() => parseArgs(["--backend-url", "https://example.test/?token=secret"], {})).toThrow(/without credentials/);
  });

  it("builds speech and stream endpoints at the origin root or beneath a base path", () => {
    const root = new URL("http://localhost:3001/");
    expect(buildSpeechUrl(root).href).toBe("http://localhost:3001/api/v1/speech");
    expect(buildStreamUrl(root).href).toBe("ws://localhost:3001/api/v1/transcriptions/stream");

    const prefixed = new URL("https://example.test/interview-api/");
    expect(buildSpeechUrl(prefixed).href).toBe("https://example.test/interview-api/api/v1/speech");
    expect(buildStreamUrl(prefixed).href).toBe("wss://example.test/interview-api/api/v1/transcriptions/stream");
  });

  it("uses a default spoken answer long enough to exercise final transcription", () => {
    const defaultAnswer = parseArgs([], {}).text;
    expect(defaultAnswer.split(/\s+/u).length).toBeGreaterThanOrEqual(70);
  });

  it("keeps final transcription failures unsuccessful while retaining safe diagnostics", () => {
    const metrics: AudioE2EMetrics = {
      speechGenerationMs: 100,
      connectToReadyMs: 20,
      firstSpeechMs: 120,
      transcriptionMs: null,
      finalizationToCompleteMs: null,
      queueWaitMs: null,
      silenceDetectedMs: null,
      completeMs: 15_000,
      streamErrors: [{ type: "error" }],
      missingEvents: ["silence-detected"],
      transcriptCharacters: 42,
      transcriptSimilarity: null,
      expectedWords: 0,
      omittedWords: 0,
      substitutedWords: 0,
      insertedWords: 0,
      completionStatus: null,
      requireAssessment: false,
      assessmentStatus: null,
      segmented: null,
      assessedDurationMs: null,
      assessmentScoresAvailable: null,
    };
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.streamErrors = [];
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.completionStatus = "complete";
    metrics.transcriptionMs = 15_000;
    metrics.missingEvents = [];
    metrics.transcriptSimilarity = 0.9;
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(true);
    metrics.transcriptSimilarity = 0.74;
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.transcriptCharacters = 0;
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
  });

  it("parses the opt-in assessment switch from CLI and environment", () => {
    expect(parseArgs([], {}).requireAssessment).toBe(false);
    expect(parseArgs(["--require-assessment"], {}).requireAssessment).toBe(true);
    expect(parseArgs(["--require-assessment=false"], {}).requireAssessment).toBe(false);
    expect(parseArgs([], { AUDIO_E2E_REQUIRE_ASSESSMENT: "true" }).requireAssessment).toBe(true);
    expect(parseArgs([], { AUDIO_E2E_REQUIRE_ASSESSMENT: "1" }).requireAssessment).toBe(false);
    expect(() => parseArgs(["--require-assessment=yes"], {})).toThrow(/boolean flag/);
  });

  it("parses the aggregate corpus suite switch without exposing case names", () => {
    expect(parseArgs(["--suite"], {}).suite).toBe(true);
    expect(parseArgs([], { AUDIO_E2E_SUITE: "true" }).suite).toBe(true);
    expect(parseArgs([], {}).suite).toBe(false);
    expect(() => parseArgs(["--suite=maybe"], {})).toThrow(/boolean flag/);
  });

  it("requires a segmented available assessment only when enabled", () => {
    const metrics: AudioE2EMetrics = {
      speechGenerationMs: 100, connectToReadyMs: 1, firstSpeechMs: 2,
      transcriptionMs: 3, queueWaitMs: null, silenceDetectedMs: 4,
      finalizationToCompleteMs: 3,
      completeMs: 5, streamErrors: [], missingEvents: [], transcriptCharacters: 30,
      transcriptSimilarity: 1, completionStatus: "complete", requireAssessment: true,
      expectedWords: 4, omittedWords: 0, substitutedWords: 0, insertedWords: 0,
      assessmentStatus: "available", segmented: true, assessedDurationMs: 5,
      assessmentScoresAvailable: { accuracy: true, fluency: false, prosody: false },
    };
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(true);
    metrics.segmented = false;
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.segmented = true;
    metrics.assessmentStatus = "unavailable";
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.assessmentStatus = "available";
    metrics.assessmentScoresAvailable = { accuracy: false, fluency: false, prosody: false };
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
  });

  it("calculates a normalized token similarity without retaining transcript text", () => {
    expect(calculateTranscriptSimilarity("Café teams ship features.", "Cafe team ship feature!")).toBe(0.5);
    expect(calculateTranscriptSimilarity("one two three four", "one two three four")).toBe(1);
    expect(calculateTranscriptSimilarity("one two", "one two extra words here")).toBe(0);
  });

  it("handles empty strings and chooses a stable path for ambiguous edit alignments", () => {
    expect(calculateTranscriptErrors("", "")).toEqual({
      expectedWords: 0, omittedWords: 0, substitutedWords: 0, insertedWords: 0, similarity: 1,
    });
    expect(calculateTranscriptErrors("", "unexpected words")).toEqual({
      expectedWords: 0, omittedWords: 0, substitutedWords: 0, insertedWords: 2, similarity: 0,
    });
    expect(calculateTranscriptErrors("expected words", "")).toEqual({
      expectedWords: 2, omittedWords: 2, substitutedWords: 0, insertedWords: 0, similarity: 0,
    });
    // Two equal-cost alignments exist: two substitutions, or one omission plus one insertion.
    // The implementation's stable tie-break preserves the earliest omission/insertion path.
    expect(calculateTranscriptErrors("a b", "b c")).toEqual({
      expectedWords: 2, omittedWords: 1, substitutedWords: 0, insertedWords: 1, similarity: 0,
    });
  });

  it("counts omissions, substitutions, and insertions using a versioned synthetic corpus", () => {
    expect(calculateTranscriptErrors("one two three", "one four")).toEqual({
      expectedWords: 3, omittedWords: 1, substitutedWords: 1, insertedWords: 0, similarity: 0.333,
    });
    expect(calculateTranscriptErrors("one two", "one two extra")).toEqual({
      expectedWords: 2, omittedWords: 0, substitutedWords: 0, insertedWords: 1, similarity: 0.5,
    });
    expect(transcriptionEvaluationCorpus.map(({ profile }) => profile)).toEqual([
      "technical", "acronyms", "numbers", "pauses", "self-correction", "quiet", "noise", "short", "long",
    ]);
    const source = Buffer.alloc(3_200);
    source.writeInt16LE(10_000, 0);
    expect(applyEvaluationAudioProfile(source, "quiet").readInt16LE(0)).toBe(5_500);
    expect(applyEvaluationAudioProfile(source, "pauses")).toEqual(source);
    expect(applyEvaluationAudioProfile(source, "self-correction")).toEqual(source);
    expect(applyEvaluationAudioProfile(source, "noise")).not.toEqual(source);
    const quietOptions = parseArgs(["--case", "quiet"], {});
    expect(quietOptions.evaluationProfile).toBe("quiet");
    expect(quietOptions.text).not.toBe("quiet");
    expect(() => parseArgs(["--case", "unlisted"], {})).toThrow(/versioned evaluation corpus/);
  });

  it("aggregates suite metrics without network calls or case identifiers", () => {
    const base: AudioE2EMetrics = {
      requireAssessment: false, speechGenerationMs: 100, connectToReadyMs: 10, firstSpeechMs: 20,
      transcriptionMs: 300, finalizationToCompleteMs: 350, queueWaitMs: 50, silenceDetectedMs: 400,
      completeMs: 800, streamErrors: [], missingEvents: [], transcriptCharacters: 20,
      transcriptSimilarity: 0.9, expectedWords: 10, omittedWords: 1, substitutedWords: 0, insertedWords: 0,
      completionStatus: "complete", assessmentStatus: null, segmented: null, assessedDurationMs: null,
      assessmentScoresAvailable: null,
    };
    const second: AudioE2EMetrics = {
      ...base, transcriptSimilarity: 0.7, expectedWords: 20, omittedWords: 2,
      substitutedWords: 1, insertedWords: 3, queueWaitMs: null, transcriptionMs: 500,
      finalizationToCompleteMs: null,
    };
    expect(aggregateAudioE2EMetrics([base, second])).toEqual({
      cases: 2, successfulCases: 1, meanSimilarity: 0.8, expectedWords: 30,
      omittedWords: 3, substitutedWords: 1, insertedWords: 3, meanQueueWaitMs: 50,
      meanWhisperMs: 400, meanFinalizationToCompleteMs: 350,
    });
    expect(aggregateAudioE2EMetrics([])).toEqual({
      cases: 0, successfulCases: 0, meanSimilarity: null, expectedWords: 0,
      omittedWords: 0, substitutedWords: 0, insertedWords: 0, meanQueueWaitMs: null,
      meanWhisperMs: null, meanFinalizationToCompleteMs: null,
    });
  });

  it("returns only transcript length in harness metrics, never transcript text", async () => {
    const reference = "Known synthetic spoken answer.";
    let responseText = "";
    const server = createServer();
    const websocketServer = new WebSocketServer({ server });
    let sentSilence = false;
    websocketServer.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === "start") {
          socket.send(JSON.stringify({ type: "ready", protocol: 2 }));
          return;
        }
        if (message.type === "level" && !sentSilence) {
          sentSilence = true;
          socket.send(JSON.stringify({ type: "speech-started" }));
          socket.send(JSON.stringify({ type: "silence-detected" }));
          return;
        }
        if (message.type === "finalize") {
          socket.send(JSON.stringify({ type: "complete", status: "complete", transcript: responseText }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test WebSocket server did not bind to a TCP port.");
    try {
      const options = parseArgs(["--backend-url", `http://127.0.0.1:${address.port}`, "--text", reference], {});
      responseText = reference;
      const metrics = await exerciseStream(options, Buffer.alloc(3_200), 42, 0);
      expect(metrics.completionStatus).toBe("complete");
      expect(metrics.streamErrors).toEqual([]);
      expect(metrics.transcriptCharacters).toBe(reference.length);
      expect(metrics.transcriptSimilarity).toBe(1);
      expect(metrics.completeMs).not.toBeNull();
      expect(metrics.missingEvents).not.toContain("silence-detected");
      expect(isSuccessfulAudioE2ERun(metrics)).toBe(true);
      expect(metrics).not.toHaveProperty("transcript");
      expect(JSON.stringify(metrics)).not.toContain(reference);
    } finally {
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("measures finalization-to-complete time for manual finalization", async () => {
    const server = createServer();
    const websocketServer = new WebSocketServer({ server });
    websocketServer.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === "start") socket.send(JSON.stringify({ type: "ready", protocol: 2 }));
        if (message.type === "finalize") socket.send(JSON.stringify({ type: "complete", status: "complete", transcript: "A short answer." }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test WebSocket server did not bind to a TCP port.");
    try {
      const options = parseArgs(["--backend-url", `http://127.0.0.1:${address.port}`, "--text", "A short answer."], {});
      const metrics = await exerciseStream(options, Buffer.alloc(3_200), 0, 0);
      expect(metrics.completionStatus).toBe("complete");
      expect(metrics.silenceDetectedMs).toBeNull();
      expect(metrics.finalizationToCompleteMs).not.toBeNull();
      expect(metrics.finalizationToCompleteMs).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("waits for one assessment after complete and exposes only safe assessment metadata", async () => {
    const reference = "Known spoken answer.";
    const server = createServer();
    const websocketServer = new WebSocketServer({ server });
    websocketServer.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === "start") socket.send(JSON.stringify({ type: "ready", protocol: 2 }));
        if (message.type === "level") {
          socket.send(JSON.stringify({ type: "speech-started" }));
          socket.send(JSON.stringify({ type: "silence-detected" }));
        }
        if (message.type === "finalize") {
          socket.send(JSON.stringify({ type: "complete", status: "complete", transcript: reference }));
          setTimeout(() => socket.send(JSON.stringify({
            type: "assessment", status: "available", segmented: true, durationMs: 1_200,
            scores: { accuracy: 91, fluency: null, prosody: 82 }, words: [{ word: "SECRET" }],
          })), 10);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test WebSocket server did not bind to a TCP port.");
    try {
      const options = parseArgs(["--backend-url", `http://127.0.0.1:${address.port}`, "--text", reference, "--require-assessment"], {});
      const metrics = await exerciseStream(options, Buffer.alloc(3_200), 42, 0);
      expect(metrics.assessmentStatus).toBe("available");
      expect(metrics.segmented).toBe(true);
      expect(metrics.assessedDurationMs).toBe(1_200);
      expect(metrics.assessmentScoresAvailable).toEqual({ accuracy: true, fluency: false, prosody: true });
      expect(isSuccessfulAudioE2ERun(metrics)).toBe(true);
      expect(JSON.stringify(metrics)).not.toContain("SECRET");
      expect(JSON.stringify(metrics)).not.toContain("91");
    } finally {
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("treats unavailable assessment as a bounded unsuccessful run", async () => {
    const server = createServer();
    const websocketServer = new WebSocketServer({ server });
    websocketServer.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === "start") socket.send(JSON.stringify({ type: "ready", protocol: 2 }));
        if (message.type === "level") {
          socket.send(JSON.stringify({ type: "speech-started" }));
          socket.send(JSON.stringify({ type: "silence-detected" }));
        }
        if (message.type === "finalize") {
          socket.send(JSON.stringify({ type: "complete", status: "complete", transcript: "Known spoken answer." }));
          setTimeout(() => socket.send(JSON.stringify({ type: "assessment", status: "unavailable" })), 10);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test WebSocket server did not bind to a TCP port.");
    try {
      const options = parseArgs(["--backend-url", `http://127.0.0.1:${address.port}`, "--require-assessment"], {});
      const metrics = await exerciseStream(options, Buffer.alloc(3_200), 42, 0);
      expect(metrics.assessmentStatus).toBe("unavailable");
      expect(metrics.segmented).toBeNull();
      expect(metrics.assessmentScoresAvailable).toEqual({ accuracy: false, fluency: false, prosody: false });
      expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("splits PCM into 100 ms frames and pads trailing silence", () => {
    const pcm = Buffer.alloc(2 * 1_600);
    pcm.writeInt16LE(16_384, 0);
    const frames = framePcm(pcm, 0);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(3_200);
    expect(rmsLevel(frames[0])).toBeCloseTo(0.0125, 4);

    const padded = framePcm(pcm, 1);
    expect(padded).toHaveLength(2);
    expect(padded[1].every((byte) => byte === 0)).toBe(true);
  });

  it("keeps the speech timeout active while a response body is stalled", async () => {
    let signalAborted = false;
    const fetcher: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            signalAborted = true;
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "audio/mpeg" } });
    };

    const startedAt = Date.now();
    await expect(fetchSpeechAudio(new URL("http://localhost:3001/api/v1/speech"), { text: "test", speed: 1 }, 25, fetcher))
      .rejects.toThrow(/timed out/);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(signalAborted).toBe(true);
  });

  it("rejects malformed PCM and unsafe parameter values", () => {
    expect(() => framePcm(Buffer.from([0]))).toThrow(/complete 16-bit samples/);
    expect(() => rmsLevel(Buffer.alloc(0))).toThrow(/complete 16-bit samples/);
    expect(() => parseArgs(["--timeout-ms", "-1"], {})).toThrow(/integer between/);
    expect(() => parseArgs(["--unexpected", "value"], {})).toThrow(/Unknown option/);
  });
});
