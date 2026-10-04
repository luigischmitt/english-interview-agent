"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft, ChevronDown, Check } from "lucide-react";
import type { InterviewConfig } from "@/lib/interview/types";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { useSpeechWarmup, useVoiceReadiness } from "../hooks/use-speech-playback";
import { synthesizeInterviewerQuestion, warmUpInterviewerSpeech } from "@/lib/interview/speech-playback.mjs";
import { getInterviewSetupSummary, getInterviewerAudioMode, withInterviewerAudioMode } from "@/lib/interview/setup-audio.mjs";
import { PageIntro } from "./shared";
import { RoleCombobox } from "@/components/ui/role-combobox";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";
import "./interview-setup.css";
import { defaultInterviewConfig } from "../interview-config";
import { defaultTranscriptionEngine } from "@/lib/interview/transcription-engine.mjs";
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
  const [voiceAttempt, setVoiceAttempt] = useState(0);
  const voiceState = useVoiceReadiness(config.playInterviewerAudio, voiceAttempt);
  const [roomOptionsOpen, setRoomOptionsOpen] = useState(false);
  const roomOptionsRef = useRef<HTMLElement>(null);
  const voiceBlocked = config.playInterviewerAudio && voiceState !== "ready";

  const cancelAudioTest = () => {
    audioTestRef.current?.cancel();
    audioTestRef.current = null;
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
    if (!config.playInterviewerAudio || voiceState !== "ready") return;
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
        message: "A reprodução terminou neste dispositivo.",
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config.role.trim()) {
      setShowErrors(true);
      return;
    }
    if (voiceBlocked) return;
    cancelAudioTest();
    // Whisper is the only engine and the candidate's own live captions are always off.
    onStart({ ...config, role: config.role.trim(), transcriptionEngine: defaultTranscriptionEngine, showCandidateCaptions: false });
  };

  const [cargoSummary, ...allSummary] = getInterviewSetupSummary(config, seniorityLabels, focusLabels);
  const restSummary = allSummary.filter(({ label }) => label !== "Legenda da sua fala");

  const retryVoice = () => {
    warmUpInterviewerSpeech(`${backendBaseUrl}/api/v1/speech`, authorizedFetch);
    setVoiceAttempt((attempt) => attempt + 1);
  };

  const toggleRoomOptions = () => setRoomOptionsOpen((open) => !open);

  // When the section opens, bring the revealed content into view once it has grown.
  const handleRevealEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows" || !roomOptionsOpen) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    roomOptionsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  };

  const startLabel = config.playInterviewerAudio ? "Iniciar com áudio" : "Iniciar somente com texto";
  const startHint = voiceState === "unavailable"
    ? "A voz não ficou pronta. Tente de novo acima ou escolha “Somente texto”."
    : "Aguarde a voz do entrevistador ficar pronta para iniciar com áudio.";
  const roleInvalid = showErrors && !config.role.trim();

  return (
    <main id="main-content" className={`isu-root mx-auto w-full min-w-0 max-w-6xl px-4 pb-[calc(var(--shl-bottom-nav-h,0px)+9rem)] pt-6 sm:px-8 sm:pt-8 lg:px-12 lg:pb-16 lg:pt-10`}>
      <button type="button" className="ds-btn ds-btn-quiet -ml-3 mb-6 min-h-10 gap-2 px-3 text-sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar à visão geral
      </button>

      <PageIntro
        title="Configure sua entrevista."
        description="Escolha o cargo, o foco e o tempo que você quer praticar."
      />

      <form id="interview-setup-form" onSubmit={handleSubmit} className="mt-8 grid items-start gap-6 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8" noValidate>
        <div className="flex min-w-0 flex-col gap-5">
          {/* 1. Essentials: what is being practiced */}
          <section className="ds-card ds-enter p-5 sm:p-7" style={{ "--i": 0 } as CSSProperties} aria-labelledby="interview-details-title">
            <div className="flex items-center gap-3">
              <span className="ds-step" aria-hidden="true">1</span>
              <h2 id="interview-details-title" className="ds-h2">Detalhes da entrevista</h2>
            </div>
            <p className="ds-body mt-2">Você pode mudar essas opções a cada nova sessão.</p>

            <div className="mt-6 flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label htmlFor="role-input" className="ds-label">
                  Cargo para praticar <span className="text-[#8a3a21]" aria-hidden="true">*</span>
                </label>
                <RoleCombobox
                  id="role-input"
                  value={config.role}
                  onChange={(role) => updateConfig("role", role)}
                  placeholder="Escolha ou digite, ex.: Software Engineer"
                  invalid={roleInvalid}
                  describedBy={roleInvalid ? "role-error" : undefined}
                />
                {roleInvalid && (
                  <span id="role-error" role="alert" className="ds-fade-in text-sm font-medium text-[#8a3a21]">Informe o cargo para o qual você quer praticar.</span>
                )}
              </div>

              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="ds-label mb-2">Senioridade</legend>
                <SlidingSegmented
                  name="seniority"
                  ariaLabel="Senioridade"
                  className="grid-cols-2 min-[460px]:grid-cols-4"
                  options={(Object.keys(seniorityLabels) as InterviewConfig["seniority"][]).map((value) => ({ value, label: seniorityLabels[value] }))}
                  value={config.seniority}
                  onChange={(value) => updateConfig("seniority", value)}
                />
              </fieldset>

              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="ds-label mb-2">Foco da prática</legend>
                <SlidingSegmented
                  name="focus"
                  ariaLabel="Foco da prática"
                  className="grid-cols-1 min-[560px]:grid-cols-2"
                  itemClassName="min-h-11"
                  options={(Object.keys(focusLabels) as InterviewConfig["focus"][]).map((value) => ({ value, label: focusLabels[value] }))}
                  value={config.focus}
                  onChange={(value) => updateConfig("focus", value)}
                />
              </fieldset>

              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="ds-label mb-2">Duração da sessão</legend>
                <SlidingSegmented
                  name="duration"
                  ariaLabel="Duração da sessão"
                  className="grid-cols-4"
                  options={interviewDurationOptions.map((option) => ({ value: String(option), label: `${option} min` }))}
                  value={config.duration}
                  onChange={(value) => updateConfig("duration", value)}
                />
              </fieldset>
            </div>
          </section>

          {/* 2. Interviewer voice, with its readiness and test next to the choice they affect */}
          <section className="ds-card ds-enter p-5 sm:p-7" style={{ "--i": 1 } as CSSProperties} aria-labelledby="interviewer-audio-title">
            <div className="flex items-center gap-3">
              <span className="ds-step" aria-hidden="true">2</span>
              <h2 id="interviewer-audio-title" className="ds-h2">Como o entrevistador fala</h2>
            </div>
            <p className="ds-body mt-2 max-w-2xl">Escolha como você receberá a introdução e cada pergunta. O texto da pergunta continua disponível quando o áudio falha.</p>

            <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Como o entrevistador fala</legend>
              <label className="ds-option">
                <input type="radio" name="interviewer-audio-mode" value="audio" className="ds-radio" checked={getInterviewerAudioMode(config) === "audio"} onChange={() => updateInterviewerAudioMode("audio")} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">Com áudio <span className="rounded-full bg-[#1f6b45] px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#f3f4ee]">Recomendado</span></span>
                  <span className="ds-small mt-1 block">O entrevistador fala a introdução e as perguntas em inglês. Você também pode ler o texto.</span>
                </span>
              </label>
              <label className="ds-option">
                <input type="radio" name="interviewer-audio-mode" value="text" className="ds-radio" checked={getInterviewerAudioMode(config) === "text"} onChange={() => updateInterviewerAudioMode("text")} />
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">Somente texto</span>
                  <span className="ds-small mt-1 block">O entrevistador não terá voz. A introdução e as perguntas aparecem por escrito.</span>
                </span>
              </label>
            </fieldset>

            {config.playInterviewerAudio && (
              <div className="isu-voice ds-fade-in mt-5 flex flex-col gap-3" data-voice-state={voiceState}>
                <div role="status" aria-live="polite" className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center">
                    {voiceState === "ready" ? (
                      <span className="ds-pop flex size-6 items-center justify-center rounded-full bg-[#1f6b45] text-[#f3f4ee]"><Check className="size-3.5" strokeWidth={3} /></span>
                    ) : voiceState === "warming" ? (
                      <span className="size-2.5 rounded-full bg-[#1f6b45] motion-safe:animate-pulse" />
                    ) : (
                      <span className="size-2.5 rounded-full bg-[#c9694a]" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="ds-label">
                      {voiceState === "ready" ? "Voz do entrevistador pronta" : voiceState === "warming" ? "Preparando a voz do entrevistador" : "Não conseguimos preparar a voz"}
                    </p>
                    <p className="ds-small mt-0.5">
                      {voiceState === "ready"
                        ? "Tudo certo para começar com áudio."
                        : voiceState === "warming"
                          ? "Na primeira vez isso pode levar cerca de 1 minuto. Ajuste o resto enquanto espera; o botão de iniciar libera sozinho."
                          : "Sem a voz não dá para iniciar com áudio. Tente de novo ou escolha “Somente texto”."}
                    </p>
                  </div>
                </div>
                <div className="isu-voice-bar" aria-hidden="true" />
                {voiceState === "unavailable" && (
                  <div>
                    <button type="button" className="ds-btn ds-btn-soft" onClick={retryVoice}>Tentar de novo</button>
                  </div>
                )}
                {voiceState === "ready" && (
                  <div className="flex flex-col gap-2 min-[460px]:flex-row min-[460px]:items-center">
                    <button type="button" className="ds-btn ds-btn-soft" onClick={() => void testAudio()}>
                      {audioTestStatus.kind === "loading" ? "Cancelar teste" : "Testar áudio"}
                    </button>
                    <p aria-live="polite" className={`text-sm leading-6 ${audioTestStatus.kind === "error" ? "font-medium text-[#8a3a21]" : audioTestStatus.kind === "success" ? "font-medium text-[#1f6b45]" : "text-[#44604f]"}`}>
                      {audioTestStatus.message ?? "Opcional: ouça uma frase curta antes de começar."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 3. Advanced: one level deeper, collapsed by default */}
          <section ref={roomOptionsRef} className="ds-card ds-enter scroll-mb-28 scroll-mt-24" style={{ "--i": 2 } as CSSProperties} aria-labelledby="room-options-title">
            <button type="button" className="isu-disclosure-button flex items-center gap-3 p-5 sm:px-7" aria-expanded={roomOptionsOpen} aria-controls="room-options-panel" onClick={toggleRoomOptions}>
              <span className="ds-step" aria-hidden="true">3</span>
              <span className="min-w-0 flex-1">
                <span id="room-options-title" className="ds-h2 block">Preferências da sala</span>
                <span className="ds-small block">Legendas das perguntas, câmera e microfone. Os padrões já funcionam bem.</span>
              </span>
              <ChevronDown className="ds-chevron size-5 shrink-0 text-[#44604f]" style={{ transform: roomOptionsOpen ? "rotate(180deg)" : undefined }} aria-hidden="true" />
            </button>
            <div id="room-options-panel" className="ds-reveal" data-open={roomOptionsOpen} inert={!roomOptionsOpen} onTransitionEnd={handleRevealEnd}>
              <div>
                <div className="px-5 pb-6 sm:px-7">
                  <p className="ds-body">Essas opções mudam o que aparece e quando o microfone começa a capturar.</p>
                  <div className="-mx-1 mt-4 grid gap-1 sm:grid-cols-2">
                    <SettingToggle id="show-question-captions" label="Legendas das perguntas" description={config.playInterviewerAudio ? "Mantenha as perguntas escritas à vista. Se desligar, o texto aparece quando o áudio falhar." : "No modo somente texto, as perguntas ficam sempre visíveis."} checked={config.playInterviewerAudio ? config.showQuestionCaptions : true} disabled={!config.playInterviewerAudio} disabledStatusLabel="Sempre visível" onChange={(checked) => updateOption("showQuestionCaptions", checked)} />
                    <SettingToggle id="candidate-camera" label="Prévia da câmera" description="Mostre a câmera somente neste navegador. O vídeo não é enviado nem salvo." checked={config.candidateCameraEnabled} onChange={(checked) => updateOption("candidateCameraEnabled", checked)} />
                    <SettingToggle id="auto-capture-voice" label="Iniciar microfone automaticamente" description="Peça acesso e comece após cada pergunta. Você também pode iniciar manualmente na sala." checked={config.autoCaptureVoice} onChange={(checked) => updateOption("autoCaptureVoice", checked)} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Summary + primary action: sticky beside the form on desktop, recap in flow on mobile */}
        <div className="ds-enter lg:sticky lg:top-24" style={{ "--i": 3 } as CSSProperties}>
          <aside className="isu-aside px-6 py-7 sm:px-8" aria-labelledby="session-preview-title">
            <p className="text-xs font-semibold tracking-[0.08em] text-[#9fc4ac]">Sua sessão</p>
            <h2
              id="session-preview-title"
              key={cargoSummary.value}
              className="ds-fade-in mt-2 text-balance font-[family-name:var(--font-display)] text-[1.875rem] leading-[1.1] tracking-[-0.02em] [overflow-wrap:anywhere]"
            >
              {cargoSummary.value}
            </h2>
            <dl className="mt-5 space-y-2.5 text-sm">
              {restSummary.map(({ label, value }) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-[#9fc4ac]">{label}</dt>
                  <dd key={value} className="ds-fade-in min-w-0 text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
            <button type="submit" className="ds-btn ds-btn-cta mt-7 hidden lg:flex" disabled={voiceBlocked} aria-describedby={voiceBlocked ? "start-hint" : undefined}>
              {startLabel} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
            </button>
            {voiceBlocked && <p id="start-hint" className="ds-hint ds-fade-in mt-3 hidden text-[#9fc4ac] lg:block">{startHint}</p>}
            <button type="button" className="ds-btn ds-btn-quiet mt-2 hidden w-full text-[#9fc4ac] hover:text-[#f3f4ee] lg:flex" onClick={onBack}>
              Cancelar
            </button>
          </aside>
          <p className="ds-small mt-4 px-2">
            Você pode encerrar a qualquer momento. Uma resposta já iniciada pode terminar após o tempo planejado.
          </p>
        </div>

        {/* Mobile: the primary action stays reachable */}
        <div className="isu-bar fixed inset-x-0 z-20 px-4 pb-3 pt-3 lg:hidden">
          {voiceBlocked && <p className="ds-hint ds-fade-in mb-2 text-center text-[#44604f]">{startHint}</p>}
          <button type="submit" form="interview-setup-form" className="ds-btn ds-btn-cta-green" disabled={voiceBlocked}>
            {startLabel} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
          </button>
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
    <label htmlFor={id} className="ds-toggle" data-disabled={disabled}>
      <input id={id} type="checkbox" role="switch" className="ds-switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-semibold">{label}</span>
          <span className={`shrink-0 text-xs font-semibold ${checked || disabled ? "text-[#1f6b45]" : "text-[#5c7a6a]"}`}>{stateLabel}</span>
        </span>
        <span className="ds-small mt-1 block">{description}</span>
      </span>
    </label>
  );
}
