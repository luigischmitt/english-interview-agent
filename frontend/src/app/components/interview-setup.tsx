"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft } from "lucide-react";
import type { InterviewConfig } from "@/lib/interview/types";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { useSpeechWarmup, useVoiceReadiness } from "../hooks/use-speech-playback";
import { synthesizeInterviewerQuestion } from "@/lib/interview/speech-playback.mjs";
import { isBrowserVoiceAvailable, speakWithBrowserVoice } from "@/lib/interview/browser-voice.mjs";
import { getInterviewSetupSummary, getInterviewerAudioMode, withInterviewerAudioMode } from "@/lib/interview/setup-audio.mjs";
import { voiceReadinessCopy } from "@/lib/interview/voice-readiness.mjs";
import { PageIntro } from "./shared";
import { defaultInterviewConfig } from "../interview-config";
import { interviewDurationOptions } from "@/lib/interview/session-policy.mjs";

const seniorityLabels: Record<InterviewConfig["seniority"], string> = {
  junior: "Júnior",
  "mid-level": "Pleno",
  senior: "Sênior",
  staff: "Staff / Lead",
};

const focusLabels: Record<InterviewConfig["focus"], string> = {
  "technical-depth": "Profundidade técnica",
  communication: "Comunicação e clareza",
  behavioral: "Respostas comportamentais",
  mixed: "Prática equilibrada",
};

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const audioTestPhrase = "Hello, thanks for joining me today. Could you tell me about a recent project?";

const cardFieldInput =
  "w-full rounded-lg border border-[#d9e3dc] bg-[#f3f4ee] px-4 py-2.5 text-[15px] text-[#0e2a1f] placeholder:text-[#8a9c92] outline-none transition-colors duration-200 focus:border-[#1f6b45]";

const summaryPillButton =
  "block w-full rounded-full bg-[#f3f4ee] px-6 py-3.5 text-center text-base font-medium text-[#0e2a1f] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-white active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";

export function InterviewSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (config: InterviewConfig) => void;
}) {
  useSpeechWarmup();
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [showErrors, setShowErrors] = useState(false);
  const [audioTestStatus, setAudioTestStatus] = useState<{ kind: "idle" | "loading" | "success" | "error"; message?: string }>({ kind: "idle" });
  const audioTestRef = useRef<{ cancel: () => void } | null>(null);
  const [browserVoiceTesting, setBrowserVoiceTesting] = useState(false);
  const voiceState = useVoiceReadiness(config.playInterviewerAudio);

  const cancelAudioTest = () => {
    audioTestRef.current?.cancel();
    audioTestRef.current = null;
    setBrowserVoiceTesting(false);
  };

  useEffect(() => () => {
    audioTestRef.current?.cancel();
    audioTestRef.current = null;
  }, []);

  const updateConfig = (field: keyof InterviewConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }));
    if (showErrors && field === "role" && value.trim()) {
      setShowErrors(false);
    }
  };

  const updateOption = (field: "playInterviewerAudio" | "showQuestionCaptions" | "candidateCameraEnabled" | "autoCaptureVoice" | "showCandidateCaptions", value: boolean) => {
    setConfig((current) => ({ ...current, [field]: value }));
  };

  const updateInterviewerAudioMode = (mode: "audio" | "text") => {
    setConfig((current) => withInterviewerAudioMode(current, mode));
    if (mode === "text") {
      cancelAudioTest();
      setAudioTestStatus({ kind: "idle" });
    }
  };

  const testAudio = async () => {
    if (!config.playInterviewerAudio) return;
    if (audioTestRef.current) {
      cancelAudioTest();
      setAudioTestStatus({ kind: "idle" });
      return;
    }

    setAudioTestStatus({ kind: "loading", message: "Gerando e reproduzindo uma frase em inglês…" });
    const playback = synthesizeInterviewerQuestion(audioTestPhrase, {
      endpoint: `${backendBaseUrl}/api/v1/speech`,
      fetcher: authorizedFetch,
    });
    audioTestRef.current = playback;
    const result = await playback.promise;
    if (audioTestRef.current !== playback) return;
    audioTestRef.current = null;

    if (result.status === "completed") {
      setAudioTestStatus({
        kind: "success",
        message: result.voice === "browser"
          ? "Usamos a voz do navegador porque o áudio do entrevistador está instável."
          : "A reprodução terminou neste dispositivo.",
      });
    } else if (result.status === "unavailable") {
      setAudioTestStatus({
        kind: "error",
        message: `${result.message} Confira o volume e a conexão e tente novamente. Sua escolha com áudio foi mantida; as perguntas também ficam visíveis na sala.`,
      });
    } else {
      setAudioTestStatus({ kind: "idle" });
    }
  };

  const testBrowserVoice = async () => {
    if (!config.playInterviewerAudio) return;
    if (audioTestRef.current) {
      cancelAudioTest();
      setAudioTestStatus({ kind: "idle" });
      return;
    }
    if (!isBrowserVoiceAvailable()) {
      setAudioTestStatus({ kind: "error", message: "Este navegador não oferece voz sintetizada." });
      return;
    }

    setAudioTestStatus({ kind: "loading", message: "Reproduzindo a voz do navegador…" });
    const speech = speakWithBrowserVoice([audioTestPhrase]);
    audioTestRef.current = speech;
    setBrowserVoiceTesting(true);
    const result = await speech.promise;
    if (audioTestRef.current !== speech) return;
    audioTestRef.current = null;
    setBrowserVoiceTesting(false);
    if (result.status === "completed") setAudioTestStatus({ kind: "success", message: "A voz do navegador terminou de falar. Compare com o áudio do entrevistador." });
    else if (result.status === "unavailable") setAudioTestStatus({ kind: "error", message: "Não foi possível reproduzir a voz do navegador neste dispositivo." });
    else setAudioTestStatus({ kind: "idle" });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config.role.trim()) {
      setShowErrors(true);
      return;
    }
    cancelAudioTest();
    onStart({ ...config, role: config.role.trim() });
  };

  const [cargoSummary, ...restSummary] = getInterviewSetupSummary(config, seniorityLabels, focusLabels);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <button
        type="button"
        className="btn btn-ghost -ml-3 mb-7 gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar à visão geral
      </button>

      <PageIntro
        title="Configure sua entrevista."
        description="Escolha o cargo, o foco e o tempo que você quer praticar."
      />

      <form onSubmit={handleSubmit} className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]" noValidate>
        <section className="border border-[#d9e3dc] bg-white" aria-labelledby="interview-details-title" data-aos="fade-up" data-aos-duration="450">
          <div className="flex flex-col gap-7 p-5 sm:p-8">
            <div>
              <h2 id="interview-details-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1f6b45]">
                01 · Detalhes da entrevista
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Você pode mudar essas opções a cada nova sessão.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="flex flex-col gap-2 sm:col-span-2">
                <span className="text-sm font-medium">Cargo para praticar <span className="text-error" aria-hidden="true">*</span></span>
                <input
                  className={`${cardFieldInput} ${showErrors ? "border-error" : ""}`}
                  value={config.role}
                  onChange={(event) => updateConfig("role", event.target.value)}
                  placeholder="ex.: Software Engineer"
                  aria-invalid={showErrors && !config.role.trim()}
                  aria-describedby={showErrors ? "role-error" : undefined}
                  required
                />
                {showErrors && !config.role.trim() && (
                  <span id="role-error" className="text-sm text-error">Informe o cargo para o qual você quer praticar.</span>
                )}
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Senioridade</span>
                <select
                  className={cardFieldInput}
                  value={config.seniority}
                  onChange={(event) => updateConfig("seniority", event.target.value)}
                >
                  <option value="junior">Júnior</option>
                  <option value="mid-level">Pleno</option>
                  <option value="senior">Sênior</option>
                  <option value="staff">Staff / Lead</option>
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Foco da prática</span>
                <select
                  className={cardFieldInput}
                  value={config.focus}
                  onChange={(event) => updateConfig("focus", event.target.value)}
                >
                  <option value="technical-depth">Profundidade técnica</option>
                  <option value="communication">Comunicação e clareza</option>
                  <option value="behavioral">Respostas comportamentais</option>
                  <option value="mixed">Prática equilibrada</option>
                </select>
              </label>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Duração da sessão</legend>
                <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-4" role="radiogroup" aria-label="Duração da sessão">
                  {interviewDurationOptions.map((option) => {
                    const minutes = String(option);
                    return (
                    <label key={minutes} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${config.duration === minutes ? "border-[#0e2a1f] bg-[#0e2a1f] text-[#f3f4ee]" : "border-[#d9e3dc] bg-[#f3f4ee] hover:border-[#1f6b45]"}`}>
                      <input
                        type="radio"
                        name="duration"
                        value={minutes}
                        className="sr-only"
                        checked={config.duration === minutes}
                        onChange={(event) => updateConfig("duration", event.target.value)}
                      />
                      {minutes} min
                    </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <section className="border-t border-[#d9e3dc] pt-6" aria-labelledby="interviewer-audio-title">
              <h3 id="interviewer-audio-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1f6b45]">02 · Como o entrevistador fala</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Escolha como você receberá a introdução e cada pergunta. O texto da pergunta continua disponível quando o áudio falha.</p>
              <fieldset className="mt-4 grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Como o entrevistador fala</legend>
                <label className={`flex min-h-20 cursor-pointer items-start gap-3 border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${config.playInterviewerAudio ? "border-[#1f6b45] bg-[#e9f3ed]" : "border-[#d9e3dc] bg-[#f3f4ee] hover:bg-[#eceee5]"}`}>
                  <input type="radio" name="interviewer-audio-mode" value="audio" className="radio radio-primary mt-1" checked={getInterviewerAudioMode(config) === "audio"} onChange={() => updateInterviewerAudioMode("audio")} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">Com áudio <span className="rounded-full border border-[#1f6b45] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f6b45]">Recomendado</span></span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">O entrevistador fala a introdução e as perguntas em inglês. Você também pode ler o texto.</span>
                  </span>
                </label>
                <label className={`flex min-h-20 cursor-pointer items-start gap-3 border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${!config.playInterviewerAudio ? "border-[#1f6b45] bg-[#e9f3ed]" : "border-[#d9e3dc] bg-[#f3f4ee] hover:bg-[#eceee5]"}`}>
                  <input type="radio" name="interviewer-audio-mode" value="text" className="radio radio-primary mt-1" checked={getInterviewerAudioMode(config) === "text"} onChange={() => updateInterviewerAudioMode("text")} />
                  <span className="min-w-0">
                    <span className="block font-medium">Somente texto</span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">O entrevistador não terá voz. A introdução e as perguntas aparecem por escrito.</span>
                  </span>
                </label>
              </fieldset>

              {config.playInterviewerAudio && (
                <p role="status" aria-live="polite" data-voice-state={voiceState} className={`mt-4 flex items-start gap-2 text-sm leading-6 ${voiceState === "ready" ? "text-[#1f6b45]" : "text-muted-foreground"}`}>
                  <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${voiceState === "ready" ? "bg-[#1f6b45]" : voiceState === "warming" ? "bg-[#9fc4ac] motion-safe:animate-pulse" : "bg-[#8a9c92]"}`} />
                  <span>{voiceReadinessCopy[voiceState]}</span>
                </p>
              )}

              {config.playInterviewerAudio && (
                <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <button type="button" className="btn btn-outline min-h-11 rounded-full" onClick={() => void testAudio()}>
                    {audioTestStatus.kind === "loading" && !browserVoiceTesting ? "Cancelar teste" : "Testar áudio"}
                  </button>
                  <button type="button" className="btn btn-ghost min-h-11 rounded-full" onClick={() => void testBrowserVoice()} disabled={audioTestStatus.kind === "loading" && !browserVoiceTesting}>
                    {browserVoiceTesting ? "Parar voz do navegador" : "Ouvir voz do navegador"}
                  </button>
                  <p aria-live="polite" className={`text-sm leading-6 ${audioTestStatus.kind === "error" ? "text-error" : audioTestStatus.kind === "success" ? "text-success" : "text-muted-foreground"}`}>
                    {audioTestStatus.message ?? "Clique para gerar e ouvir uma frase curta antes de começar."}
                  </p>
                </div>
              )}
            </section>

            <section className="border-t border-[#d9e3dc] pt-6" aria-labelledby="room-options-title">
              <h3 id="room-options-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1f6b45]">03 · Preferências da sala</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Essas opções mudam o que aparece e quando o microfone começa a capturar.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SettingToggle id="show-question-captions" label="Legendas das perguntas" description={config.playInterviewerAudio ? "Mantenha as perguntas escritas à vista. Se desligar, o texto aparece quando o áudio falhar." : "No modo somente texto, as perguntas ficam sempre visíveis."} checked={config.playInterviewerAudio ? config.showQuestionCaptions : true} disabled={!config.playInterviewerAudio} disabledStatusLabel="Sempre visível" onChange={(checked) => updateOption("showQuestionCaptions", checked)} />
                <SettingToggle id="show-candidate-captions" label="Legenda da sua fala" description="Veja o que você diz, palavra por palavra, enquanto responde. Só aparece quando o transcritor em tempo real está ativo e nunca é salva; a transcrição final continua sendo a usada." checked={config.showCandidateCaptions} onChange={(checked) => updateOption("showCandidateCaptions", checked)} />
                <SettingToggle id="candidate-camera" label="Prévia da câmera" description="Mostre a câmera somente neste navegador. O vídeo não é enviado nem salvo." checked={config.candidateCameraEnabled} onChange={(checked) => updateOption("candidateCameraEnabled", checked)} />
                <SettingToggle id="auto-capture-voice" label="Iniciar microfone automaticamente" description="Peça acesso e comece após cada pergunta. Você também pode iniciar manualmente na sala." checked={config.autoCaptureVoice} onChange={(checked) => updateOption("autoCaptureVoice", checked)} />
              </div>
            </section>
          </div>
        </section>

        <div data-aos="fade-up" data-aos-delay="80" data-aos-duration="450">
          <aside className="bg-[#0e2a1f] px-6 py-8 text-[#f3f4ee] sm:px-8" aria-labelledby="session-preview-title">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9fc4ac]">Sua sessão</p>
            <h2
              id="session-preview-title"
              className="mt-3 text-balance font-[family-name:var(--font-landing-serif)] text-3xl leading-tight tracking-[-0.02em]"
            >
              {cargoSummary.value}
            </h2>
            <dl className="mt-6 space-y-3 border-t border-white/15 pt-5 text-sm">
              {restSummary.map(({ label, value }) => (
                <div key={label} className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-3">
                  <dt className="shrink-0 text-[#9fc4ac]">{label}</dt>
                  <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
            <button type="submit" className={`${summaryPillButton} mt-7 flex items-center justify-center gap-2`}>
              {config.playInterviewerAudio ? "Iniciar com áudio" : "Iniciar somente com texto"} <ArrowUpRight className="size-4" aria-hidden="true" />
            </button>
            <button type="button" className="mt-3 block w-full text-center text-sm text-[#9fc4ac] underline-offset-4 hover:text-[#f3f4ee] hover:underline" onClick={onBack}>
              Cancelar
            </button>
          </aside>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            Você pode encerrar a qualquer momento. Uma resposta já iniciada pode terminar após o tempo planejado.
          </p>
        </div>
      </form>
    </main>
  );

}

function SettingToggle({
  id,
  label,
  description,
  checked,
  disabled = false,
  disabledStatusLabel,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  disabledStatusLabel?: string;
  onChange: (checked: boolean) => void;
}) {
  const stateLabel = disabled ? (disabledStatusLabel ?? "Desligado") : checked ? "Ligado" : "Desligado";

  return (
    <label htmlFor={id} className={`flex min-h-11 w-full items-start gap-3 border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${disabled ? "cursor-not-allowed border-[#d9e3dc] bg-[#eceee5]" : checked ? "cursor-pointer border-[#1f6b45] bg-[#e9f3ed]" : "cursor-pointer border-[#d9e3dc] bg-[#f3f4ee] hover:bg-[#eceee5]"}`}>
      <input id={id} type="checkbox" className="checkbox checkbox-primary mt-0.5 size-5 shrink-0" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium">{label}</span>
          <span className={`shrink-0 text-xs font-semibold ${disabled ? "text-muted-foreground/70" : checked ? "text-[#1f6b45]" : "text-muted-foreground"}`}>{stateLabel}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
