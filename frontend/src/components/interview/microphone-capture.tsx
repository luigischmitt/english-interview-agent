"use client";

import { Pause, Play, Square, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type RecorderStatus = "idle" | "requesting" | "recording" | "paused" | "ready" | "error";

type MicrophoneRecorder = {
  status: RecorderStatus;
  duration: number;
  error: string | null;
  hasRecording: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  cancel: () => void;
};

const getMicrophoneError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied. You can type your answer instead.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was found. You can type your answer instead.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The microphone is already in use. You can type your answer instead.";
    }
  }
  return "Microphone capture is unavailable. You can type your answer instead.";
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
        setError("Recording failed. You can type your answer instead.");
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
          setError("No audio was captured. You can type your answer instead.");
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
      setError(captureError instanceof Error && captureError.message === "unsupported" ? "This browser cannot record audio. You can type your answer instead." : getMicrophoneError(captureError));
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

  return { status, duration, error, hasRecording: recording !== null, start, pause, resume, stop, cancel };
}

type MicrophoneCaptureProps = {
  disabled?: boolean;
  onAvailabilityChange: (available: boolean) => void;
};

export function MicrophoneCapture({ disabled = false, onAvailabilityChange }: MicrophoneCaptureProps) {
  const recorder = useMicrophoneRecorder();
  const isRecording = recorder.status === "recording";
  const isPaused = recorder.status === "paused";
  const busy = disabled || recorder.status === "requesting";
  const formattedDuration = `${String(Math.floor(recorder.duration / 60)).padStart(2, "0")}:${String(recorder.duration % 60).padStart(2, "0")}`;

  useEffect(() => onAvailabilityChange(recorder.hasRecording), [onAvailabilityChange, recorder.hasRecording]);

  return (
    <div className="rounded-lg border border-dashed border-base-300 bg-base-200/60 p-4" aria-label="Optional microphone answer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Answer with your voice <span className="font-normal text-muted-foreground">(optional)</span></p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {isRecording ? `Recording locally · ${formattedDuration}` : isPaused ? `Paused · ${formattedDuration}` : recorder.hasRecording ? `Voice answer captured · ${formattedDuration}` : "Nothing is sent or transcribed."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isRecording && !isPaused && !recorder.hasRecording && <button type="button" className="btn btn-sm btn-outline gap-2" onClick={() => void recorder.start()} disabled={busy}><Mic className="size-4" aria-hidden="true" />{recorder.status === "requesting" ? "Requesting…" : "Start recording"}</button>}
          {isRecording && <button type="button" className="btn btn-sm btn-ghost gap-2" onClick={recorder.pause}><Pause className="size-4" aria-hidden="true" />Pause</button>}
          {isPaused && <button type="button" className="btn btn-sm btn-ghost gap-2" onClick={recorder.resume}><Play className="size-4" aria-hidden="true" />Resume</button>}
          {(isRecording || isPaused) && <><button type="button" className="btn btn-sm btn-primary gap-2" onClick={recorder.stop}><Square className="size-3 fill-current" aria-hidden="true" />Finish recording</button><button type="button" className="btn btn-sm btn-ghost" onClick={recorder.cancel}>Cancel</button></>}
          {recorder.hasRecording && <button type="button" className="btn btn-sm btn-ghost" onClick={recorder.cancel} disabled={disabled}>Clear</button>}
        </div>
      </div>
      {recorder.error && <p className="mt-3 text-sm text-error" role="alert">{recorder.error}</p>}
    </div>
  );
}
