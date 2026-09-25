"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft } from "lucide-react";
import type { InterviewConfig } from "@/lib/interview/types";
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

export function InterviewSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (config: InterviewConfig) => void;
}) {
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [showErrors, setShowErrors] = useState(false);

  const updateConfig = (field: keyof InterviewConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }));
    if (showErrors && field === "role" && value.trim()) {
      setShowErrors(false);
    }
  };

  const updateOption = (field: "playInterviewerAudio" | "showQuestionCaptions" | "transcribeCandidateVoice" | "candidateCameraEnabled" | "autoCaptureVoice", value: boolean) => {
    setConfig((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config.role.trim()) {
      setShowErrors(true);
      return;
    }
    onStart({ ...config, role: config.role.trim() });
  };

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

            <section className="border-t pt-6" aria-labelledby="room-options-title">
              <h3 id="room-options-title" className="text-base font-semibold">Opções da sala</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Você pode ajustar essas opções antes de cada prática.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SettingToggle id="play-interviewer-audio" label="Áudio do entrevistador" description="Ouça a introdução e as perguntas em inglês." checked={config.playInterviewerAudio} onChange={(checked) => updateOption("playInterviewerAudio", checked)} />
                <SettingToggle id="show-question-captions" label="Legenda das perguntas" description="Mantenha o texto do entrevistador visível." checked={config.showQuestionCaptions} onChange={(checked) => updateOption("showQuestionCaptions", checked)} />
                <SettingToggle id="transcribe-candidate-voice" label="Transcrever minha fala" description="Mostre a transcrição em inglês durante a resposta." checked={config.transcribeCandidateVoice} onChange={(checked) => {
                  updateOption("transcribeCandidateVoice", checked);
                  if (!checked) updateOption("autoCaptureVoice", false);
                }} />
                <SettingToggle id="candidate-camera" label="Câmera local" description="Ative a prévia da sua câmera na sala. O vídeo não é enviado nem salvo." checked={config.candidateCameraEnabled} onChange={(checked) => updateOption("candidateCameraEnabled", checked)} />
                <SettingToggle id="auto-capture-voice" label="Captura automática" description="Inicie o microfone após a pergunta terminar." checked={config.autoCaptureVoice} disabled={!config.transcribeCandidateVoice} onChange={(checked) => updateOption("autoCaptureVoice", checked)} />
              </div>
            </section>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" className="btn btn-ghost order-2 sm:order-1" onClick={onBack}>Cancelar</button>
              <button type="submit" className="btn btn-primary order-1 gap-2 sm:order-2">Começar entrevista <ArrowUpRight className="size-4" aria-hidden="true" /></button>
            </div>
          </div>
        </section>

        <aside className="border-y border-border py-6 lg:py-8" aria-labelledby="session-preview-title" data-aos="fade-up" data-aos-delay="80" data-aos-duration="450">
          <h2 id="session-preview-title" className="text-lg font-semibold tracking-[-0.02em]">Sua sessão</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Cargo</dt>
              <dd className="max-w-[14rem] truncate text-right font-medium">{config.role || "Não selecionado"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Nível</dt>
              <dd className="font-medium">{seniorityLabels[config.seniority]}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Foco</dt>
              <dd className="max-w-[14rem] text-right font-medium">{focusLabels[config.focus]}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Formato</dt>
              <dd className="font-medium">Até {config.duration} min</dd>
            </div>
          </dl>
          <p className="mt-8 text-sm leading-6 text-muted-foreground">
            A entrevista acontece em inglês. Você pode encerrar a qualquer momento; uma resposta já iniciada pode terminar após o tempo planejado.
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
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className={`flex min-h-[4.5rem] items-center justify-between gap-4 rounded-lg border border-base-300 bg-base-100 p-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-base-200/70"}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <input id={id} type="checkbox" className="toggle toggle-primary shrink-0" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
