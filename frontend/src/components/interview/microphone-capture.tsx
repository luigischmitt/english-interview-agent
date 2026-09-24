"use client";

import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceTranscription } from "@/lib/interview/transcription";

type RecorderStatus = "idle" | "requesting" | "recording" | "finalizing" | "error";
type StreamMessage = { type?: string; sessionId?: string; provider?: VoiceTranscription["provider"]; transcript?: string; message?: string };

export type VoiceTranscriptionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "available"; value: VoiceTranscription }
  | { status: "failed"; message: string };

type MicrophoneCaptureProps = {
  disabled?: boolean;
  onTranscriptionChange: (state: VoiceTranscriptionState) => void;
};

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const maxDurationSeconds = 30;
const sampleIntervalMs = 100;
const preRollChunkCount = 1;

function measureRms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const value of buffer) sum += value * value;
  return Math.sqrt(sum / buffer.length);
}

function getSpeechThreshold(samples: number[]): number {
  const noiseLevel = samples.length ? samples.reduce((sum, level) => sum + level, 0) / samples.length : 0;
  return Math.max(0.025, Math.min(0.15, noiseLevel * 2.5));
}

function getStreamUrl(): string {
  const url = new URL("/api/v1/transcriptions/stream", backendBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "A permissão para o microfone foi negada. Você pode escrever sua resposta.";
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") return "Nenhum microfone foi encontrado. Você pode escrever sua resposta.";
    if (error.name === "NotReadableError" || error.name === "TrackStartError") return "O microfone já está em uso. Você pode escrever sua resposta.";
  }
  return "A captura de áudio não está disponível agora. Você pode escrever sua resposta.";
}

export function MicrophoneCapture({ disabled = false, onTranscriptionChange }: MicrophoneCaptureProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const preRollRef = useRef<Blob[]>([]);
  const containerHeaderSentRef = useRef(false);
  const speechStartedRef = useRef(false);
  const stopReasonRef = useRef<"manual" | "silence" | "cancel">("manual");
  const generationRef = useRef(0);
  const onTranscriptionChangeRef = useRef(onTranscriptionChange);

  useEffect(() => { onTranscriptionChangeRef.current = onTranscriptionChange; }, [onTranscriptionChange]);

  const releaseCapture = useCallback(() => {
    if (levelTimerRef.current !== null) window.clearInterval(levelTimerRef.current);
    if (durationTimerRef.current !== null) window.clearInterval(durationTimerRef.current);
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
    levelTimerRef.current = null;
    durationTimerRef.current = null;
    connectionTimeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  const fail = useCallback((message: string) => {
    generationRef.current += 1;
    stopReasonRef.current = "cancel";
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
    socket?.close();
    recorderRef.current = null;
    containerHeaderSentRef.current = false;
    preRollRef.current = [];
    setStatus("error");
    setError(message);
    const failed = { status: "failed" as const, message };
    setTranscription(failed);
    onTranscriptionChangeRef.current(failed);
  }, [releaseCapture]);

  const stopRecording = useCallback((reason: "manual" | "silence") => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopReasonRef.current = reason;
    setStatus("finalizing");
    recorder.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    generationRef.current += 1;
    stopReasonRef.current = "cancel";
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
    socket?.close();
    recorderRef.current = null;
    containerHeaderSentRef.current = false;
    preRollRef.current = [];
    setStatus("idle");
    setDuration(0);
    setError(null);
    setTranscription({ status: "idle" });
    onTranscriptionChangeRef.current({ status: "idle" });
  }, [releaseCapture]);

  const startRecording = useCallback(async () => {
    if (status === "requesting" || status === "recording" || status === "finalizing" || disabled) return;
    setError(null);
    setStatus("requesting");
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDuration(0);
    setTranscription({ status: "idle" });
    onTranscriptionChangeRef.current({ status: "idle" });
    speechStartedRef.current = false;
    stopReasonRef.current = "manual";
    containerHeaderSentRef.current = false;
    preRollRef.current = [];

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof WebSocket === "undefined") throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      await context.resume();

      const calibrationSamples: number[] = [];
      const calibrationBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize));
      const calibrationStart = performance.now();
      while (performance.now() - calibrationStart < 500) {
        if (generationRef.current !== generation) return;
        calibrationSamples.push(measureRms(analyser, calibrationBuffer));
        await new Promise((resolve) => window.setTimeout(resolve, sampleIntervalMs));
      }
      const speechThreshold = getSpeechThreshold(calibrationSamples);

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("unsupported");
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      const socket = new WebSocket(getStreamUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      const ready = new Promise<void>((resolve, reject) => {
        let connectionReady = false;
        const connectionTimeout = window.setTimeout(() => reject(new Error("timeout")), 5_000);
        connectionTimeoutRef.current = connectionTimeout;
        socket.onopen = () => socket.send(JSON.stringify({ type: "start", mimeType: mimeType.startsWith("audio/webm") ? "audio/webm" : "audio/mp4", speechThreshold }));
        socket.onerror = () => { window.clearTimeout(connectionTimeout); connectionTimeoutRef.current = null; reject(new Error("connection")); };
        socket.onmessage = (event) => {
          if (generationRef.current !== generation) return;
          let message: StreamMessage;
          try { message = JSON.parse(String(event.data)) as StreamMessage; } catch { return; }
          if (message.type === "ready") {
            connectionReady = true;
            window.clearTimeout(connectionTimeout);
            connectionTimeoutRef.current = null;
            resolve();
            return;
          }
          if (message.type === "error" && !connectionReady) {
            window.clearTimeout(connectionTimeout);
            connectionTimeoutRef.current = null;
            reject(new Error(message.message ?? "Audio transcription is unavailable right now. You can continue with a written answer."));
            return;
          }
          if (message.type === "speech-started") {
            speechStartedRef.current = true;
            preRollRef.current.forEach((chunk) => { if (socket.readyState === WebSocket.OPEN) socket.send(chunk); });
            preRollRef.current = [];
            return;
          }
          if (message.type === "silence-detected") {
            stopRecording("silence");
            return;
          }
          if (message.type === "finalizing") {
            setStatus("finalizing");
            return;
          }
          if (message.type === "result" && message.provider && message.transcript) {
            const available = { status: "available" as const, value: { provider: message.provider, transcript: message.transcript } };
            setTranscription(available);
            setStatus("idle");
            onTranscriptionChangeRef.current(available);
            releaseCapture();
            socketRef.current = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
            return;
          }
          if (message.type === "error") fail(message.message ?? "A transcrição não está disponível agora. Você pode escrever sua resposta.");
        };
        socket.onclose = (event) => {
          if (socketRef.current === socket && event.code !== 1000) {
            window.clearTimeout(connectionTimeout);
            connectionTimeoutRef.current = null;
            reject(new Error("connection"));
            fail("A conexão de áudio foi interrompida. Você pode escrever sua resposta.");
          }
        };
      });
      await ready;
      if (generationRef.current !== generation) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
        socket.close();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) throw new Error("connection");

      recorder.ondataavailable = (event) => {
        if (generationRef.current !== generation) return;
        if (event.data.size === 0) return;
        if (!containerHeaderSentRef.current) {
          containerHeaderSentRef.current = true;
          if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
          return;
        }
        if (speechStartedRef.current) {
          if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) socket.send(event.data);
          else fail("A conexão de áudio está lenta. Você pode escrever sua resposta.");
          return;
        }
        preRollRef.current.push(event.data);
        if (preRollRef.current.length > preRollChunkCount) preRollRef.current.shift();
      };
      recorder.onerror = () => { if (generationRef.current === generation) fail("A gravação falhou. Você pode escrever sua resposta."); };
      recorder.onstop = () => {
        releaseCapture();
        recorderRef.current = null;
        if (generationRef.current !== generation) return;
        if (stopReasonRef.current === "cancel") return;
        if (!speechStartedRef.current) {
          fail("Não detectei fala nesta gravação. Você pode escrever sua resposta.");
          return;
        }
        if (socket.readyState !== WebSocket.OPEN) {
          fail("A conexão de áudio foi interrompida. Você pode escrever sua resposta.");
          return;
        }
        setStatus("finalizing");
        const reason = stopReasonRef.current;
        socket.send(JSON.stringify({ type: "finalize", reason }));
        const pending = { status: "pending" as const };
        setTranscription(pending);
        onTranscriptionChangeRef.current(pending);
      };
      recorder.start(250);
      startedAtRef.current = Date.now();
      setStatus("recording");
      durationTimerRef.current = window.setInterval(() => {
        if (generationRef.current !== generation) return;
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1_000);
        setDuration(seconds);
        if (seconds >= maxDurationSeconds) stopRecording("manual");
      }, 200);
      const levelBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize));
      levelTimerRef.current = window.setInterval(() => {
        if (generationRef.current !== generation) return;
        if (socket.readyState === WebSocket.OPEN && analyserRef.current) {
          socket.send(JSON.stringify({ type: "level", value: measureRms(analyser, levelBuffer) }));
        }
      }, sampleIntervalMs);
    } catch (captureError) {
      if (generationRef.current !== generation) return;
      fail(captureError instanceof Error && captureError.message === "unsupported"
        ? "Este navegador não pode transmitir áudio. Você pode escrever sua resposta."
        : captureError instanceof Error && captureError.message === "timeout"
          ? "A conexão de áudio demorou para responder. Você pode escrever sua resposta."
          : captureError instanceof Error && captureError.message === "connection"
            ? "A conexão de áudio falhou. Você pode escrever sua resposta."
          : microphoneError(captureError));
    }
  }, [disabled, fail, releaseCapture, status, stopRecording]);

  useEffect(() => () => {
    generationRef.current += 1;
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = null;
    stopReasonRef.current = "cancel";
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
    socket?.close();
  }, [releaseCapture]);

  const isRecording = status === "recording";
  const isPending = status === "requesting" || status === "finalizing" || transcription.status === "pending";
  const formattedDuration = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;

  return (
    <section className="rounded-lg border border-dashed border-base-300 bg-base-200/60 p-4" aria-label="Resposta opcional pelo microfone">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Responda com sua voz <span className="font-normal text-muted-foreground">(opcional)</span></p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {isRecording ? `Gravando · ${formattedDuration}` : status === "requesting" ? "Conectando ao transcritor…" : isPending ? "Preparando a transcrição…" : transcription.status === "available" ? "Transcrição pronta." : status === "error" ? "A gravação não foi concluída." : "A gravação para após uma pausa ou pelo botão."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isRecording && status !== "requesting" && status !== "finalizing" && transcription.status !== "available" && <button type="button" className="btn btn-sm btn-outline gap-2" onClick={() => void startRecording()} disabled={disabled}><Mic className="size-4" aria-hidden="true" />{status === "error" ? "Tentar de novo" : "Iniciar gravação"}</button>}
          {isRecording && <><button type="button" className="btn btn-sm btn-primary gap-2" onClick={() => stopRecording("manual")}><Square className="size-3 fill-current" aria-hidden="true" />Concluir resposta</button><button type="button" className="btn btn-sm btn-ghost gap-2" onClick={cancelRecording}><X className="size-4" aria-hidden="true" />Cancelar</button></>}
          {isPending && <LoaderCircle className="size-5 animate-spin self-center text-muted-foreground" aria-hidden="true" />}
          {transcription.status === "available" && <button type="button" className="btn btn-sm btn-ghost" onClick={cancelRecording} disabled={disabled}>Limpar transcrição</button>}
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Whisper Large V3 Turbo · até 30 segundos. O áudio é enviado em blocos e removido da memória após a transcrição.</p>
      {error && transcription.status !== "failed" && <p className="mt-3 text-sm text-error" role="alert">{error}</p>}
      {transcription.status === "available" && <div className="mt-4 border-t border-base-300 pt-4" aria-live="polite"><h3 className="text-sm font-medium">Transcrição</h3><p className="mt-1 text-sm leading-6 text-base-content/75">{transcription.value.transcript}</p></div>}
      {transcription.status === "failed" && <p className="mt-3 text-sm text-warning-content" role="status">{transcription.message} Você pode continuar com uma resposta escrita.</p>}
    </section>
  );
}
