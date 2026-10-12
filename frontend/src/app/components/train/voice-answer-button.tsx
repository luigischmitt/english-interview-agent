"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { micDeniedMessage } from "@/components/interview/microphone-capture";
import { createVoiceRecorder, type VoiceRecorderState } from "@/lib/practice/voice-recorder.mjs";
import { transcribePracticeAnswer } from "@/lib/practice/transcribe-practice-answer";
import "./voice-answer.css";

export function VoiceAnswerButton({ onTranscript, onError, disabled, maxSeconds = 20 }: { onTranscript: (text: string) => void; onError?: (message: string) => void; disabled?: boolean; maxSeconds?: number }) {
  const [status, setStatus] = useState<VoiceRecorderState | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  const startedAtRef = useRef(0);
  const activeRef = useRef(true);
  const reportError = (message: string) => onError?.(message);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; recorderRef.current?.cancel(); recorderRef.current = null; };
  }, []);

  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - startedAtRef.current) / 1000)), 200);
    return () => window.clearInterval(timer);
  }, [status]);

  const finish = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    await recorder.stop();
  };

  const start = async () => {
    const recorder = createVoiceRecorder({ maxSeconds, onStateChange: (next) => { if (activeRef.current) setStatus(next); } });
    recorderRef.current = recorder;
    try {
      await recorder.start();
      if (recorder.state === "recording") {
        void recorder.completed().then(async (recording) => {
          if (!activeRef.current || recorderRef.current !== recorder) return;
          recorderRef.current = null;
          await processRecording(recording);
        });
      } else if (recorder.state === "error") recorderRef.current = null;
    } catch (error) {
      recorderRef.current = null;
      if (!activeRef.current) return;
      const name = error instanceof Error ? error.name : "";
      setStatus("idle");
      reportError(name === "NotAllowedError" || name === "SecurityError" ? micDeniedMessage() : "Não foi possível acessar o microfone. Tente novamente.");
    }
  };

  const processRecording = async (recording: Awaited<ReturnType<ReturnType<typeof createVoiceRecorder>["completed"]>>) => {
    if (!activeRef.current) return;
    if (!recording) {
      setStatus("idle");
      reportError("A gravação ficou muito curta. Tente de novo.");
      return;
    }
    setStatus("transcribing");
    try {
      const result = await transcribePracticeAnswer(recording.blob, recording.mimeType);
      if (!activeRef.current) return;
      const transcript = result.transcript?.trim();
      if (!transcript) reportError("Não entendi, tente de novo");
      else onTranscript(transcript);
    } catch (error) {
      if (activeRef.current) reportError(error instanceof Error ? error.message : "Não foi possível transcrever agora. Tente novamente.");
    } finally {
      if (activeRef.current) setStatus("idle");
    }
  };

  const recording = status === "recording";
  const busy = status === "requesting" || status === "processing" || status === "transcribing";
  const handleClick = () => {
    if (recording) void finish();
    else if (!busy && !disabled) { startedAtRef.current = performance.now(); void start(); }
  };

  return (
    <div className="va-control">
      <button type="button" className={`va-button${recording ? " va-button-recording" : ""}`} onClick={handleClick} disabled={disabled || busy} aria-label={recording ? "Parar gravação" : "Gravar resposta por voz"} aria-pressed={recording}>
        {busy ? <Loader2 aria-hidden="true" className="va-spinner" /> : recording ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
      </button>
      {recording && <span className="va-live" aria-live="polite"><span className="va-dot" />Gravando {elapsed}s / {maxSeconds}s</span>}
      {status === "transcribing" && <span role="status" className="va-status">Transcrevendo…</span>}
    </div>
  );
}
