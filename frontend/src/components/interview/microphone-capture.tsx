"use client";

import { Pause, Play, Square, Mic, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestVoiceTranscription, type VoiceTranscription } from "@/lib/interview/transcription";

type RecorderStatus = "idle" | "requesting" | "recording" | "paused" | "ready" | "error";

type MicrophoneRecorder = {
  status: RecorderStatus;
  duration: number;
  error: string | null;
  hasRecording: boolean;
  recording: Blob | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  cancel: () => void;
};

const getMicrophoneError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "A permissão para o microfone foi negada. Você pode escrever sua resposta.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "Nenhum microfone foi encontrado. Você pode escrever sua resposta.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "O microfone já está em uso. Você pode escrever sua resposta.";
    }
  }
  return "A captura do microfone não está disponível. Você pode escrever sua resposta.";
};

export function useMicrophoneRecorder(): MicrophoneRecorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback((stream: MediaStream | null = streamRef.current) => {
    stream?.getTracks().forEach((track) => track.stop());
    if (streamRef.current === stream) streamRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    stopTracks();
    chunksRef.current = [];
    setStatus("idle");
    setDuration(0);
    setRecording(null);
  }, [clearTimer, stopTracks]);

  const start = useCallback(async () => {
    if (status === "recording" || status === "paused" || status === "requesting") return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setError(null);
    setStatus("requesting");

    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("unsupported");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || generationRef.current !== generation) {
        stopTracks(stream);
        return;
      }
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      if (!mountedRef.current || generationRef.current !== generation) {
        stopTracks(stream);
        return;
      }
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (mountedRef.current && generationRef.current === generation && recorderRef.current === recorder && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopTracks(stream);
        if (!mountedRef.current || generationRef.current !== generation || recorderRef.current !== recorder) return;
        clearTimer();
        recorderRef.current = null;
        setStatus("error");
        setError("A gravação falhou. Você pode escrever sua resposta.");
      };
      recorder.onstop = () => {
        stopTracks(stream);
        if (!mountedRef.current || generationRef.current !== generation || recorderRef.current !== recorder) return;
        clearTimer();
        recorderRef.current = null;
        if (chunksRef.current.length > 0) {
          // Keep the Blob in component state only; it is never uploaded, played, or persisted.
          setRecording(new Blob(chunksRef.current, { type: recorder.mimeType }));
          setStatus("ready");
        } else {
          setStatus("error");
          setError("Nenhum áudio foi gravado. Você pode escrever sua resposta.");
        }
      };
      recorder.start(250);
      startedAtRef.current = Date.now();
      setDuration(0);
      setStatus("recording");
      timerRef.current = window.setInterval(() => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    } catch (captureError) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      stopTracks();
      setStatus("error");
      setError(captureError instanceof Error && captureError.message === "unsupported" ? "Este navegador não pode gravar áudio. Você pode escrever sua resposta." : getMicrophoneError(captureError));
    }
  }, [clearTimer, status, stopTracks]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      clearTimer();
      setStatus("paused");
    }
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      startedAtRef.current = Date.now() - duration * 1000;
      timerRef.current = window.setInterval(() => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
      setStatus("recording");
    }
  }, [duration]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    else if (status === "recording" || status === "paused") setStatus("idle");
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  return { status, duration, error, hasRecording: recording !== null, recording, start, pause, resume, stop, cancel };
}

type MicrophoneCaptureProps = {
  disabled?: boolean;
  onTranscriptionChange: (state: VoiceTranscriptionState) => void;
};

export type VoiceTranscriptionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "available"; value: VoiceTranscription }
  | { status: "failed"; message: string };

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const maximumAssessmentDuration = 30;

export function MicrophoneCapture({ disabled = false, onTranscriptionChange }: MicrophoneCaptureProps) {
  const recorder = useMicrophoneRecorder();
  const [transcription, setTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const isRecording = recorder.status === "recording";
  const isPaused = recorder.status === "paused";
  const isTranscribing = transcription.status === "pending";
  const busy = disabled || recorder.status === "requesting" || isTranscribing;
  const formattedDuration = `${String(Math.floor(recorder.duration / 60)).padStart(2, "0")}:${String(recorder.duration % 60).padStart(2, "0")}`;
  const assessment = transcription.status === "available" ? transcription.value.assessment : null;
  const metrics = assessment
    ? [
        { label: "Pronúncia", value: assessment.accuracyScore },
        { label: "Fluência", value: assessment.fluencyScore },
        { label: "Prosódia", value: assessment.prosodyScore },
        { label: "Nota geral", value: assessment.pronunciationScore },
      ].filter((metric): metric is { label: string; value: number } => metric.value !== null)
    : [];
  const flaggedWords = assessment?.words.filter((word) => word.errorType && word.errorType !== "None") ?? [];

  useEffect(() => {
    const recording = recorder.recording;
    if (!recording) return;

    let cancelled = false;
    const transcribe = async () => {
      if (recorder.duration > maximumAssessmentDuration) {
        const failed = { status: "failed" as const, message: "Para avaliar a fala, mantenha cada resposta por voz em até 30 segundos." };
        if (!cancelled) {
          setTranscription(failed);
          onTranscriptionChange(failed);
        }
        return;
      }

      const pending = { status: "pending" as const };
      setTranscription(pending);
      onTranscriptionChange(pending);

      try {
        const value = await requestVoiceTranscription(recording, `${backendBaseUrl}/api/v1/transcriptions`);
        if (cancelled) return;
        const available = { status: "available" as const, value };
        setTranscription(available);
        onTranscriptionChange(available);
      } catch (error) {
        if (cancelled) return;
        const failed = { status: "failed" as const, message: error instanceof Error ? error.message : "A transcrição não está disponível agora." };
        setTranscription(failed);
        onTranscriptionChange(failed);
      }
    };

    void transcribe();

    return () => {
      cancelled = true;
    };
  }, [onTranscriptionChange, recorder.duration, recorder.recording]);

  const clearRecording = () => {
    recorder.cancel();
    const idle = { status: "idle" as const };
    setTranscription(idle);
    onTranscriptionChange(idle);
  };

  return (
    <div className="rounded-lg border border-dashed border-base-300 bg-base-200/60 p-4" aria-label="Resposta opcional pelo microfone">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Responda com sua voz <span className="font-normal text-muted-foreground">(opcional)</span></p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {isRecording ? `Gravando · ${formattedDuration}` : isPaused ? `Pausado · ${formattedDuration}` : isTranscribing ? "Enviando para transcrição e avaliação…" : transcription.status === "available" ? "Transcrição e avaliação prontas." : recorder.hasRecording ? "Resposta por voz pronta para avaliação." : "Conclua uma gravação para receber transcrição e avaliação."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isRecording && !isPaused && !recorder.hasRecording && <button type="button" className="btn btn-sm btn-outline gap-2" onClick={() => void recorder.start()} disabled={busy}><Mic className="size-4" aria-hidden="true" />{recorder.status === "requesting" ? "Solicitando…" : "Iniciar gravação"}</button>}
          {isRecording && <button type="button" className="btn btn-sm btn-ghost gap-2" onClick={recorder.pause}><Pause className="size-4" aria-hidden="true" />Pausar</button>}
          {isPaused && <button type="button" className="btn btn-sm btn-ghost gap-2" onClick={recorder.resume}><Play className="size-4" aria-hidden="true" />Retomar</button>}
          {(isRecording || isPaused) && <><button type="button" className="btn btn-sm btn-primary gap-2" onClick={recorder.stop}><Square className="size-3 fill-current" aria-hidden="true" />Concluir gravação</button><button type="button" className="btn btn-sm btn-ghost" onClick={clearRecording}>Cancelar</button></>}
          {recorder.hasRecording && <button type="button" className="btn btn-sm btn-ghost" onClick={clearRecording} disabled={disabled || isTranscribing}>Limpar</button>}
        </div>
      </div>
      {recorder.error && <p className="mt-3 text-sm text-error" role="alert">{recorder.error}</p>}
      {isTranscribing && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Analisando a resposta por voz…</p>}
      {transcription.status === "available" && <div className="mt-4 space-y-4 border-t border-base-300 pt-4" aria-live="polite"><section aria-labelledby="voice-transcript-title"><h3 id="voice-transcript-title" className="text-sm font-medium">Transcrição</h3><p className="mt-1 text-sm leading-6 text-base-content/75">{transcription.value.transcript}</p></section>{metrics.length > 0 && <section aria-labelledby="voice-metrics-title" className="border-t border-base-300 pt-4"><h3 id="voice-metrics-title" className="text-sm font-medium">Sinais da fala</h3><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">{metrics.map((metric) => <div key={metric.label}><dt className="text-xs text-muted-foreground">{metric.label}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{Math.round(metric.value)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">/100</span></dd></div>)}</dl><p className="mt-3 text-xs leading-5 text-muted-foreground">Dados experimentais do Azure Speech. Eles indicam aspectos da fala, não avaliam sua competência técnica nem definem a qualidade profissional da resposta.</p></section>}{flaggedWords.length > 0 && <section aria-labelledby="flagged-words-title" className="border-t border-base-300 pt-4"><h3 id="flagged-words-title" className="text-sm font-medium">Palavras para revisar</h3><ul className="mt-2 flex flex-wrap gap-2" aria-label="Palavras sinalizadas pelo Azure Speech">{flaggedWords.map((word, index) => <li key={`${word.word}-${index}`} className="badge badge-outline gap-1.5 py-3 text-xs"><span>{word.word}</span>{word.accuracyScore !== null && <span className="text-muted-foreground">{Math.round(word.accuracyScore)}/100</span>}</li>)}</ul></section>}</div>}
      {transcription.status === "failed" && <p className="mt-3 text-sm text-warning-content" role="status">{transcription.message} Você pode continuar com uma resposta escrita.</p>}
    </div>
  );
}
