"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft } from "lucide-react";
import type { InterviewConfig } from "@/lib/interview/types";
import { synthesizeInterviewerQuestion, type SpeechPlayback } from "@/lib/interview/speech-playback.mjs";
import { getInterviewSetupSummary, getInterviewerAudioMode, withInterviewerAudioMode } from "@/lib/interview/setup-audio.mjs";
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

export function InterviewSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (config: InterviewConfig) => void;
}) {
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [showErrors, setShowErrors] = useState(false);
  const [audioTestStatus, setAudioTestStatus] = useState<{ kind: "idle" | "loading" | "success" | "error"; message?: string }>({ kind: "idle" });
  const audioTestRef = useRef<SpeechPlayback | null>(null);

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

  const updateOption = (field: "playInterviewerAudio" | "showQuestionCaptions" | "candidateCameraEnabled" | "autoCaptureVoice", value: boolean) => {
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
    });
    audioTestRef.current = playback;
    const result = await playback.promise;
    if (audioTestRef.current !== playback) return;
    audioTestRef.current = null;

    if (result.status === "completed") {
      setAudioTestStatus({ kind: "success", message: "A reprodução terminou neste dispositivo." });
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
    cancelAudioTest();
    onStart({ ...config, role: config.role.trim() });
  };

  const setupSummary = getInterviewSetupSummary(config, seniorityLabels, focusLabels);

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
        <section className="card card-border bg-card" aria-labelledby="interview-details-title" data-aos="fade-up" data-aos-duration="450">
          <div className="card-body gap-7 p-5 sm:p-8">
            <div>
              <h2 id="interview-details-title" className="card-title text-xl tracking-[-0.02em]">
                Detalhes da entrevista
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Você pode mudar essas opções a cada nova sessão.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="fieldset gap-2 sm:col-span-2">
                <span className="fieldset-legend text-sm font-medium">Cargo para praticar <span className="text-error" aria-hidden="true">*</span></span>
                <input
                  className={`input input-bordered h-11 w-full bg-base-100 ${showErrors ? "input-error" : ""}`}
                  value={config.role}
                  onChange={(event) => updateConfig("role", event.target.value)}
                  placeholder="ex.: Software Engineer"
                  aria-invalid={showErrors && !config.role.trim()}
                  aria-describedby={showErrors ? "role-error" : undefined}
                  required
                />
                {showErrors && !config.role.trim() && (
                  <span id="role-error" className="label text-error">Informe o cargo para o qual você quer praticar.</span>
                )}
              </label>

              <label className="fieldset gap-2">
                <span className="fieldset-legend text-sm font-medium">Senioridade</span>
                <select
                  className="select select-bordered h-11 w-full bg-base-100"
                  value={config.seniority}
                  onChange={(event) => updateConfig("seniority", event.target.value)}
                >
                  <option value="junior">Júnior</option>
                  <option value="mid-level">Pleno</option>
                  <option value="senior">Sênior</option>
                  <option value="staff">Staff / Lead</option>
                </select>
              </label>

              <label className="fieldset gap-2">
                <span className="fieldset-legend text-sm font-medium">Foco da prática</span>
                <select
                  className="select select-bordered h-11 w-full bg-base-100"
                  value={config.focus}
                  onChange={(event) => updateConfig("focus", event.target.value)}
                >
                  <option value="technical-depth">Profundidade técnica</option>
                  <option value="communication">Comunicação e clareza</option>
                  <option value="behavioral">Respostas comportamentais</option>
                  <option value="mixed">Prática equilibrada</option>
                </select>
              </label>

              <fieldset className="fieldset gap-2">
                <legend className="fieldset-legend text-sm font-medium">Duração da sessão</legend>
                <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-4" role="radiogroup" aria-label="Duração da sessão">
                  {interviewDurationOptions.map((option) => {
                    const minutes = String(option);
                    return (
                    <label key={minutes} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${config.duration === minutes ? "border-primary bg-primary/10 text-foreground" : "border-base-300 bg-base-100 hover:bg-base-200"}`}>
                      <input
                        type="radio"
                        name="duration"
                        value={minutes}
                        className="radio radio-primary radio-sm"
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

            <section className="border-t pt-6" aria-labelledby="interviewer-audio-title">
              <h3 id="interviewer-audio-title" className="text-lg font-semibold">Como o entrevistador fala</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Escolha como você receberá a introdução e cada pergunta. O texto da pergunta continua disponível quando o áudio falha.</p>
              <fieldset className="mt-4 space-y-3">
                <legend className="sr-only">Como o entrevistador fala</legend>
                <label className={`flex min-h-20 cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${config.playInterviewerAudio ? "border-primary bg-primary/10" : "border-base-300 bg-base-100 hover:bg-base-200"}`}>
                  <input type="radio" name="interviewer-audio-mode" value="audio" className="radio radio-primary mt-1" checked={getInterviewerAudioMode(config) === "audio"} onChange={() => updateInterviewerAudioMode("audio")} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">Com áudio <span className="badge badge-sm badge-outline">Recomendado</span></span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">O entrevistador fala a introdução e as perguntas em inglês. Você também pode ler o texto.</span>
                  </span>
                </label>
                <label className={`flex min-h-20 cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${!config.playInterviewerAudio ? "border-primary bg-primary/10" : "border-base-300 bg-base-100 hover:bg-base-200"}`}>
                  <input type="radio" name="interviewer-audio-mode" value="text" className="radio radio-primary mt-1" checked={getInterviewerAudioMode(config) === "text"} onChange={() => updateInterviewerAudioMode("text")} />
                  <span className="min-w-0">
                    <span className="block font-medium">Somente texto</span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">O entrevistador não terá voz. A introdução e as perguntas aparecem por escrito.</span>
                  </span>
                </label>
              </fieldset>

              {config.playInterviewerAudio && (
                <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <button type="button" className="btn btn-outline min-h-11" onClick={() => void testAudio()}>
                    {audioTestStatus.kind === "loading" ? "Cancelar teste" : "Testar áudio"}
                  </button>
                  <p aria-live="polite" className={`text-sm leading-6 ${audioTestStatus.kind === "error" ? "text-error" : audioTestStatus.kind === "success" ? "text-success" : "text-muted-foreground"}`}>
                    {audioTestStatus.message ?? "Clique para gerar e ouvir uma frase curta antes de começar."}
                  </p>
                </div>
              )}
            </section>

            <section className="border-t pt-6" aria-labelledby="room-options-title">
              <h3 id="room-options-title" className="text-base font-semibold">Preferências da sala</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Essas opções mudam o que aparece e quando o microfone começa a capturar.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SettingToggle id="show-question-captions" label="Legendas das perguntas" description={config.playInterviewerAudio ? "Mantenha as perguntas escritas à vista. Se desligar, o texto aparece quando o áudio falhar." : "No modo somente texto, as perguntas ficam sempre visíveis."} checked={config.playInterviewerAudio ? config.showQuestionCaptions : true} disabled={!config.playInterviewerAudio} disabledStatusLabel="Sempre visível" onChange={(checked) => updateOption("showQuestionCaptions", checked)} />
                <SettingToggle id="candidate-camera" label="Prévia da câmera" description="Mostre a câmera somente neste navegador. O vídeo não é enviado nem salvo." checked={config.candidateCameraEnabled} onChange={(checked) => updateOption("candidateCameraEnabled", checked)} />
                <SettingToggle id="auto-capture-voice" label="Iniciar microfone automaticamente" description="Peça acesso e comece após cada pergunta. Você também pode iniciar manualmente na sala." checked={config.autoCaptureVoice} onChange={(checked) => updateOption("autoCaptureVoice", checked)} />
              </div>
            </section>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" className="btn btn-ghost order-2 sm:order-1" onClick={onBack}>Cancelar</button>
              <button type="submit" className="btn btn-primary order-1 gap-2 sm:order-2">{config.playInterviewerAudio ? "Iniciar com áudio" : "Iniciar somente com texto"} <ArrowUpRight className="size-4" aria-hidden="true" /></button>
            </div>
          </div>
        </section>

        <aside className="border-y border-border py-6 lg:py-8" aria-labelledby="session-preview-title" data-aos="fade-up" data-aos-delay="80" data-aos-duration="450">
          <h2 id="session-preview-title" className="text-lg font-semibold tracking-[-0.02em]">Sua sessão</h2>
          <dl className="mt-5 space-y-3 text-sm">
            {setupSummary.map(({ label, value }) => (
              <div key={label} className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            Você pode encerrar a qualquer momento. Uma resposta já iniciada pode terminar após o tempo planejado.
          </p>
        </aside>
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
    <label htmlFor={id} className={`flex min-h-11 w-full items-start gap-3 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${disabled ? "cursor-not-allowed border-base-300 bg-base-200/70" : checked ? "cursor-pointer border-primary bg-primary/10" : "cursor-pointer border-base-300 bg-base-100 hover:bg-base-200"}`}>
      <input id={id} type="checkbox" className="checkbox checkbox-primary mt-0.5 size-5 shrink-0" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium">{label}</span>
          <span className={`shrink-0 text-xs font-semibold ${disabled ? "text-base-content/70" : checked ? "text-primary" : "text-muted-foreground"}`}>{stateLabel}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
