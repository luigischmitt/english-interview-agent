"use client";

import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceTranscription } from "@/lib/interview/transcription";
import { mergeTranscriptWindow } from "@/lib/interview/transcript-overlap.mjs";
import { getSpeechThreshold } from "@/lib/interview/vad-threshold.mjs";
import { nextAutoStartSignal, stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import type { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";

type RecorderStatus = "idle" | "requesting" | "recording" | "finalizing" | "error";
export type VoiceCaptureState = "idle" | "requesting" | "listening" | "detected" | "finalizing" | "ready" | "unavailable";
type StreamMessage = {
  type?: string;
  status?: string;
  protocol?: number;
  provider?: VoiceTranscription["provider"];
  transcript?: string;
  message?: string;
  features?: { pronunciationAssessment?: boolean };
  scores?: { accuracy: number | null; fluency: number | null; prosody: number | null };
  durationMs?: number;
  segmented?: boolean;
};
export type VoiceAssessmentState =
  | { status: "pending" }
  | { status: "unavailable"; segmented?: boolean }
  | { status: "available"; segmented: true; durationMs: number; scores: { accuracy: number | null; fluency: number | null; prosody: number | null } };

export type VoiceTranscriptionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "partial"; provider: VoiceTranscription["provider"]; transcript: string }
  | { status: "available"; value: VoiceTranscription }
  | { status: "failed"; message: string; transcript?: string };

type MicrophoneCaptureProps = {
  disabled?: boolean;
  showTranscript?: boolean;
  onTranscriptionChange: (state: VoiceTranscriptionState) => void;
  onAssessmentChange?: (attemptId: string, state: VoiceAssessmentState) => void;
  onCaptureStateChange?: (state: VoiceCaptureState) => void;
  autoStartSignal?: string | null;
  assessmentSockets: AssessmentSocketRegistry;
};

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const pcmSampleRate = 16_000;
const maximumDurationSeconds = 180;
const maximumSocketBufferBytes = 512 * 1024;

function getStreamUrl(): string {
  const url = new URL("/api/v1/transcriptions/stream", backendBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "A permissão para o microfone foi negada. Permita o acesso e tente novamente.";
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

function rootMeanSquare(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export function MicrophoneCapture({ disabled = false, showTranscript = true, onTranscriptionChange, onAssessmentChange, onCaptureStateChange, autoStartSignal = null, assessmentSockets }: MicrophoneCaptureProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const generationRef = useRef(0);
  const finalizationRequestedRef = useRef(false);
  const transcriptRef = useRef("");
  const onTranscriptionChangeRef = useRef(onTranscriptionChange);
  const onAssessmentChangeRef = useRef(onAssessmentChange);
  const onCaptureStateChangeRef = useRef(onCaptureStateChange);
  const lastAutoStartSignalRef = useRef<string | null>(null);

  useEffect(() => {
    onTranscriptionChangeRef.current = onTranscriptionChange;
    onAssessmentChangeRef.current = onAssessmentChange;
    onCaptureStateChangeRef.current = onCaptureStateChange;
  }, [onTranscriptionChange, onAssessmentChange, onCaptureStateChange]);

  const releaseCapture = useCallback(() => {
    if (durationTimerRef.current !== null) window.clearInterval(durationTimerRef.current);
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
    durationTimerRef.current = null;
    connectionTimeoutRef.current = null;
    if (workletRef.current) workletRef.current.port.onmessage = null;
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    workletRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    stopMediaStreamTracks(streamRef.current);
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  const fail = useCallback((message: string) => {
    generationRef.current += 1;
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    setStatus("error");
    onCaptureStateChangeRef.current?.("unavailable");
    setError(message);
    const failed: VoiceTranscriptionState = { status: "failed", message, ...(transcriptRef.current ? { transcript: transcriptRef.current } : {}) };
    setTranscription(failed);
    onTranscriptionChangeRef.current(failed);
  }, [releaseCapture]);

  const stopRecording = useCallback((reason: "manual" | "silence") => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || finalizationRequestedRef.current) return;
    finalizationRequestedRef.current = true;
    setStatus("finalizing");
    onCaptureStateChangeRef.current?.("finalizing");
    const worklet = workletRef.current;
    if (!worklet) {
      socket.send(JSON.stringify({ type: "finalize", reason }));
      releaseCapture();
      return;
    }
    const previousHandler = worklet.port.onmessage;
    worklet.port.onmessage = (event: MessageEvent<{ type?: string; samples?: ArrayBuffer }>) => {
      previousHandler?.call(worklet.port, event);
      if (event.data?.type === "flushed") {
        worklet.port.onmessage = previousHandler;
        socket.send(JSON.stringify({ type: "finalize", reason }));
        const pending: VoiceTranscriptionState = { status: "pending" };
        setTranscription(pending);
        onTranscriptionChangeRef.current(pending);
        releaseCapture();
      }
    };
    worklet.port.postMessage({ type: "flush" });
  }, [releaseCapture]);

  const cancelRecording = useCallback(() => {
    generationRef.current += 1;
    finalizationRequestedRef.current = true;
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    setStatus("idle");
    onCaptureStateChangeRef.current?.("idle");
    setDuration(0);
    setError(null);
    transcriptRef.current = "";
    const idle: VoiceTranscriptionState = { status: "idle" };
    setTranscription(idle);
    onTranscriptionChangeRef.current(idle);
  }, [releaseCapture]);

  const startRecording = useCallback(async () => {
    if (status === "requesting" || status === "recording" || status === "finalizing" || disabled) return;
    setError(null);
    setStatus("requesting");
    onCaptureStateChangeRef.current?.("requesting");
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    finalizationRequestedRef.current = false;
    transcriptRef.current = "";
    setDuration(0);
    setTranscription({ status: "idle" });
    onTranscriptionChangeRef.current({ status: "idle" });
    const attemptId = crypto.randomUUID();

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined" || typeof WebSocket === "undefined") throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (generationRef.current !== generation) { stopMediaStreamTracks(stream); return; }
      streamRef.current = stream;
      const context = new AudioContext();
      audioContextRef.current = context;
      await context.audioWorklet.addModule("/pcm-capture-processor.js");
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "pcm-capture-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(worklet);
      worklet.connect(mute);
      mute.connect(context.destination);
      sourceRef.current = source;
      workletRef.current = worklet;
      gainRef.current = mute;
      startedAtRef.current = Date.now();

      const calibrationFrames: Array<{ samples: Float32Array; level: number }> = [];
      const calibrationReady = new Promise<void>((resolve, reject) => {
        const calibrationTimeout = window.setTimeout(() => reject(new Error("calibration")), 1_500);
        worklet.port.onmessage = (event: MessageEvent<{ type?: string; samples?: ArrayBuffer }>) => {
          if (!event.data?.samples || calibrationFrames.length >= 5) return;
          const samples = new Float32Array(event.data.samples);
          calibrationFrames.push({ samples, level: rootMeanSquare(samples) });
          if (calibrationFrames.length === 5) {
            window.clearTimeout(calibrationTimeout);
            resolve();
          }
        };
      });
      await calibrationReady;
      if (generationRef.current !== generation) return;
      const speechThreshold = getSpeechThreshold(calibrationFrames.map(({ level }) => level));
      const pendingFrames = [...calibrationFrames];
      let streamReady = false;

      const socket = new WebSocket(getStreamUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      let assessmentEnabled = false;
      let awaitingAssessment = false;
      const ready = new Promise<void>((resolve, reject) => {
        let connectionReady = false;
        const connectionTimeout = window.setTimeout(() => reject(new Error("timeout")), 5_000);
        connectionTimeoutRef.current = connectionTimeout;
        socket.onopen = () => socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: pcmSampleRate, channels: 1, encoding: "s16le", speechThreshold }));
        socket.onerror = () => { window.clearTimeout(connectionTimeout); connectionTimeoutRef.current = null; reject(new Error("connection")); };
        socket.onmessage = (event) => {
          let message: StreamMessage;
          try { message = JSON.parse(String(event.data)) as StreamMessage; } catch { return; }
          if (message.type === "assessment") {
            awaitingAssessment = false;
            assessmentSockets.finish(attemptId, socket);
            const received: VoiceAssessmentState = message.status === "available" && message.scores
              ? { status: "available", segmented: true, durationMs: message.durationMs ?? 0, scores: message.scores }
              : { status: "unavailable", segmented: message.segmented === true };
            onAssessmentChangeRef.current?.(attemptId, received);
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
            if (socket.readyState < WebSocket.CLOSING) socket.close();
            return;
          }
          if (generationRef.current !== generation) return;
          if (message.type === "ready") {
            assessmentEnabled = message.features?.pronunciationAssessment === true;
            connectionReady = true;
            window.clearTimeout(connectionTimeout);
            connectionTimeoutRef.current = null;
            resolve();
            return;
          }
          if (message.type === "error" && !connectionReady) {
            window.clearTimeout(connectionTimeout);
            connectionTimeoutRef.current = null;
            reject(new Error(message.message ?? "Audio transcription is unavailable right now. Please try again or skip this question."));
            return;
          }
          if (message.type === "speech-started") {
            onCaptureStateChangeRef.current?.("detected");
            return;
          }
          if (message.type === "silence-detected") { stopRecording("silence"); return; }
          if (message.type === "partial" && message.transcript) {
            transcriptRef.current = mergeTranscriptWindow(transcriptRef.current, message.transcript);
            const partial: VoiceTranscriptionState = { status: "partial", provider: message.provider ?? "whisper-large-v3-turbo", transcript: transcriptRef.current };
            setTranscription(partial);
            onTranscriptionChangeRef.current(partial);
            return;
          }
          if (message.type === "partial-error") {
            releaseCapture();
            const failed: VoiceTranscriptionState = { status: "failed", message: message.message ?? "A transcrição foi interrompida.", ...(transcriptRef.current ? { transcript: transcriptRef.current } : {}) };
            setStatus("error");
            onCaptureStateChangeRef.current?.("unavailable");
            setError(failed.message);
            setTranscription(failed);
            onTranscriptionChangeRef.current(failed);
            if (assessmentEnabled) {
              awaitingAssessment = true;
              assessmentSockets.register(attemptId, socket);
              socketRef.current = null;
              onAssessmentChangeRef.current?.(attemptId, { status: "pending" });
            }
            return;
          }
          if (message.type === "finalizing") { setStatus("finalizing"); return; }
          if (message.type === "complete") {
            releaseCapture();
            if (transcriptRef.current.trim()) {
              const available: VoiceTranscriptionState = message.status === "complete"
                ? { status: "available", value: { provider: "whisper-large-v3-turbo", transcript: transcriptRef.current } }
                : { status: "failed", message: "A transcrição terminou com trechos indisponíveis. O texto recebido foi preservado.", transcript: transcriptRef.current };
              setTranscription(available);
              onTranscriptionChangeRef.current(available);
              onCaptureStateChangeRef.current?.(message.status === "complete" ? "ready" : "unavailable");
              setStatus(message.status === "complete" ? "idle" : "error");
              if (message.status !== "complete") setError(available.status === "failed" ? available.message : null);
            } else {
              const failed: VoiceTranscriptionState = { status: "failed", message: "Não recebemos uma transcrição final. Tente gravar novamente ou pule esta pergunta." };
              setTranscription(failed);
              onTranscriptionChangeRef.current(failed);
              onCaptureStateChangeRef.current?.("unavailable");
              setStatus("error");
            }
            awaitingAssessment = assessmentEnabled;
            if (awaitingAssessment) {
              assessmentSockets.register(attemptId, socket);
              socketRef.current = null;
              onAssessmentChangeRef.current?.(attemptId, { status: "pending" });
            } else {
              socket.onmessage = null;
              socket.onclose = null;
              socket.onerror = null;
              if (socket.readyState < WebSocket.CLOSING) socket.close();
              socketRef.current = null;
            }
            return;
          }
          if (message.type === "error") fail(message.message ?? "A transcrição não está disponível agora. Tente novamente ou pule esta pergunta.");
        };
        socket.onclose = (event) => {
          if (awaitingAssessment) {
            awaitingAssessment = false;
            assessmentSockets.finish(attemptId, socket);
            const unavailable: VoiceAssessmentState = { status: "unavailable", segmented: true };
            onAssessmentChangeRef.current?.(attemptId, unavailable);
            return;
          }
          if (socketRef.current === socket && event.code !== 1000) {
            window.clearTimeout(connectionTimeout);
            connectionTimeoutRef.current = null;
            reject(new Error("connection"));
            fail("A conexão com o transcritor foi interrompida. Tente novamente ou pule a pergunta.");
          }
        };
      });
      const sendFrame = ({ samples, level }: { samples: Float32Array; level: number }) => {
        if (socket.readyState !== WebSocket.OPEN) { fail("A conexão de áudio foi interrompida. Tente novamente ou pule esta pergunta."); return; }
        if (socket.bufferedAmount > maximumSocketBufferBytes) { fail("A conexão de áudio está lenta. Trechos parciais não podem ser enviados; tente novamente ou pule esta pergunta."); return; }
        const pcm = toPcm16(samples);
        socket.send(pcm.buffer);
        socket.send(JSON.stringify({ type: "level", value: level }));
      };
      worklet.port.onmessage = (event: MessageEvent<{ type?: string; samples?: ArrayBuffer }>) => {
        if (generationRef.current !== generation || !event.data?.samples) return;
        const samples = new Float32Array(event.data.samples);
        const frame = { samples, level: rootMeanSquare(samples) };
        if (!streamReady) pendingFrames.push(frame);
        else sendFrame(frame);
      };
      await ready;
      if (generationRef.current !== generation) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
        socket.close();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) throw new Error("connection");

      streamReady = true;
      pendingFrames.forEach(sendFrame);
      setStatus("recording");
      onCaptureStateChangeRef.current?.("listening");
      durationTimerRef.current = window.setInterval(() => {
        if (generationRef.current !== generation) return;
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1_000);
        setDuration(seconds);
        if (seconds >= maximumDurationSeconds) stopRecording("manual");
      }, 200);
    } catch (captureError) {
      if (generationRef.current !== generation) return;
      fail(captureError instanceof Error && captureError.message === "unsupported"
            ? "Este navegador não pode transmitir áudio. Tente novamente em um navegador compatível ou pule esta pergunta."
          : captureError instanceof Error && captureError.message === "timeout"
          ? "A conexão com o transcritor demorou para responder. Tente novamente ou pule esta pergunta."
          : captureError instanceof Error && captureError.message === "connection"
            ? "A conexão com o transcritor falhou. Tente novamente ou pule esta pergunta."
            : microphoneError(captureError));
    }
  }, [assessmentSockets, disabled, fail, releaseCapture, status, stopRecording]);

  useEffect(() => {
    const nextSignal = nextAutoStartSignal(autoStartSignal, disabled, lastAutoStartSignalRef.current);
    if (nextSignal === null) return;
    lastAutoStartSignalRef.current = nextSignal;
    void startRecording();
  }, [autoStartSignal, disabled, startRecording]);

  useEffect(() => () => {
    generationRef.current += 1;
    finalizationRequestedRef.current = true;
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }, [releaseCapture]);

  const isRecording = status === "recording";
  const isPending = status === "requesting" || status === "finalizing" || transcription.status === "pending";
  const formattedDuration = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;
  const displayedTranscript = transcription.status === "available" ? transcription.value.transcript
    : transcription.status === "partial" ? transcription.transcript
      : transcription.status === "failed" ? transcription.transcript : "";
  const canStart = !isRecording && status !== "requesting" && status !== "finalizing" && transcription.status !== "pending" && transcription.status !== "partial";

  return (
    <section className="rounded-lg border border-base-300 bg-base-200/60 p-4" aria-label="Resposta por voz">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Responda em voz alta</p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {isRecording ? `Gravando · ${formattedDuration}` : status === "requesting" ? "Conectando ao transcritor…" : isPending ? "Finalizando a transcrição…" : transcription.status === "available" ? "Transcrição final pronta para envio." : transcription.status === "partial" ? "Transcrição parcial recebida; finalize a gravação para concluir." : status === "error" ? "A gravação foi interrompida." : "A gravação encerra após 3,5 segundos de silêncio ou pelo botão."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canStart && <button type="button" className="btn btn-sm btn-outline gap-2" onClick={() => void startRecording()} disabled={disabled}><Mic className="size-4" aria-hidden="true" />{transcription.status === "available" ? "Gravar novamente" : status === "error" || transcription.status === "failed" ? "Tentar novamente" : "Iniciar gravação"}</button>}
          {isRecording && <><button type="button" className="btn btn-sm btn-primary gap-2" onClick={() => stopRecording("manual")}><Square className="size-3 fill-current" aria-hidden="true" />Finalizar resposta</button><button type="button" className="btn btn-sm btn-ghost gap-2" onClick={cancelRecording}><X className="size-4" aria-hidden="true" />Descartar gravação</button></>}
          {isPending && <LoaderCircle className="size-5 animate-spin self-center text-muted-foreground" aria-hidden="true" />}
        </div>
      </div>
      {showTranscript && displayedTranscript && <div className="mt-3 border-t border-base-300 pt-3" aria-live="polite">
        <p className="text-xs font-medium text-muted-foreground">{transcription.status === "available" ? "TRANSCRIÇÃO FINAL · SOMENTE LEITURA" : "TRECHO PARCIAL · SOMENTE LEITURA"}</p>
        <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{displayedTranscript}</p>
      </div>}
      {error && transcription.status !== "failed" && <p className="mt-3 text-sm text-error" role="alert">{error}</p>}
      {transcription.status === "failed" && <p className="mt-3 text-sm text-warning-content" role="status">{transcription.message} {transcription.transcript ? "Este trecho parcial não será enviado. Tente gravar novamente, pule a pergunta ou encerre a prática." : "Tente gravar novamente, pule a pergunta ou encerre a prática."}</p>}
    </section>
  );
}
