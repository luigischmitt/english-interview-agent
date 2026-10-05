"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Captions, CaptionsOff, Info, LoaderCircle, Mic, MicOff, PhoneOff, SkipForward, TriangleAlert, User, Video, VideoOff, X } from "lucide-react";

import { levelToIntensity, smoothIntensity } from "@/lib/interview/mic-level-visual.mjs";
import { stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { ToucanAvatar } from "@/components/interview/toucan/toucan-avatar";
import type { SpeechFeed, ToucanState } from "@/components/interview/toucan/toucan-engine.mjs";

import "./call-stage.css";

/* ------------------------------------------------------------------ camera */

export type CameraState = "off" | "requesting" | "on" | "error";

/** Local camera preview (never sent or saved). Same behavior as before, now driven from the control bar. */
export function useCandidateCamera(initialEnabled: boolean, active: boolean) {
  const [cameraState, setCameraState] = useState<CameraState>("off");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);

  const turnOn = useCallback(async () => {
    if (cameraState === "requesting" || cameraState === "on") return;
    const generation = ++generationRef.current;
    setCameraState("requesting");
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (generationRef.current !== generation) {
        stopMediaStreamTracks(nextStream);
        return;
      }
      streamRef.current = nextStream;
      setStream(nextStream);
      setCameraState("on");
    } catch {
      if (generationRef.current !== generation) return;
      setCameraState("error");
      setCameraError("A câmera não pôde ser iniciada. Você ainda pode praticar sem vídeo.");
    }
  }, [cameraState]);

  const turnOff = useCallback(() => {
    generationRef.current += 1;
    stopMediaStreamTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setCameraState("off");
    setCameraError(null);
  }, []);

  useEffect(() => {
    if (initialEnabled) queueMicrotask(() => { void turnOn(); });
  // The setup choice is only applied when the room mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) queueMicrotask(() => turnOff());
  }, [active, turnOff]);

  useEffect(() => () => {
    generationRef.current += 1;
    stopMediaStreamTracks(streamRef.current);
  }, []);

  const enabled = cameraState === "on" && stream !== null;
  const toggle = () => (enabled || cameraState === "requesting" ? turnOff() : void turnOn());
  return { stream, enabled, cameraState, cameraError, toggle, dismissError: () => setCameraError(null) };
}

/* -------------------------------------------------------------- mic level */

/**
 * Drives the candidate tile with the real microphone level. `push` receives the raw RMS of each captured frame;
 * a rAF loop (only while `active`) smooths it and writes `--lvl` (0..1) on the tile. CSS reads it with transform and
 * opacity only. Without fresh frames the level decays to 0. The same smoothed level is mirrored in `levelRef`, which
 * the interviewer avatar reads to nod at the end of the candidate's phrases.
 */
export function useMicLevelMeter(active: boolean): { tileRef: RefObject<HTMLDivElement | null>; levelRef: RefObject<number>; push: (level: number) => void } {
  const tileRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef(0);
  const targetRef = useRef(0);
  const lastPushRef = useRef(0);

  const push = useCallback((level: number) => {
    targetRef.current = levelToIntensity(level);
    lastPushRef.current = performance.now();
  }, []);

  useEffect(() => {
    const element = tileRef.current;
    if (!active || !element) {
      targetRef.current = 0;
      levelRef.current = 0;
      element?.style.setProperty("--lvl", "0");
      return;
    }
    let frame = 0;
    let current = 0;
    const tick = (now: number) => {
      const target = now - lastPushRef.current > 300 ? 0 : targetRef.current;
      current = smoothIntensity(current, target);
      levelRef.current = current;
      element.style.setProperty("--lvl", current.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      levelRef.current = 0;
      element.style.setProperty("--lvl", "0");
    };
  }, [active]);

  return { tileRef, levelRef, push };
}

/* ------------------------------------------------------------------ tiles */

function SpeakingBars({ active }: { active: boolean }) {
  return <span className="mt-bars" data-active={active ? "true" : undefined} aria-hidden="true"><i /><i /><i /></span>;
}

export function InterviewerTile({ speaking, advancing, caption, avatarState, speechFeed, candidateLevelRef, children }: {
  speaking: boolean;
  advancing: boolean;
  caption: string | null;
  /** What the toucan is doing (see toucanStateFor). */
  avatarState: ToucanState;
  /** Interviewer audio chunks for the beak lip-sync. */
  speechFeed?: SpeechFeed | null;
  /** Smoothed candidate mic level, for the listening nods. */
  candidateLevelRef?: RefObject<number>;
  children?: ReactNode;
}) {
  return (
    <section className="mt-tile mt-interviewer" data-speaking={speaking ? "true" : undefined} data-advancing={advancing ? "true" : undefined} aria-label="Entrevistador">
      <ToucanAvatar state={avatarState} speechFeed={speechFeed} candidateLevelRef={candidateLevelRef} />
      {caption !== null && (
        <p key={caption} className="mt-caption" lang="en" aria-live="polite">{caption}</p>
      )}
      <div className="mt-name">
        <SpeakingBars active={speaking} />
        <span>Entrevistador</span>
      </div>
      {children}
    </section>
  );
}

export function CandidateTile({ tileRef, stream, cameraRequesting, capturing, detected, children }: {
  tileRef: RefObject<HTMLDivElement | null>;
  stream: MediaStream | null;
  cameraRequesting: boolean;
  /** An answer window is open: the ring follows the real mic level. */
  capturing: boolean;
  /** The server heard speech in this window. */
  detected: boolean;
  children?: ReactNode;
}) {
  // The self-view is mirrored like Meet/Zoom (it behaves like a mirror); only this preview, nothing is recorded or sent.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <section ref={tileRef} className="mt-tile mt-candidate" data-capturing={capturing ? "true" : undefined} data-detected={detected ? "true" : undefined} aria-label="Você">
      <span className="mt-glow" aria-hidden="true" />
      {stream ? (
        <video ref={videoRef} className="mt-self-view" style={{ transform: "scaleX(-1)" }} autoPlay muted playsInline aria-label="Prévia local da sua câmera" />
      ) : (
        <div className="mt-center">
          <span className="mt-avatar mt-avatar-you">
            <User className="size-8" aria-hidden="true" />
          </span>
        </div>
      )}
      {cameraRequesting && <LoaderCircle className="mt-cam-spinner size-5" aria-label="Iniciando câmera" />}
      <div className="mt-name">
        <span>Você</span>
        {!stream && <VideoOff className="size-3.5 opacity-70" aria-hidden="true" />}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- toasts */

export function Toast({ tone = "info", role = "status", children, actions, onDismiss }: {
  tone?: "info" | "warn" | "error";
  role?: "status" | "alert";
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
}) {
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div className="mt-toast" data-tone={tone} role={role}>
      <Icon className="mt-toast-icon size-4" aria-hidden="true" />
      <div className="mt-toast-body">{children}</div>
      {(actions || onDismiss) && (
        <div className="mt-toast-actions">
          {actions}
          {onDismiss && <button type="button" className="mt-toast-x" onClick={onDismiss} aria-label="Fechar aviso"><X className="size-4" aria-hidden="true" /></button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- dock */

export type MicButtonState = "recording" | "pending" | "error" | "off" | "ready";

/**
 * Toasts above the floating control bar. The toasts' height is published as `--mt-toasts-h` on the call surface,
 * which lifts the stage (and so the interviewer caption) above them: a toast never covers the caption.
 */
export function CallDock(props: {
  toasts: ReactNode;
  micState: MicButtonState;
  micLabel: string;
  micDisabled: boolean;
  recording: boolean;
  pending: boolean;
  recordingTime: string;
  onMic: () => void;
  onDiscard: () => void;
  captionsOn: boolean;
  captionsForced: boolean;
  onCaptions: () => void;
  cameraOn: boolean;
  cameraState: CameraState;
  cameraDisabled: boolean;
  onCamera: () => void;
  skipDisabled: boolean;
  onSkip: () => void;
  onEnd: () => void;
}) {
  const toastsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = toastsRef.current;
    const surface = element?.closest<HTMLElement>(".mt-call");
    if (!element || !surface) return;
    const publish = () => {
      const height = element.getBoundingClientRect().height;
      surface.style.setProperty("--mt-toasts-h", height > 0 ? `${Math.ceil(height) + 10}px` : "0px");
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      surface.style.removeProperty("--mt-toasts-h");
    };
  }, []);

  const MicIcon = props.micState === "error" ? MicOff : Mic;
  const cameraLabel = props.cameraOn ? "Desligar câmera" : props.cameraState === "requesting" ? "Cancelar câmera" : props.cameraState === "error" ? "Tentar câmera" : "Ligar câmera";
  const captionsTip = props.captionsForced ? "Legendas necessárias agora" : props.captionsOn ? "Desativar legendas" : "Ativar legendas";
  return (
    <div className="mt-dock">
      <div className="mt-toasts" ref={toastsRef}>{props.toasts}</div>
      <div className="mt-bar" role="toolbar" aria-label="Controles da entrevista">
        {props.recording && (
          <button type="button" className="mt-btn" data-tip="Descartar gravação" aria-label="Descartar gravação" onClick={props.onDiscard}>
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="mt-btn mt-btn-mic" data-state={props.micState} data-tip={props.micLabel} aria-label={props.micLabel} disabled={props.micDisabled} onClick={props.onMic}>
          {props.pending ? <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" /> : <MicIcon className="size-5" aria-hidden="true" />}
          {props.recording && <time className="sr-only" aria-label={`Tempo de gravação ${props.recordingTime}`}>{props.recordingTime}</time>}
        </button>
        <button type="button" className="mt-btn" data-off={!props.captionsOn ? "true" : undefined} data-tip={captionsTip} aria-label="Legendas do entrevistador" aria-pressed={props.captionsOn} disabled={props.captionsForced} onClick={props.onCaptions}>
          {props.captionsOn ? <Captions className="size-5" aria-hidden="true" /> : <CaptionsOff className="size-5" aria-hidden="true" />}
        </button>
        <button type="button" className="mt-btn" data-off={!props.cameraOn ? "true" : undefined} data-tip={props.cameraOn ? "Desligar câmera" : props.cameraState === "requesting" ? "Cancelar câmera" : "Ligar câmera (prévia local, não é enviada nem salva)"} aria-label={cameraLabel} aria-pressed={props.cameraOn} disabled={props.cameraDisabled} onClick={props.onCamera}>
          {props.cameraState === "requesting" ? <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" /> : props.cameraOn ? <Video className="size-5" aria-hidden="true" /> : <VideoOff className="size-5" aria-hidden="true" />}
        </button>
        <button type="button" className="mt-btn" data-tip="Pular pergunta" aria-label="Pular sem enviar" onClick={props.onSkip} disabled={props.skipDisabled}>
          <SkipForward className="size-5" aria-hidden="true" />
        </button>
        <button type="button" className="mt-btn mt-btn-end" data-tip="Encerrar entrevista" aria-label="Encerrar entrevista" aria-haspopup="dialog" onClick={props.onEnd}>
          <PhoneOff className="size-5" aria-hidden="true" />
          <span>Encerrar</span>
        </button>
      </div>
    </div>
  );
}
