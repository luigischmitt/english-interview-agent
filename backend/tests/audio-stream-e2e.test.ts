import { createServer } from "node:http";

import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { buildSpeechUrl, buildStreamUrl, exerciseStream, fetchSpeechAudio, framePcm, isSuccessfulAudioE2ERun, mergeTranscriptWindow, parseArgs, rmsLevel, type AudioE2EMetrics } from "../src/transcription/audio-stream-e2e.js";

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

  it("uses a default spoken answer long enough to exercise overlapping windows", () => {
    const defaultAnswer = parseArgs([], {}).text;
    expect(defaultAnswer.split(/\s+/u).length).toBeGreaterThanOrEqual(70);
  });

  it("keeps partial transcription failures unsuccessful while retaining structured diagnostics", () => {
    const metrics: AudioE2EMetrics = {
      speechGenerationMs: 100,
      connectToReadyMs: 20,
      firstSpeechMs: 120,
      firstPartialMs: 6_100,
      silenceDetectedMs: null,
      completeMs: 15_000,
      partialCount: 1,
      partialWindows: [1],
      streamErrors: [{ type: "partial-error" }],
      missingEvents: ["silence-detected"],
      transcriptCharacters: 42,
      completionStatus: "partial",
    };
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.streamErrors = [];
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
    metrics.completionStatus = "complete";
    metrics.missingEvents = [];
    expect(isSuccessfulAudioE2ERun(metrics)).toBe(true);
  });

  it("waits for complete after partial-error and returns metrics without transcript text", async () => {
    const server = createServer();
    const websocketServer = new WebSocketServer({ server });
    let sentFailureEvents = false;
    websocketServer.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === "start") {
          socket.send(JSON.stringify({ type: "ready", protocol: 2 }));
          return;
        }
        if (message.type === "level" && !sentFailureEvents) {
          sentFailureEvents = true;
          socket.send(JSON.stringify({ type: "speech-started" }));
          socket.send(JSON.stringify({ type: "partial", windowIndex: 1, transcript: "synthetic transcript" }));
          socket.send(JSON.stringify({ type: "partial-error", code: "UPSTREAM_UNAVAILABLE", message: "generic backend error" }));
          socket.send(JSON.stringify({ type: "complete", status: "partial", windows: 1 }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test WebSocket server did not bind to a TCP port.");
    try {
      const options = parseArgs(["--backend-url", `http://127.0.0.1:${address.port}`], {});
      const metrics = await exerciseStream(options, Buffer.alloc(3_200), 42, 0);
      expect(metrics.completionStatus).toBe("partial");
      expect(metrics.streamErrors).toEqual([{ type: "partial-error", code: "UPSTREAM_UNAVAILABLE" }]);
      expect(metrics.partialCount).toBe(1);
      expect(metrics.partialWindows).toEqual([1]);
      expect(metrics.transcriptCharacters).toBe("synthetic transcript".length);
      expect(metrics.completeMs).not.toBeNull();
      expect(metrics.missingEvents).toContain("silence-detected");
      expect(isSuccessfulAudioE2ERun(metrics)).toBe(false);
      expect(metrics).not.toHaveProperty("transcript");
      expect(JSON.stringify(metrics)).not.toContain("synthetic transcript");
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

  it("merges repeated words at the overlap between adjacent Whisper windows", () => {
    expect(mergeTranscriptWindow("I improved the reporting service", "the reporting service and reduced latency"))
      .toBe("I improved the reporting service and reduced latency");
    expect(mergeTranscriptWindow("first answer", "new words here"))
      .toBe("first answer new words here");
  });

  it("merges a newly recognized article without duplicating repeated words", () => {
    expect(mergeTranscriptWindow("We need to improve performance", "We need to improve the performance and cache results"))
      .toBe("We need to improve the performance and cache results");
  });

  it("keeps all new content when the apparent overlap is weak", () => {
    expect(mergeTranscriptWindow("I reviewed the database", "I changed the service and added indexes"))
      .toBe("I reviewed the database I changed the service and added indexes");
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
