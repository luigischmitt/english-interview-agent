"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { reportAudioDiagnostic } from "@/lib/interview/audio-diagnostics";
import { detectPlatform } from "@/lib/interview/client-environment.mjs";
import { getAccessToken } from "@/lib/auth/backend-auth";
import { buildStreamStartMessage, notifySessionExpired } from "@/lib/auth/access-token.mjs";
import type { VoiceTranscription } from "@/lib/interview/transcription";
import { createSilentMicDetector, type SilentMicState } from "@/lib/interview/silent-mic-detector.mjs";
import { createBrowserMicDeps, createMicEngine, defaultSpeechThreshold, type MicEngine } from "@/lib/interview/mic-engine.mjs";
import { createAnswerStream, StreamConnectionError, StreamSetupError, type AnswerStream, type AnswerStreamFailure, type AnswerStreamSocket } from "@/lib/interview/answer-stream.mjs";
import { toStreamQuestion } from "@/lib/interview/stream-question.mjs";
import { finalVoiceTranscription, transcriptionFailureMessage } from "@/lib/interview/transcription-state.mjs";
import { nextAutoStartSignal } from "@/lib/interview/session-policy.mjs";
import type { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";

type RecorderStatus = "idle" | "requesting" | "recording" | "finalizing" | "error";
export type VoiceCaptureState = "idle" | "requesting" | "listening" | "detected" | "finalizing" | "ready" | "unavailable";
type StreamMessage = {
  type?: string;
  status?: string;
  protocol?: number;
  provider?: VoiceTranscription["provider"];
  transcript?: string;
  code?: string;
  message?: string;
  features?: { pronunciationAssessment?: boolean };
  scores?: { accuracy: number | null; fluency: number | null; prosody: number | null };
  durationMs?: number;
  segmented?: boolean;
  reason?: string;
  committed?: string;
  partial?: string;
  revision?: number;
  turnId?: string;
  blockCount?: number;
  assessedBlockCount?: number;
  failedBlockCount?: number;
  diagnostics?: { transcriptionDurationMs?: number; azureQueueWaitMs?: number; azureServiceDurationMs?: number; totalDurationMs?: number };
  timing?: { speechEndToFinalizationMs?: number };
};

export type FollowUpCandidateUpdate = { type: "follow-up-candidate"; turnId: string; revision: number; question: string; anchor: string };
export type FollowUpCandidateStatus = { type: "follow-up-candidate-status"; turnId: string; revision: number; status: "OPEN" | "COVERED" | "INVALID" | "NONE" };

type HandoffTimingEvent = "finalizing" | "transcription-queued" | "transcription-started" | "transcription-completed" | "listening";

export type VoiceAssessmentState =
  | { status: "pending" }
  | { status: "unavailable"; segmented?: boolean; reason?: string; blockCount?: number; assessedBlockCount?: number; failedBlockCount?: number; diagnostics?: StreamMessage["diagnostics"] }
  | { status: "available"; segmented: true; durationMs: number; scores: { accuracy: number | null; fluency: number | null; prosody: number | null }; blockCount?: number; assessedBlockCount?: number; failedBlockCount?: number; diagnostics?: StreamMessage["diagnostics"] };

type AssessmentContext = { questionLabel: string; sequenceNumber: number; /** Answer window within the question; changes after a clarification request. */ round?: number };

export type VoiceTranscriptionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "available"; value: VoiceTranscription }
  | { status: "failed"; message: string };

/** What the room's control bar needs to present and drive the capture; the capture itself renders no UI. */
export type MicControls = {
  status: RecorderStatus;
  isRecording: boolean;
  /** Requesting the microphone, finalizing, or waiting for the transcription. */
  isPending: boolean;
  canStart: boolean;
  /** A completed answer is waiting to be sent or was just sent. */
  hasAnswer: boolean;
  duration: number;
  formattedDuration: string;
  /** Silent / no-voice microphone warning while recording. */
  micNotice: Exclude<SilentMicState, "ok"> | null;
  /** Capture or transcription failure to present (never both). */
  errorMessage: string | null;
  start: () => void;
  /** Ends the answer and sends it for transcription (what a long silence does automatically). */
  stop: () => void;
  discard: () => void;
  retry: () => void;
  /** Reopens the microphone on another input (null = default) and restarts this answer's capture. */
  switchDevice: (deviceId: string | null) => void;
};

type MicrophoneCaptureProps = {
  disabled?: boolean;
  /** Renders the controls/notices; receives the live capture state. */
  render: (controls: MicControls) => ReactNode;
  /** Raw RMS level (0..1) of every captured frame; only fires while an answer window is open. */
  onLevel?: (level: number) => void;
  onTranscriptionChange: (state: VoiceTranscriptionState) => void;
  onAssessmentChange?: (attemptId: string, state: VoiceAssessmentState, context: AssessmentContext) => void;
  onCaptureStateChange?: (state: VoiceCaptureState) => void;
  /** The backend expects the answer to end soon with this text (never submitted). */
  onProvisionalAnswer?: (transcript: string, revision: number) => void;
  /** The speaker resumed after a pause, so any provisional answer is stale. */
  onSpeechResumed?: () => void;
  followUpCandidate?: FollowUpCandidateUpdate | null;
  onFollowUpCandidateStatus?: (status: FollowUpCandidateStatus) => void;
  onHandoffTimingEvent?: (event: HandoffTimingEvent, details?: { speechEndToFinalizationMs?: number; preconnected?: boolean }) => void;
  autoStartSignal?: string | null;
  /** Interview-long microphone owned by the room. Without it (or if it fails) each answer opens its own microphone. */
  micEngine?: MicEngine | null;
  /** The chosen input could not be opened and the default one is being used instead. */
  onDeviceFallback?: () => void;
  /** Question id: the interviewer is about to finish, so open the transcription socket now (no audio is sent until the answer window opens). */
  preconnectSignal?: string | null;
  assessmentSockets: AssessmentSocketRegistry;
  assessmentContext: AssessmentContext;
};

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const pcmSampleRate = 16_000;
const maximumDurationSeconds = 180;

function getStreamUrl(): string {
  const url = new URL("/api/v1/transcriptions/stream", backendBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Shown when the microphone was denied; the room swaps it for the in-app browser notice when that is the cause. */
export const micDeniedMessage = () => `A permissão para o microfone foi negada. ${detectPlatform() === "ios" ? "No Safari, toque em “aA” na barra de endereço, abra Ajustes do site e permita o Microfone." : "Permita o microfone nas configurações do site (ícone ao lado do endereço) e tente novamente."}`;

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return micDeniedMessage();
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") return "Nenhum microfone foi encontrado. Conecte um dispositivo e tente novamente.";
    if (error.name === "NotReadableError" || error.name === "TrackStartError") return "O microfone já está em uso. Libere o dispositivo e tente novamente.";
  }
  return "A captura de áudio não está disponível agora. Tente novamente ou pule a pergunta.";
}

function toPcm16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    output[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return output;
}

type Attempt = {
  generation: number;
  attemptId: string;
  context: AssessmentContext;
  stream: AnswerStream;
  assessmentEnabled: boolean;
  awaitingAssessment: boolean;
};

/** The server reported (in `ready`) whether pronunciation assessment follows this answer. */
function markAssessmentEnabled(attempt: Attempt, enabled: boolean) {
  attempt.assessmentEnabled = enabled;
}

function streamFailureMessage(reason: AnswerStreamFailure): string {
  if (reason === "slow") return "A conexão de áudio está lenta. Trechos parciais não podem ser enviados; tente novamente ou pule esta pergunta.";
  if (reason === "buffer") return "A conexão com o transcritor demorou para responder. Tente novamente ou pule esta pergunta.";
  return "A conexão de áudio foi interrompida. Tente novamente ou pule esta pergunta.";
}

export function MicrophoneCapture({ disabled = false, render, onLevel, onTranscriptionChange, onAssessmentChange, onCaptureStateChange, onProvisionalAnswer, onSpeechResumed, followUpCandidate = null, onFollowUpCandidateStatus, onHandoffTimingEvent, autoStartSignal = null, micEngine = null, onDeviceFallback, preconnectSignal = null, assessmentSockets, assessmentContext }: MicrophoneCaptureProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const [micNotice, setMicNotice] = useState<Exclude<SilentMicState, "ok"> | null>(null);
  const micDetectorRef = useRef<ReturnType<typeof createSilentMicDetector> | null>(null);
  const micCheckTimerRef = useRef<number | null>(null);
  /** The answer in progress (its socket is owned by its AnswerStream). Null once handed to the assessment registry. */
  const attemptRef = useRef<Attempt | null>(null);
  /** A socket opened while the interviewer was finishing; adopted by the next startRecording. Never carries audio. */
  const preRef = useRef<Attempt | null>(null);
  const activeEngineRef = useRef<MicEngine | null>(null);
  const ownedEngineRef = useRef<MicEngine | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const generationRef = useRef(0);
  const finalizationRequestedRef = useRef(false);
  const onLevelRef = useRef(onLevel);
  const onTranscriptionChangeRef = useRef(onTranscriptionChange);
  const onAssessmentChangeRef = useRef(onAssessmentChange);
  const onCaptureStateChangeRef = useRef(onCaptureStateChange);
  const onProvisionalAnswerRef = useRef(onProvisionalAnswer);
  const onSpeechResumedRef = useRef(onSpeechResumed);
  const onFollowUpCandidateStatusRef = useRef(onFollowUpCandidateStatus);
  const onHandoffTimingEventRef = useRef(onHandoffTimingEvent);
  const assessmentContextRef = useRef(assessmentContext);
  const micEngineRef = useRef(micEngine);
  const onDeviceFallbackRef = useRef(onDeviceFallback);
  const lastAutoStartSignalRef = useRef<string | null>(null);
  const lastPreconnectSignalRef = useRef<string | null>(null);
  const handlersRef = useRef<{
    message: (attempt: Attempt, message: StreamMessage, socket: AnswerStreamSocket) => void;
    close: (attempt: Attempt, event: { code?: number }, socket: AnswerStreamSocket) => void;
    failure: (attempt: Attempt, reason: AnswerStreamFailure) => void;
  } | null>(null);

  useEffect(() => {
    onLevelRef.current = onLevel;
    onTranscriptionChangeRef.current = onTranscriptionChange;
    onAssessmentChangeRef.current = onAssessmentChange;
    onCaptureStateChangeRef.current = onCaptureStateChange;
    onProvisionalAnswerRef.current = onProvisionalAnswer;
    onSpeechResumedRef.current = onSpeechResumed;
    onFollowUpCandidateStatusRef.current = onFollowUpCandidateStatus;
    onHandoffTimingEventRef.current = onHandoffTimingEvent;
    assessmentContextRef.current = assessmentContext;
    micEngineRef.current = micEngine;
    onDeviceFallbackRef.current = onDeviceFallback;
  }, [onDeviceFallback, assessmentContext, onLevel, micEngine, onHandoffTimingEvent, onProvisionalAnswer, onSpeechResumed, onFollowUpCandidateStatus, onTranscriptionChange, onAssessmentChange, onCaptureStateChange]);

  useEffect(() => {
    if (followUpCandidate) attemptRef.current?.stream.sendControl(followUpCandidate);
  }, [followUpCandidate]);


  /** Ends the answer window: audio stops flowing, timers stop, and a per-answer (private) microphone is released. The room's microphone stays open. */
  const releaseCapture = useCallback(() => {
    if (durationTimerRef.current !== null) window.clearInterval(durationTimerRef.current);
    durationTimerRef.current = null;
    if (micCheckTimerRef.current !== null) window.clearInterval(micCheckTimerRef.current);
    micCheckTimerRef.current = null;
    micDetectorRef.current = null;
    setMicNotice(null);
    activeEngineRef.current?.stopCapture();
    activeEngineRef.current = null;
    const owned = ownedEngineRef.current;
    ownedEngineRef.current = null;
    owned?.release();
  }, []);

  const cancelPreconnect = useCallback(() => {
    const pre = preRef.current;
    preRef.current = null;
    pre?.stream.cancel();
  }, []);

  const fail = useCallback((message: string) => {
    generationRef.current += 1;
    releaseCapture();
    const attempt = attemptRef.current;
    attemptRef.current = null;
    attempt?.stream.cancel();
    setStatus("error");
    onCaptureStateChangeRef.current?.("unavailable");
    setError(message);
    const failed: VoiceTranscriptionState = { status: "failed", message };
    setTranscription(failed);
    onTranscriptionChangeRef.current(failed);
  }, [releaseCapture]);

  const stopRecording = useCallback(() => {
    const attempt = attemptRef.current;
    const socket = attempt?.stream.socket;
    if (!attempt || !socket || socket.readyState !== WebSocket.OPEN || finalizationRequestedRef.current) return;
    finalizationRequestedRef.current = true;
    setStatus("finalizing");
    onCaptureStateChangeRef.current?.("finalizing");
    const engine = activeEngineRef.current;
    const finalize = () => {
      if (attemptRef.current !== attempt || socket.readyState !== WebSocket.OPEN) { releaseCapture(); return; }
      socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
      const pending: VoiceTranscriptionState = { status: "pending" };
      setTranscription(pending);
      onTranscriptionChangeRef.current(pending);
      releaseCapture();
    };
    // The engine delivers the worklet's partial frame to the stream before resolving.
    if (engine) void engine.flush().then(finalize); else finalize();
  }, [releaseCapture]);

  const cancelRecording = useCallback(() => {
    generationRef.current += 1;
    finalizationRequestedRef.current = true;
    releaseCapture();
    const attempt = attemptRef.current;
    attemptRef.current = null;
    attempt?.stream.cancel();
    setStatus("idle");
    onCaptureStateChangeRef.current?.("idle");
    setDuration(0);
    setError(null);
    const idle: VoiceTranscriptionState = { status: "idle" };
    setTranscription(idle);
    onTranscriptionChangeRef.current(idle);
  }, [releaseCapture]);

  /** Every server message after `ready` (the stream consumes `ready` and setup errors itself). */
  const handleStreamMessage = (attempt: Attempt, message: StreamMessage, socket: AnswerStreamSocket) => {
    const { generation, attemptId, context: attemptAssessmentContext } = attempt;
    if (message.type === "assessment") {
      attempt.awaitingAssessment = false;
      assessmentSockets.finish(attemptId, socket as unknown as WebSocket);
      const received: VoiceAssessmentState = message.status === "available" && message.scores
        ? { status: "available", segmented: true, durationMs: message.durationMs ?? 0, scores: message.scores, blockCount: message.blockCount, assessedBlockCount: message.assessedBlockCount, failedBlockCount: message.failedBlockCount, diagnostics: message.diagnostics }
        : { status: "unavailable", segmented: message.segmented === true, reason: message.reason, blockCount: message.blockCount, assessedBlockCount: message.assessedBlockCount, failedBlockCount: message.failedBlockCount, diagnostics: message.diagnostics };
      onAssessmentChangeRef.current?.(attemptId, received, attemptAssessmentContext);
      attempt.stream.release();
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      return;
    }
    if (generationRef.current !== generation) return;
    if (message.type === "error" && message.code === "UNAUTHENTICATED") notifySessionExpired();
    if (message.type === "speech-started") {
      micDetectorRef.current?.markSpeechStarted();
      setMicNotice(null);
      onCaptureStateChangeRef.current?.("detected");
      return;
    }
    if (message.type === "answer-provisional") {
      const { transcript, revision } = message;
      if (typeof transcript === "string" && typeof revision === "number" && Number.isInteger(revision) && revision >= 1 && revision <= 8 && !finalizationRequestedRef.current) {
        onProvisionalAnswerRef.current?.(transcript, revision);
      }
      return;
    }
    if (message.type === "follow-up-candidate-status") {
      const status = message.status;
      if (typeof message.turnId === "string" && typeof message.revision === "number" && Number.isInteger(message.revision) && message.revision >= 1 && message.revision <= 8
        && (status === "OPEN" || status === "COVERED" || status === "INVALID" || status === "NONE")) {
        onFollowUpCandidateStatusRef.current?.({ type: "follow-up-candidate-status", turnId: message.turnId, revision: message.revision, status });
      }
      return;
    }
    if (message.type === "speech-resumed") {
      onSpeechResumedRef.current?.();
      return;
    }
    if (message.type === "silence-detected") return;
    if (message.type === "transcription-queued" || message.type === "finalizing") {
      if (message.type === "finalizing") {
        onHandoffTimingEventRef.current?.("finalizing", message.timing);
        releaseCapture();
      } else onHandoffTimingEventRef.current?.("transcription-queued");
      setStatus("finalizing");
      const pending: VoiceTranscriptionState = { status: "pending" };
      setTranscription(pending);
      onTranscriptionChangeRef.current(pending);
      return;
    }
    if (message.type === "transcription-started") {
      onHandoffTimingEventRef.current?.("transcription-started");
      return;
    }
    if (message.type === "complete") {
      onHandoffTimingEventRef.current?.("transcription-completed");
      releaseCapture();
      const result = finalVoiceTranscription(message);
      if (result.status === "available") {
        setTranscription(result);
        onTranscriptionChangeRef.current(result);
        onCaptureStateChangeRef.current?.("ready");
        setStatus("idle");
        setError(null);
      } else {
        setTranscription(result);
        onTranscriptionChangeRef.current(result);
        onCaptureStateChangeRef.current?.("unavailable");
        setStatus("error");
        setError(result.message);
      }
      attempt.awaitingAssessment = attempt.assessmentEnabled;
      if (attempt.awaitingAssessment) {
        assessmentSockets.register(attemptId, socket as unknown as WebSocket);
        attemptRef.current = null;
        onAssessmentChangeRef.current?.(attemptId, { status: "pending" }, attemptAssessmentContext);
      } else {
        onAssessmentChangeRef.current?.(attemptId, { status: "unavailable", reason: "not_enabled" }, attemptAssessmentContext);
        attempt.stream.release();
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
        if (attemptRef.current === attempt) attemptRef.current = null;
      }
      return;
    }
    if (message.type === "error" || message.type === "transcription-error") {
      fail(transcriptionFailureMessage(message.code));
    }
  };

  const handleStreamClose = (attempt: Attempt, event: { code?: number }, socket: AnswerStreamSocket) => {
    if (attempt.awaitingAssessment) {
      attempt.awaitingAssessment = false;
      assessmentSockets.finish(attempt.attemptId, socket as unknown as WebSocket);
      onAssessmentChangeRef.current?.(attempt.attemptId, { status: "unavailable", segmented: true, reason: "socket_closed" }, attempt.context);
      return;
    }
    if (attemptRef.current === attempt && event.code !== 1000) {
      fail("A conexão com o transcritor foi interrompida. Tente novamente ou pule a pergunta.");
    }
  };

  const handleStreamFailure = (attempt: Attempt, reason: AnswerStreamFailure) => {
    if (attemptRef.current !== attempt || generationRef.current !== attempt.generation) return;
    reportAudioDiagnostic({ kind: "transcription_failure", failureReason: reason });
    fail(streamFailureMessage(reason));
  };

  useEffect(() => {
    handlersRef.current = { message: handleStreamMessage, close: handleStreamClose, failure: handleStreamFailure };
  });

  /** Builds the transport of one answer. Nothing is opened until `connect()` (pre-connect) or `begin()` (answer window). */
  const createAttempt = useCallback((generation: number, speechThreshold: number): Attempt => {
    const attempt = { generation, attemptId: crypto.randomUUID(), context: assessmentContextRef.current, assessmentEnabled: false, awaitingAssessment: false } as Attempt;
    attempt.stream = createAnswerStream({
      openSocket: () => new WebSocket(getStreamUrl()) as unknown as AnswerStreamSocket,
      buildStartMessage: async () => {
        let accessToken: string;
        try {
          accessToken = await getAccessToken();
        } catch {
          throw new StreamSetupError("UNAUTHENTICATED");
        }
        return buildStreamStartMessage({ accessToken, speechThreshold, sampleRate: pcmSampleRate, question: toStreamQuestion(attempt.context.questionLabel) });
      },
      encodeFrame: (samples) => toPcm16(samples).buffer as ArrayBuffer,
      onMessage: (message, socket) => handlersRef.current?.message(attempt, message as StreamMessage, socket),
      onClose: (event, socket) => handlersRef.current?.close(attempt, event, socket),
      onFailure: (reason) => handlersRef.current?.failure(attempt, reason),
    });
    return attempt;
  }, []);

  /** Zero-wait handoff: with the interview microphone ready, open and authenticate the socket before the interviewer stops talking. */
  const preconnect = useCallback(() => {
    const engine = micEngineRef.current;
    if (preRef.current || attemptRef.current || !engine || engine.state !== "ready" || typeof WebSocket === "undefined") return;
    if (status !== "idle") return;
    const pre = createAttempt(++generationRef.current, engine.noiseFloor);
    preRef.current = pre;
    pre.stream.connect().catch(() => { /* A failed pre-connect is retried by begin(). */ });
  }, [createAttempt, status]);

  const startRecording = useCallback(async (force = false, options: { reacquire?: boolean } = {}) => {
    if ((!force && (status === "requesting" || status === "recording" || status === "finalizing")) || disabled) return;
    setMicNotice(null);
    setError(null);
    setStatus("requesting");
    onCaptureStateChangeRef.current?.("requesting");
    finalizationRequestedRef.current = false;
    setDuration(0);
    setTranscription({ status: "idle" });
    onTranscriptionChangeRef.current({ status: "idle" });

    let attempt = preRef.current;
    preRef.current = null;
    if (attempt && (attempt.generation !== generationRef.current || attempt.stream.state === "closed")) {
      attempt.stream.cancel();
      attempt = null;
    }
    const generation = attempt ? attempt.generation : ++generationRef.current;

    try {
      if (typeof WebSocket === "undefined") throw new Error("unsupported");
      // Reuse the room's microphone when healthy (reacquire once if its track ended/muted, or when asked to);
      // otherwise fall back to one microphone for this answer only.
      let engine: MicEngine | null = null;
      let owned = false;
      const shared = micEngineRef.current;
      if (shared) {
        try { if (await shared.ensureHealthy({ force: options.reacquire === true })) engine = shared; } catch { /* Falls back below. */ }
      }
      if (generationRef.current !== generation) { attempt?.stream.cancel(); return; }
      if (!engine) {
        const own = createMicEngine(createBrowserMicDeps({
          onDiagnostic: (event) => { if (event.kind === "mic_error") reportAudioDiagnostic(event); },
          onDeviceFallback: () => { micEngineRef.current?.setDeviceId(null); onDeviceFallbackRef.current?.(); },
        }), { deviceId: micEngineRef.current?.deviceId ?? null });
        ownedEngineRef.current = own;
        await own.acquire();
        engine = own;
        owned = true;
      }
      if (generationRef.current !== generation) { attempt?.stream.cancel(); return; }
      let speechThreshold = engine.noiseFloor;
      if (owned) {
        // Per-answer fallback keeps the original behavior: calibrate on the first frames and send them too.
        speechThreshold = (await engine.calibrate({ keepFrames: true })) ?? defaultSpeechThreshold;
        if (generationRef.current !== generation) return;
      }
      attempt ??= createAttempt(generation, speechThreshold);
      attemptRef.current = attempt;
      activeEngineRef.current = engine;
      startedAtRef.current = Date.now();
      const detector = createSilentMicDetector({ startedAtMs: Date.now() });
      micDetectorRef.current = detector;
      const stream = attempt.stream;
      // Opens the audio gate: a ready (pre-connected) socket streams immediately, otherwise frames wait in a bounded buffer.
      const begun = stream.begin();
      begun.catch(() => {});
      engine.startCapture((frame) => {
        if (generationRef.current !== generation) return;
        detector.pushLevel(frame.level);
        onLevelRef.current?.(frame.level);
        stream.pushFrame(frame);
      }, { replayHeld: owned });

      const { preconnected, readyMessage } = await begun;
      if (generationRef.current !== generation) return;
      markAssessmentEnabled(attempt, readyMessage?.features?.pronunciationAssessment === true);
      micCheckTimerRef.current = window.setInterval(() => {
        if (generationRef.current !== generation || finalizationRequestedRef.current) return;
        const state = detector.evaluate(Date.now());
        setMicNotice(state === "ok" ? null : state);
      }, 500);
      setStatus("recording");
      onCaptureStateChangeRef.current?.("listening");
      onHandoffTimingEventRef.current?.("listening", { preconnected });
      durationTimerRef.current = window.setInterval(() => {
        if (generationRef.current !== generation) return;
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1_000);
        setDuration(seconds);
        if (seconds >= maximumDurationSeconds) stopRecording();
      }, 200);
    } catch (captureError) {
      if (generationRef.current !== generation) return;
      if (captureError instanceof StreamSetupError && captureError.code === "UNAUTHENTICATED") notifySessionExpired();
      const failureReason = captureError instanceof StreamSetupError ? "setup"
        : captureError instanceof Error && captureError.message === "unsupported" ? "unsupported"
          : captureError instanceof StreamConnectionError && captureError.kind === "timeout" ? "timeout"
            : captureError instanceof StreamConnectionError ? "connection" : "microphone";
      reportAudioDiagnostic({ kind: "transcription_failure", failureReason });
      fail(captureError instanceof StreamSetupError
        ? transcriptionFailureMessage(captureError.code)
        : captureError instanceof Error && captureError.message === "unsupported"
          ? "Este navegador não pode transmitir áudio. Tente novamente em um navegador compatível ou pule esta pergunta."
          : captureError instanceof StreamConnectionError && captureError.kind === "timeout"
            ? "A conexão com o transcritor demorou para responder. Tente novamente ou pule esta pergunta."
            : captureError instanceof StreamConnectionError
              ? "A conexão com o transcritor falhou. Tente novamente ou pule esta pergunta."
              : microphoneError(captureError));
    }
  }, [createAttempt, disabled, fail, status, stopRecording]);

  const retryCapture = useCallback(() => {
    // Same path as "Descartar gravação" (sends cancel, drops partial audio), then a fresh capture for the same
    // question. A silent microphone is reacquired (Bluetooth profile switches); "no voice" reuses the healthy one.
    const reacquire = micNotice === "silent";
    cancelRecording();
    void startRecording(true, { reacquire });
  }, [cancelRecording, micNotice, startRecording]);

  const switchDevice = useCallback((deviceId: string | null) => {
    micEngineRef.current?.setDeviceId(deviceId);
    cancelRecording();
    void startRecording(true, { reacquire: true });
  }, [cancelRecording, startRecording]);

  useEffect(() => {
    const nextSignal = nextAutoStartSignal(autoStartSignal, disabled, lastAutoStartSignalRef.current);
    if (nextSignal === null) return;
    lastAutoStartSignalRef.current = nextSignal;
    void startRecording();
  }, [autoStartSignal, disabled, startRecording]);

  useEffect(() => {
    if (preconnectSignal === null) { cancelPreconnect(); return; }
    if (preconnectSignal === lastPreconnectSignalRef.current) return;
    lastPreconnectSignalRef.current = preconnectSignal;
    preconnect();
  }, [cancelPreconnect, preconnect, preconnectSignal]);

  useEffect(() => () => {
    generationRef.current += 1;
    finalizationRequestedRef.current = true;
    releaseCapture();
    cancelPreconnect();
    const attempt = attemptRef.current;
    attemptRef.current = null;
    attempt?.stream.cancel();
  }, [cancelPreconnect, releaseCapture]);

  const isRecording = status === "recording";
  const isPending = status === "requesting" || status === "finalizing" || transcription.status === "pending";
  const formattedDuration = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;
  const canStart = !isRecording && status !== "requesting" && status !== "finalizing" && transcription.status !== "pending";

  return <MicControlsSlot render={render} controls={{
    status,
    isRecording,
    isPending,
    canStart,
    hasAnswer: transcription.status === "available",
    duration,
    formattedDuration,
    micNotice: isRecording ? micNotice : null,
    errorMessage: transcription.status === "failed" ? transcription.message : error,
    start: () => void startRecording(),
    stop: stopRecording,
    discard: cancelRecording,
    retry: retryCapture,
    switchDevice,
  }} />;
}

/** The capture renders no UI of its own: the room presents the controls (separate component so the render prop is not called during the capture's own render). */
function MicControlsSlot({ render, controls }: { render: (controls: MicControls) => ReactNode; controls: MicControls }) {
  return <>{render(controls)}</>;
}
