"use client";


import { t } from "@/lib/locale";
import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Mic } from "lucide-react";

import { buildAudioConstraints, isDeviceUnavailableError, micTestStatus, rmsOf, testSignalLevel } from "@/lib/interview/mic-device.mjs";
import { levelToIntensity, smoothIntensity } from "@/lib/interview/mic-level-visual.mjs";
import { stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { useAudioInputs } from "../hooks/use-audio-inputs";

type TestState = "idle" | "starting" | "on";
type Notice = { tone: "info" | "error"; text: string } | null;

export type MicrophoneTestHandle = { stop: () => void };

/** Reduced motion: the meter still reports the level, but in a few discrete steps instead of continuous movement. */
const reducedMotionIntervalMs = 250;

function describeError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "O navegador bloqueou o microfone. Libere o acesso no ícone de cadeado da barra de endereço e tente de novo.";
  if (name === "NotFoundError") return "Nenhum microfone foi encontrado neste dispositivo.";
  if (name === "NotReadableError") return "Não foi possível abrir este microfone. Ele pode estar em uso por outro app.";
  return "Não foi possível testar o microfone agora. Você ainda pode iniciar a entrevista.";
}

/**
 * Optional microphone check: asks for permission only when the user presses "Testar microfone", then shows a device
 * select and a live level meter. The stream lives only while testing: it stops on unmount, when the tab is hidden,
 * when the section scrolls out of view, and when the interview starts (via the ref).
 */
export function MicrophoneTest({ deviceId, onDeviceChange, ref }: {
  deviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
  ref?: Ref<MicrophoneTestHandle>;
}) {
  const uid = useId();
  const [state, setState] = useState<TestState>("idle");
  const [heard, setHeard] = useState<"hearing" | "silent" | "waiting">("waiting");
  const [notice, setNotice] = useState<Notice>(null);
  const [revealed, setRevealed] = useState(false); // the select stays available after the first successful test
  const { inputs, refresh } = useAudioInputs(revealed);
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const sessionRef = useRef<{ stream: MediaStream; context: AudioContext; frame: number; stopListening: () => void } | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      cancelAnimationFrame(session.frame);
      session.stopListening();
      stopMediaStreamTracks(session.stream);
      void session.context.close().catch(() => {});
    }
    if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
    setState("idle");
    setHeard("waiting");
  }, []);

  useImperativeHandle(ref, () => ({ stop }), [stop]);
  useEffect(() => stop, [stop]);

  const start = useCallback(async (requested: string | null) => {
    stop();
    const generation = generationRef.current;
    setState("starting");
    setNotice(null);
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(requested) });
      } catch (error) {
        if (requested === null || !isDeviceUnavailableError(error)) throw error;
        onDeviceChange(null);
        setNotice({ tone: "info", text: "Microfone escolhido indisponível — usando o padrão." });
        stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(null) });
      }
      if (generationRef.current !== generation) { stopMediaStreamTracks(stream); return; }
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      void context.resume().catch(() => {});
      const samples = new Float32Array(analyser.fftSize);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const startedAt = performance.now();
      let lastSignalAt: number | null = null;
      let shown = 0;
      let painted = 0;
      let reported: "hearing" | "silent" | "waiting" = "waiting";

      const track = stream.getAudioTracks()[0];
      const onEnded = () => { if (generationRef.current === generation) { stop(); setNotice({ tone: "error", text: "O microfone foi desconectado. Escolha outro e teste de novo." }); } };
      track?.addEventListener("ended", onEnded);

      const session = { stream, context, frame: 0, stopListening: () => track?.removeEventListener("ended", onEnded) };
      const tick = (now: number) => {
        if (generationRef.current !== generation) return;
        analyser.getFloatTimeDomainData(samples);
        const level = rmsOf(samples);
        const elapsed = now - startedAt;
        if (level >= testSignalLevel) lastSignalAt = elapsed;
        const next = micTestStatus({ elapsedMs: elapsed, lastSignalAtMs: lastSignalAt });
        if (next !== reported) { reported = next; setHeard(next); }
        if (!reduceMotion || now - painted >= reducedMotionIntervalMs) {
          painted = now;
          const target = levelToIntensity(level);
          shown = reduceMotion ? Math.round(target * 5) / 5 : smoothIntensity(shown, target);
          if (fillRef.current) fillRef.current.style.transform = `scaleX(${shown.toFixed(3)})`;
        }
        session.frame = requestAnimationFrame(tick);
      };
      sessionRef.current = session;
      session.frame = requestAnimationFrame(tick);
      setState("on");
      setRevealed(true);
      void refresh();
    } catch (error) {
      if (stream) stopMediaStreamTracks(stream);
      if (generationRef.current !== generation) return;
      setState("idle");
      setNotice({ tone: "error", text: describeError(error) });
    }
  }, [onDeviceChange, refresh, stop]);

  // The test never outlives what the user is looking at.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    const root = rootRef.current;
    const observer = typeof IntersectionObserver === "undefined" || !root ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) stop();
    });
    if (root) observer?.observe(root);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      observer?.disconnect();
    };
  }, [stop]);

  const choose = (value: string) => {
    const next = value === "" ? null : value;
    onDeviceChange(next);
    void start(next);
  };

  const selectValue = deviceId !== null && inputs.some((input) => input.deviceId === deviceId) ? deviceId : "";
  const busy = state === "starting";
  const statusText = state !== "on" ? null
    : heard === "hearing" ? "Captando sua voz"
      : heard === "silent" ? "Não ouvimos nada deste microfone — tente outro"
        : "Fale algo para ver o nível.";

  return (
    <div ref={rootRef} className="isu-mic" data-state={state} data-heard={state === "on" ? heard : undefined}>
      <div className="flex flex-col gap-2 min-[460px]:flex-row min-[460px]:items-center">
        <button type="button" className="ds-btn ds-btn-soft gap-2" onClick={() => (state === "on" ? stop() : void start(deviceId))} disabled={busy} aria-pressed={state === "on"}>
          <Mic className="size-4" aria-hidden="true" />
          {busy ? "Abrindo o microfone…" : state === "on" ? "Parar teste" : "Testar microfone"}
        </button>
        {state === "idle" && !notice && (
          <p className="ds-small">{deviceId !== null ? "Vamos usar o microfone que você escolheu antes. Teste para conferir." : "Opcional: confira se o navegador está ouvindo o microfone certo."}</p>
        )}
      </div>

      {revealed && inputs.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor={`${uid}-device`} className="ds-label">{t("Microfone usado na entrevista")}</label>
          <select id={`${uid}-device`} className="ds-field" value={selectValue} onChange={(event) => choose(event.target.value)} disabled={busy}>
            <option value="">{t("Padrão do sistema")}</option>
            {inputs.map((input) => <option key={input.deviceId} value={input.deviceId}>{input.label}</option>)}
          </select>
        </div>
      )}

      {state === "on" && (
        <div className="mt-4">
          <div className="isu-mic-meter" aria-hidden="true"><span ref={fillRef} className="isu-mic-fill" /></div>
        </div>
      )}

      <p role="status" aria-live="polite" className={`isu-mic-status mt-3 text-sm leading-6 ${notice?.tone === "error" || heard === "silent" && state === "on" ? "font-medium text-danger" : heard === "hearing" && state === "on" ? "font-medium text-green" : "text-text-2"}`} hidden={!notice && !statusText}>
        {t(notice?.text ?? statusText ?? "")}
      </p>
    </div>
  );
}
