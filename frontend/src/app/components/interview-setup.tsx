"use client";


import { getCurrentLocale, t } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft, ChevronDown, FileText, Leaf } from "lucide-react";
import type { InterviewConfig } from "@/lib/interview/types";
import type { JobDirection, JobSeniority } from "@/lib/interview/job-direction.mjs";
import type { SetupMode } from "@/lib/interview/job-direction.mjs";
import { applyJobAnalysis, isValidJobDirection, JobDirectionRequestError, jobDescriptionMaxLength, jobDescriptionMinLength, requestJobDirection, setupModeBlocksStart } from "@/lib/interview/job-direction.mjs";
import { requestResumeDirection, ResumeDirectionRequestError, validateResumeFile } from "@/lib/interview/resume-direction.mjs";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { reportAudioDiagnostic } from "@/lib/interview/audio-diagnostics";
import { voiceBlocksInterviewStart, type VoiceReadinessState } from "@/lib/interview/voice-readiness.mjs";
import { getInterviewSetupSummary, getInterviewerAudioMode, withInterviewerAudioMode } from "@/lib/interview/setup-audio.mjs";
import { PageIntro } from "./shared";
import { inAppMicBody, inAppMicTitle, useCopyPageLink, useInAppBrowser } from "../hooks/use-in-app-browser";
import { MicrophoneTest, type MicrophoneTestHandle } from "./microphone-test";
import { readStoredMicrophoneDeviceId, storeMicrophoneDeviceId } from "@/lib/interview/mic-device.mjs";
import { VoicePicker } from "./voice-picker";
import { playVoiceSample, readStoredInterviewerVoice, storeInterviewerVoice } from "@/lib/interview/voice-picker.mjs";
import { RoleCombobox } from "@/components/ui/role-combobox";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";
import "./interview-setup.css";
import { defaultInterviewConfig } from "../interview-config";
import { interviewDurationOptions } from "@/lib/interview/session-policy.mjs";
import { VoiceReadinessStatus } from "./voice-readiness-status";

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

const subscribeNever = () => () => {};
const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

type ParkedAutomaticSetup = {
  direction: JobDirection;
  focus: InterviewConfig["focus"];
};

export function InterviewSetup({
  onBack,
  onStart,
  voiceReadiness,
  onRetryVoice,
}: {
  onBack: () => void;
  onStart: (config: InterviewConfig) => void;
  voiceReadiness: VoiceReadinessState;
  onRetryVoice: () => void;
}) {
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [jobDescription, setJobDescription] = useState("");
  const [jobDirectionStatus, setJobDirectionStatus] = useState<"idle" | "loading" | "error">("idle");
  const [jobDirectionError, setJobDirectionError] = useState("");
  const [jobDirectionEditNote, setJobDirectionEditNote] = useState("");
  const [jobDirectionValidationError, setJobDirectionValidationError] = useState("");
  const [setupMode, setSetupMode] = useState<SetupMode>("manual");
  // Direction kept aside while in manual mode, so switching modes never loses the user's edits.
  const [parkedJobSetup, setParkedJobSetup] = useState<ParkedAutomaticSetup | undefined>(undefined);
  const [parkedResumeSetup, setParkedResumeSetup] = useState<ParkedAutomaticSetup | undefined>(undefined);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeDirectionStatus, setResumeDirectionStatus] = useState<"idle" | "loading" | "error">("idle");
  const [resumeDirectionError, setResumeDirectionError] = useState("");
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const jobAnalysisGenerationRef = useRef(0);
  const resumeAnalysisGenerationRef = useRef(0);
  const [showErrors, setShowErrors] = useState(false);
  const [audioTestStatus, setAudioTestStatus] = useState<{ kind: "idle" | "loading" | "success" | "error"; message?: string }>({ kind: "idle" });
  const audioTestRef = useRef<{ cancel: () => void } | null>(null);
  const [roomOptionsOpen, setRoomOptionsOpen] = useState(false);
  const inApp = useInAppBrowser();
  const { copied, copy } = useCopyPageLink();
  const roomOptionsRef = useRef<HTMLElement>(null);
  const micTestRef = useRef<MicrophoneTestHandle>(null);
  const autoBlocked = setupModeBlocksStart(setupMode, config.jobDirection)
    || (setupMode !== "manual" && !!config.jobDirection && !isValidJobDirection(config.jobDirection));
  const voiceBlocked = voiceBlocksInterviewStart(config.playInterviewerAudio, voiceReadiness);
  const startBlocked = autoBlocked || voiceBlocked;

  const cancelAudioTest = () => {
    audioTestRef.current?.cancel();
    audioTestRef.current = null;
  };

  useEffect(() => () => {
    audioTestRef.current?.cancel();
    audioTestRef.current = null;
    jobAnalysisGenerationRef.current += 1;
    resumeAnalysisGenerationRef.current += 1;
  }, []);

  // The device chosen in an earlier session (this browser only); null on the server render, so hydration matches.
  const storedMicrophoneId = useSyncExternalStore(subscribeNever, () => readStoredMicrophoneDeviceId(window.localStorage), () => null);
  const [chosenMicrophoneId, setChosenMicrophoneId] = useState<string | null | undefined>(undefined);
  const microphoneDeviceId = chosenMicrophoneId === undefined ? storedMicrophoneId : chosenMicrophoneId;

  // The voice chosen in an earlier session (this browser only); the default on the server render, so hydration matches.
  const storedVoice = useSyncExternalStore(subscribeNever, () => readStoredInterviewerVoice(window.localStorage), () => defaultInterviewConfig.voice ?? "");
  const [chosenVoice, setChosenVoice] = useState<string | undefined>(undefined);
  const voice = chosenVoice ?? storedVoice;

  const chooseVoice = useCallback((next: string) => {
    audioTestRef.current?.cancel();
    audioTestRef.current = null;
    setAudioTestStatus({ kind: "idle" });
    setChosenVoice(next);
    storeInterviewerVoice(window.localStorage, next);
  }, []);

  const chooseMicrophone = useCallback((deviceId: string | null) => {
    setChosenMicrophoneId(deviceId);
    storeMicrophoneDeviceId(window.localStorage, deviceId);
  }, []);

  const updateConfig = (field: keyof InterviewConfig, value: string) => {
    if (field === "role" || field === "seniority") setJobDirectionValidationError("");
    setConfig((current) => {
      const jobDirection = current.jobDirection;
      if (field === "role") {
        return {
          ...current,
          role: value,
          // An emptied field keeps the direction while the person retypes; starting is blocked until the role matches it again.
          ...(jobDirection && value.trim() ? { jobDirection: { ...jobDirection, targetRole: value.trim() } } : {}),
        };
      }
      if (field === "seniority") {
        return {
          ...current,
          seniority: value,
          ...(jobDirection ? { jobDirection: { ...jobDirection, suggestedSeniority: value as JobSeniority } } : {}),
        };
      }
      return { ...current, [field]: value };
    });
    if (showErrors && field === "role" && value.trim()) {
      setShowErrors(false);
    }
  };

  const analyzeJobDescription = async () => {
    if (jobDirectionStatus === "loading") return;
    const generation = ++jobAnalysisGenerationRef.current;
    setJobDirectionStatus("loading");
    setJobDirectionError("");
    setJobDirectionEditNote("");
    setJobDirectionValidationError("");
    try {
      const direction = await requestJobDirection(jobDescription, {
        targetRole: config.role,
        seniority: config.seniority,
        focus: config.focus,
      }, authorizedFetch, `${backendBaseUrl}/api/v1/thinking/job-direction`);
      if (jobAnalysisGenerationRef.current !== generation) return;
      setConfig((current) => ({ ...applyJobAnalysis(current, direction), interviewSource: "job" }));
      setParkedJobSetup(undefined);
      setShowErrors(false);
      setJobDirectionStatus("idle");
    } catch (error) {
      if (jobAnalysisGenerationRef.current !== generation) return;
      const code = error instanceof JobDirectionRequestError ? error.code : "REQUEST_FAILED";
      const message = code === "INVALID_INPUT" || code === "INVALID_JOB_DIRECTION_REQUEST"
        ? getCurrentLocale() === "en"
          ? `Paste a job description with at least ${jobDescriptionMinLength} characters to generate the interview focus.`
          : `Cole uma descrição com pelo menos ${jobDescriptionMinLength} caracteres para gerar o direcionamento.`
        : code === "JOB_DIRECTION_TIMEOUT"
          ? "A análise demorou mais do que o esperado. Tente novamente ou mude para “Manual”."
          : code === "JOB_DIRECTION_RATE_LIMITED"
            ? "A análise está ocupada agora. Tente novamente ou mude para “Manual”."
            : code === "JOB_DIRECTION_INSUFFICIENT_CONTENT"
              ? "A descrição tem pouco conteúdo para identificar as prioridades da vaga. Cole mais detalhes e tente novamente, ou mude para “Manual”."
            : "Não foi possível analisar esta vaga agora. Tente novamente ou mude para “Manual”.";
      setJobDirectionError(message);
      setJobDirectionStatus("error");
    }
  };

  const analyzeResume = async () => {
    if (resumeDirectionStatus === "loading" || !resumeFile) return;
    const generation = ++resumeAnalysisGenerationRef.current;
    setResumeDirectionStatus("loading");
    setResumeDirectionError("");
    setJobDirectionValidationError("");
    try {
      const direction = await requestResumeDirection(resumeFile, authorizedFetch, `${backendBaseUrl}/api/v1/thinking/resume-direction`, reportAudioDiagnostic);
      if (resumeAnalysisGenerationRef.current !== generation) return;
      setConfig((current) => ({ ...applyJobAnalysis(current, direction), interviewSource: "resume" }));
      setParkedResumeSetup(undefined);
      setShowErrors(false);
      setResumeDirectionStatus("idle");
    } catch (error) {
      if (resumeAnalysisGenerationRef.current !== generation) return;
      const code = error instanceof ResumeDirectionRequestError ? error.code : "REQUEST_FAILED";
      const message = code === "RESUME_FILE_TOO_LARGE"
        ? "O PDF pode ter no máximo 5 MB. Escolha uma versão menor."
        : code === "RESUME_TOO_MANY_PAGES"
          ? "O currículo pode ter no máximo 20 páginas."
          : code === "RESUME_INVALID_PDF"
            ? "Não conseguimos ler este PDF. Use um arquivo com texto selecionável e sem senha."
            : code === "RESUME_INSUFFICIENT_CONTENT"
              ? "O PDF tem pouco texto útil. Envie uma versão com experiências e projetos descritos."
              : code === "RESUME_CONTENT_TOO_LARGE"
                ? "O currículo tem texto demais para a análise. Envie uma versão mais curta."
                : code === "RESUME_DIRECTION_TIMEOUT"
                  ? "A análise demorou mais do que o esperado. Tente novamente."
                  : code === "RESUME_DIRECTION_RATE_LIMITED"
                    ? "A análise está ocupada agora. Aguarde um pouco e tente novamente."
                    : code === "INVALID_RESUME_REQUEST"
                      ? "Escolha um arquivo PDF válido para analisar."
                      : "Não foi possível analisar este currículo agora. Tente novamente ou use o modo manual.";
      setResumeDirectionError(message);
      setResumeDirectionStatus("error");
    }
  };

  const changeSetupMode = (mode: SetupMode) => {
    if (mode === setupMode) return;
    if (setupMode === "auto") {
      jobAnalysisGenerationRef.current += 1;
      setJobDirectionStatus("idle");
    }
    if (setupMode === "resume") {
      resumeAnalysisGenerationRef.current += 1;
      setResumeDirectionStatus("idle");
    }
    const activeDirection = config.jobDirection;
    if (setupMode === "auto" && activeDirection) setParkedJobSetup({ direction: activeDirection, focus: config.focus });
    if (setupMode === "resume" && activeDirection) setParkedResumeSetup({ direction: activeDirection, focus: config.focus });
    const restored = mode === "auto" ? parkedJobSetup : mode === "resume" ? parkedResumeSetup : undefined;
    setSetupMode(mode);
    setConfig((current) => {
      const base = { ...current };
      delete base.jobDirection;
      delete base.interviewSource;
      if (!restored) return { ...base, interviewSource: mode === "manual" ? "manual" : mode === "auto" ? "job" : "resume" };
      return {
        ...base,
        role: restored.direction.targetRole,
        seniority: restored.direction.suggestedSeniority,
        focus: restored.focus,
        jobDirection: restored.direction,
        interviewSource: mode === "auto" ? "job" : "resume",
      };
    });
    if (mode === "auto") setParkedJobSetup(undefined);
    if (mode === "resume") setParkedResumeSetup(undefined);
    setJobDirectionError("");
    setResumeDirectionError("");
    setJobDirectionEditNote("");
    setJobDirectionValidationError("");
  };

  const clearAnalysis = () => {
    setConfig((current) => ({ ...current, jobDirection: undefined }));
    if (setupMode === "resume") {
      resumeAnalysisGenerationRef.current += 1;
      setParkedResumeSetup(undefined);
      setResumeFile(null);
      if (resumeInputRef.current) resumeInputRef.current.value = "";
      setResumeDirectionError("");
      setResumeDirectionStatus("idle");
    } else {
      jobAnalysisGenerationRef.current += 1;
      setParkedJobSetup(undefined);
      setJobDescription("");
      setJobDirectionStatus("idle");
    }
    setJobDirectionError("");
    setJobDirectionEditNote("");
    setJobDirectionValidationError("");
  };

  const chooseResumeFile = (file: File | null) => {
    resumeAnalysisGenerationRef.current += 1;
    setResumeDirectionStatus("idle");
    setResumeDirectionError("");
    setJobDirectionValidationError("");
    setResumeFile(file);
    setConfig((current) => ({ ...current, jobDirection: undefined, interviewSource: "resume" }));
    setParkedResumeSetup(undefined);
    if (!file) return;
    const code = validateResumeFile(file);
    if (code === "RESUME_FILE_TOO_LARGE") setResumeDirectionError("O PDF pode ter no máximo 5 MB. Escolha uma versão menor.");
    else if (code) setResumeDirectionError("Escolha um arquivo PDF válido para analisar.");
  };

  const editJobDirection = (field: keyof JobDirection, value: string) => {
    setJobDirectionValidationError("");
    let normalizedValue = value;
    if (field === "priorityCompetencies") {
      const lines = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
      setJobDirectionEditNote(lines.length > 5 ? "Mantenha no máximo cinco competências; as linhas extras não foram adicionadas." : "");
      normalizedValue = lines.slice(0, 5).map((item) => item.slice(0, 100)).join("\n");
    } else {
      setJobDirectionEditNote("");
    }
    setConfig((current) => {
      const direction = current.jobDirection;
      if (!direction) return current;
      if (field === "priorityCompetencies") {
        return { ...current, jobDirection: { ...direction, priorityCompetencies: normalizedValue.split(/\r?\n/u) } };
      }
      const maximum = field === "mainInterviewEmphasis" ? 240 : 280;
      return { ...current, jobDirection: { ...direction, [field]: normalizedValue.slice(0, maximum) } };
    });
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

    setAudioTestStatus({ kind: "loading", message: "Reproduzindo uma frase em inglês…" });
    // The same static sample as the voice list: testing (and re-testing) a voice never calls the speech API.
    const playback = playVoiceSample(voice);
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
        message: getCurrentLocale() === "en"
          ? `${t(result.message)} Check your volume and connection, then try again. Audio mode is still selected, and questions remain visible in the room.`
          : `${result.message} Confira o volume e a conexão e tente novamente. Sua escolha com áudio foi mantida; as perguntas também ficam visíveis na sala.`,
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
    if (config.jobDirection && (!isValidJobDirection(config.jobDirection)
      || config.jobDirection.targetRole.trim() !== config.role.trim()
      || config.jobDirection.suggestedSeniority !== config.seniority)) {
      setJobDirectionValidationError("Complete os campos do direcionamento ou mude para “Manual” para continuar sem ele.");
      return;
    }
    if (autoBlocked || voiceBlocked) return;
    cancelAudioTest();
    micTestRef.current?.stop();
    const jobDirection = config.jobDirection ? {
      ...config.jobDirection,
      targetRole: config.jobDirection.targetRole.trim(),
      mainInterviewEmphasis: config.jobDirection.mainInterviewEmphasis.trim(),
      priorityCompetencies: config.jobDirection.priorityCompetencies.map((item) => item.trim()),
      productTeamContext: config.jobDirection.productTeamContext.trim(),
    } : undefined;
    onStart({
      ...config,
      role: config.role.trim(),
      voice,
      microphoneDeviceId,
      interviewSource: setupMode === "auto" ? "job" : setupMode,
      ...(jobDirection ? { jobDirection } : {}),
    });
  };

  const localizedSeniorityLabels = Object.fromEntries(Object.entries(seniorityLabels).map(([key, label]) => [key, t(label)])) as typeof seniorityLabels;
  const localizedFocusLabels = Object.fromEntries(Object.entries(focusLabels).map(([key, label]) => [key, t(label)])) as typeof focusLabels;
  const [cargoSummary, ...restSummary] = getInterviewSetupSummary({ ...config, voice, interviewSource: setupMode === "resume" ? "resume" : config.interviewSource }, localizedSeniorityLabels, localizedFocusLabels);

  const toggleRoomOptions = () => setRoomOptionsOpen((open) => !open);

  // When the section opens, bring the revealed content into view once it has grown.
  const handleRevealEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows" || !roomOptionsOpen) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    roomOptionsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  };

  const startLabel = config.playInterviewerAudio
    ? voiceReadiness === "warming" ? "Ligando voz…" : voiceReadiness === "unavailable" ? "Voz indisponível" : "Iniciar com áudio"
    : "Iniciar somente com texto";
  const startHint = autoBlocked
    ? setupMode === "resume"
      ? "Analise o currículo e mantenha ao menos uma pergunta válida para continuar."
      : "Analise a vaga para continuar, ou mude para “Manual”."
    : voiceReadiness === "unavailable"
      ? "Tente ligar a voz novamente ou escolha “Somente texto”."
      : "Aguarde a voz do entrevistador ficar pronta para iniciar com áudio.";
  const roleInvalid = showErrors && !config.role.trim();

  return (
    <main id="main-content" className={`isu-root mx-auto w-full min-w-0 max-w-6xl px-4 pb-[calc(var(--shl-bottom-nav-h,0px)+9rem)] pt-6 sm:px-8 sm:pt-8 lg:px-12 lg:pb-16 lg:pt-10`}>
      <button type="button" className="ds-btn ds-btn-quiet -ml-3 mb-6 min-h-10 gap-2 px-3 text-sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("Voltar à visão geral ")}</button>

      <PageIntro
        title={t("Configure sua entrevista.")}
        description={t("Escolha o cargo, o foco e o tempo que você quer praticar.")}
      />

      <form id="interview-setup-form" onSubmit={handleSubmit} className="mt-8 grid items-start gap-6 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8" noValidate>
        <div className="flex min-w-0 flex-col gap-5">
          {/* 1. Essentials: what is being practiced, set manually or filled from a pasted job description */}
          <section className="ds-card ds-enter p-5 sm:p-7" style={{ "--i": 0 } as CSSProperties} aria-labelledby="interview-details-title">
            <div className="flex items-center gap-3">
              <span className="ds-step" aria-hidden="true">{t("1")}</span>
              <h2 id="interview-details-title" className="ds-h2">{t("Detalhes da entrevista")}</h2>
            </div>
            <p className="ds-body mt-2">{t("Você pode mudar essas opções a cada nova sessão.")}</p>

            <div className="mt-6 flex flex-col gap-6">
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="ds-label mb-2">{t("Como definir a entrevista")}</legend>
                <SlidingSegmented
                  name="setup-mode"
                  ariaLabel={t("Como definir a entrevista")}
                  className="grid-cols-1 min-[520px]:grid-cols-3"
                  itemClassName="min-h-11"
                  options={[
                    { value: "manual", label: t("Manual") },
                    { value: "auto", label: t("Pela vaga") },
                    { value: "resume", label: t("Pelo currículo") },
                  ]}
                  value={setupMode}
                  onChange={(value) => changeSetupMode(value as SetupMode)}
                />
              </fieldset>

              {/* Automatic: paste the job description. The text stays in component memory only. */}
              <div id="job-analysis-panel" className="ds-reveal" data-open={setupMode === "auto"} inert={setupMode !== "auto"}>
                <div>
                  <div className="-mx-1 px-1 pb-1">
                    <label htmlFor="job-description" className="ds-label block">{t("Descrição da vaga")}</label>
                    <p className="ds-small mt-1">{t("A IA identifica o cargo, a senioridade e o foco, e resume as prioridades. Depois você ajusta o que quiser.")}</p>
                    <textarea
                      id="job-description"
                      className="textarea ds-field mt-2 min-h-40 w-full resize-y rounded-2xl text-sm leading-6"
                      value={jobDescription}
                      maxLength={jobDescriptionMaxLength}
                      onChange={(event) => setJobDescription(event.target.value)}
                      placeholder={t("Cole aqui a descrição da vaga…")}
                      aria-describedby="job-description-help job-description-count"
                    />
                    <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:justify-between">
                      <p id="job-description-help" className="ds-small">{t("O texto é enviado ao provedor de IA para análise e não é salvo pelo app.")}</p>
                      <p id="job-description-count" className="ds-small tabular-nums">{jobDescription.length.toLocaleString("pt-BR")} {t("/ ")}{jobDescriptionMaxLength.toLocaleString("pt-BR")}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button type="button" className="btn btn-sm ds-btn ds-btn-soft" onClick={() => void analyzeJobDescription()} disabled={jobDirectionStatus === "loading"}>
                        {jobDirectionStatus === "loading" ? <><span className="loading loading-spinner loading-xs" aria-hidden="true" /> {t("Analisando vaga…")}</> : config.jobDirection ? t("Analisar novamente") : t("Analisar vaga")}
                      </button>
                      {config.jobDirection && (
                        <button type="button" className="btn btn-sm ds-btn ds-btn-quiet" onClick={clearAnalysis}>{t("Limpar análise")}</button>
                      )}
                    </div>
                    <div aria-live="polite">
                      {jobDirectionError && (
                        <div className="alert alert-warning mt-4" role="alert">
                          <p>{t(jobDirectionError)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resume mode: the PDF is sent once for analysis, then discarded by the backend. */}
              <div id="resume-analysis-panel" className="ds-reveal" data-open={setupMode === "resume"} inert={setupMode !== "resume"}>
                <div>
                  <div className="-mx-1 px-1 pb-1">
                    <label htmlFor="resume-file" className="ds-label block">{t("Currículo em PDF")}</label>
                    <p className="ds-small mt-1">{t("A IA identifica experiências e projetos para criar perguntas específicas. Você revisa tudo antes de começar.")}</p>
                    <div className="card card-border mt-3 bg-base-100">
                      <div className="card-body gap-3 p-4 sm:p-5">
                        <div className="flex items-start gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-base-200 text-base-content/70" aria-hidden="true">
                            <FileText className="size-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{t("Envie uma versão com texto selecionável")}</p>
                            <p className="ds-small mt-1">{t("Somente PDF, até 5 MB e 20 páginas. O arquivo não é salvo pelo app.")}</p>
                          </div>
                        </div>
                        <input
                          id="resume-file"
                          ref={resumeInputRef}
                          type="file"
                          accept=".pdf,application/pdf"
                          className="file-input file-input-sm w-full"
                          onChange={(event) => chooseResumeFile(event.target.files?.[0] ?? null)}
                          aria-describedby="resume-file-help"
                        />
                        <p id="resume-file-help" className="ds-small">
                          {resumeFile ? `${resumeFile.name} · ${(resumeFile.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : t("Nenhum arquivo selecionado.")}
                        </p>
                        <div className="card-actions items-center">
                          <button
                            type="button"
                            className="btn btn-sm ds-btn ds-btn-soft"
                            onClick={() => void analyzeResume()}
                            disabled={!resumeFile || !!validateResumeFile(resumeFile) || resumeDirectionStatus === "loading"}
                          >
                            {resumeDirectionStatus === "loading"
                              ? <><span className="loading loading-spinner loading-xs" aria-hidden="true" /> {t("Analisando currículo…")}</>
                              : config.jobDirection ? t("Analisar novamente") : t("Analisar currículo")}
                          </button>
                          {config.jobDirection && (
                            <button type="button" className="btn btn-sm ds-btn ds-btn-quiet" onClick={clearAnalysis}>{t("Remover análise")}</button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div aria-live="polite">
                      {resumeDirectionError && (
                        <div className="alert alert-warning mt-4" role="alert"><p>{t(resumeDirectionError)}</p></div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resume interviews use the inferred profile internally; only manual and vacancy modes expose these controls. */}
              {setupMode !== "resume" && (setupMode === "manual" || config.jobDirection) && (
                <div className="ds-fade-in flex flex-col gap-6">
                  {setupMode !== "manual" && (
                    <p className="ds-small -mb-2" role="status">{t("Preenchido a partir da vaga. Ajuste o que não estiver certo.")}</p>
                  )}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="role-input" className="ds-label">
                      {t("Cargo para praticar ")}<span className="text-danger" aria-hidden="true">{t("*")}</span>
                    </label>
                    <RoleCombobox
                      id="role-input"
                      value={config.role}
                      onChange={(role) => updateConfig("role", role)}
                      placeholder={t("Escolha ou digite, ex.: Software Engineer")}
                      invalid={roleInvalid}
                      describedBy={roleInvalid ? "role-error" : undefined}
                    />
                    {roleInvalid && (
                      <span id="role-error" role="alert" className="ds-fade-in text-sm font-medium text-danger">{t("Informe o cargo para o qual você quer praticar.")}</span>
                    )}
                  </div>

                  <fieldset className="flex min-w-0 flex-col gap-2">
                    <legend className="ds-label mb-2">{t("Senioridade")}</legend>
                    <SlidingSegmented
                      name="seniority"
                      ariaLabel={t("Senioridade")}
                      className="grid-cols-2 min-[460px]:grid-cols-4"
                      options={(Object.keys(seniorityLabels) as InterviewConfig["seniority"][]).map((value) => ({ value, label: t(seniorityLabels[value]) }))}
                      value={config.seniority}
                      onChange={(value) => updateConfig("seniority", value)}
                    />
                  </fieldset>

                  <fieldset className="flex min-w-0 flex-col gap-2">
                    <legend className="ds-label mb-2">{t("Foco da prática")}</legend>
                    <SlidingSegmented
                      name="focus"
                      ariaLabel={t("Foco da prática")}
                      className="grid-cols-1 min-[560px]:grid-cols-2"
                      itemClassName="min-h-11"
                      options={(Object.keys(focusLabels) as InterviewConfig["focus"][]).map((value) => ({ value, label: t(focusLabels[value]) }))}
                      value={config.focus}
                      onChange={(value) => updateConfig("focus", value)}
                    />
                  </fieldset>
                </div>
              )}

              {/* Direction summary from the analysis: editable, and the approved snapshot goes to the room and the report. */}
              <div id="job-direction-panel" className="ds-reveal" data-open={setupMode !== "manual" && !!config.jobDirection} inert={!(setupMode !== "manual" && config.jobDirection)}>
                <div>
                  {config.jobDirection && (
                    <fieldset className="-mx-1 rounded-2xl border border-base-300 bg-base-100 p-4 sm:p-5" aria-labelledby="direction-found-title">
                      <legend className="sr-only">{t("Direcionamento da entrevista")}</legend>
                      <h3 id="direction-found-title" className="ds-label">{t(setupMode === "resume" ? "Entrevista criada pelo currículo" : "Prioridades da vaga")}</h3>
                      <p className="ds-small mt-1">{t(setupMode === "resume" ? "Currículo analisado. As oito perguntas personalizadas ficam ocultas e aparecem somente durante a entrevista." : "Revise o direcionamento geral. As oito perguntas específicas ficam ocultas e aparecem somente durante a entrevista.")}</p>
                      {setupMode !== "resume" && <div className="mt-4 grid gap-4">
                        <div className="flex flex-col gap-2">
                          <label htmlFor="direction-emphasis" className="ds-label">{t("Principal ênfase da entrevista")}</label>
                          <textarea id="direction-emphasis" rows={2} maxLength={240} className="textarea ds-field w-full resize-y text-sm leading-6" value={config.jobDirection.mainInterviewEmphasis} onChange={(event) => editJobDirection("mainInterviewEmphasis", event.target.value)} />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label htmlFor="direction-competencies" className="ds-label">{t("Competências prioritárias")}</label>
                          <textarea id="direction-competencies" rows={Math.max(2, config.jobDirection.priorityCompetencies.length)} maxLength={5 * 101} className="textarea ds-field w-full resize-y text-sm leading-6" value={config.jobDirection.priorityCompetencies.join("\n")} onChange={(event) => editJobDirection("priorityCompetencies", event.target.value)} aria-describedby="direction-competencies-help" />
                          <p id="direction-competencies-help" className="ds-small">{t("Uma competência por linha, até cinco.")}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label htmlFor="direction-context" className="ds-label">{t("Contexto de produto e equipe")}</label>
                          <textarea id="direction-context" rows={2} maxLength={280} className="textarea ds-field w-full resize-y text-sm leading-6" value={config.jobDirection.productTeamContext} onChange={(event) => editJobDirection("productTeamContext", event.target.value)} />
                        </div>
                      </div>}
                      {jobDirectionEditNote && <p className="ds-small mt-3 text-warning" role="status">{t(jobDirectionEditNote)}</p>}
                      {jobDirectionValidationError && <p className="ds-small mt-3 text-error" role="alert">{t(jobDirectionValidationError)}</p>}
                    </fieldset>
                  )}
                </div>
              </div>

              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="ds-label mb-2">{t("Duração da sessão")}</legend>
                <SlidingSegmented
                  name="duration"
                  ariaLabel={t("Duração da sessão")}
                  className="grid-cols-4"
                  options={interviewDurationOptions.map((option) => ({ value: String(option), label: `${option} min` }))}
                  value={config.duration}
                  onChange={(value) => updateConfig("duration", value)}
                />
              </fieldset>
            </div>
          </section>

          {/* 2. Interviewer audio mode and an optional real synthesis test. */}
          <section className="ds-card ds-enter p-5 sm:p-7" style={{ "--i": 1 } as CSSProperties} aria-labelledby="interviewer-audio-title">
            <div className="flex items-center gap-3">
              <span className="ds-step" aria-hidden="true">{t("2")}</span>
              <h2 id="interviewer-audio-title" className="ds-h2">{t("Como o entrevistador fala")}</h2>
            </div>
            <p className="ds-body mt-2 max-w-2xl">{t("Escolha como você receberá a introdução e cada pergunta. O texto da pergunta continua disponível quando o áudio falha.")}</p>

            {inApp && (
              <div className="isu-inapp mt-5" role="note" aria-labelledby="inapp-title">
                <p id="inapp-title" className="ds-label">{t(inAppMicTitle(inApp))}</p>
                <p className="ds-small mt-1">{inAppMicBody(inApp)}</p>
                <div className="mt-3 flex flex-col gap-2 min-[460px]:flex-row">
                  {inApp.openUrl && <a href={inApp.openUrl} className="ds-btn ds-btn-soft">{t("Abrir no ")}{inApp.browserName}</a>}
                  <button type="button" className="ds-btn ds-btn-soft" onClick={() => void copy()}>{t(copied ? "Link copiado" : "Copiar link")}</button>
                </div>
                <span className="sr-only" role="status">{copied ? t("Link copiado") : ""}</span>
              </div>
            )}

            <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t("Como o entrevistador fala")}</legend>
              <label className="ds-option">
                <input type="radio" name="interviewer-audio-mode" value="audio" className="ds-radio" checked={getInterviewerAudioMode(config) === "audio"} onChange={() => updateInterviewerAudioMode("audio")} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">{t("Com áudio ")}<span className="rounded-full bg-green-solid px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] text-on-green">{t("Recomendado")}</span></span>
                  <span className="ds-small mt-1 block">{t("O entrevistador fala a introdução e as perguntas em inglês. Você também pode ler o texto.")}</span>
                </span>
              </label>
              <label className="ds-option">
                <input type="radio" name="interviewer-audio-mode" value="text" className="ds-radio" checked={getInterviewerAudioMode(config) === "text"} onChange={() => updateInterviewerAudioMode("text")} />
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{t("Somente texto")}</span>
                  <span className="ds-small mt-1 block">{t("O entrevistador não terá voz. A introdução e as perguntas aparecem por escrito.")}</span>
                </span>
              </label>
            </fieldset>

            {config.playInterviewerAudio && (
              <div className="ds-fade-in mt-5 space-y-4">
                <VoiceReadinessStatus state={voiceReadiness} onRetry={onRetryVoice} />
                <div className="flex flex-col gap-2 min-[460px]:flex-row min-[460px]:items-center">
                  <button type="button" className="ds-btn ds-btn-soft" onClick={() => void testAudio()} disabled={voiceReadiness !== "ready"}>
                    {t(audioTestStatus.kind === "loading" ? "Cancelar teste" : "Testar áudio")}
                  </button>
                  <p aria-live="polite" className={`text-sm leading-6 ${audioTestStatus.kind === "error" ? "font-medium text-danger" : audioTestStatus.kind === "success" ? "font-medium text-green" : "text-text-2"}`}>
                    {t(audioTestStatus.message ?? (voiceReadiness === "ready" ? "Opcional: ouça uma frase curta antes de começar." : "O teste será liberado quando a voz estiver pronta."))}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* 3. Candidate microphone: optional check, placed right after the interviewer audio choice */}
          <section className="ds-card ds-enter p-5 sm:p-7" style={{ "--i": 2 } as CSSProperties} aria-labelledby="microphone-title">
            <div className="flex items-center gap-3">
              <span className="ds-step" aria-hidden="true">{t("3")}</span>
              <h2 id="microphone-title" className="ds-h2">{t("Seu microfone")}</h2>
            </div>
            <p className="ds-body mt-2 max-w-2xl">{t("Se o navegador estiver usando o microfone errado, a entrevista não ouve você. Teste e escolha o certo. Você pode pular esta etapa.")}</p>
            <div className="mt-5">
              <MicrophoneTest ref={micTestRef} deviceId={microphoneDeviceId} onDeviceChange={chooseMicrophone} />
            </div>
          </section>

          {/* 4. Advanced: one level deeper, collapsed by default */}
          <section ref={roomOptionsRef} className="ds-card ds-enter scroll-mb-28 scroll-mt-24" style={{ "--i": 3 } as CSSProperties} aria-labelledby="room-options-title">
            <button type="button" className="isu-disclosure-button flex items-center gap-3 p-5 sm:px-7" aria-expanded={roomOptionsOpen} aria-controls="room-options-panel" onClick={toggleRoomOptions}>
              <span className="ds-step" aria-hidden="true">{t("4")}</span>
              <span className="min-w-0 flex-1">
                <span id="room-options-title" className="ds-h2 block">{t("Preferências da sala")}</span>
                <span className="ds-small block">{t("Voz do entrevistador, legendas, câmera e início da gravação. Os padrões já funcionam bem.")}</span>
              </span>
              <ChevronDown className="ds-chevron size-5 shrink-0 text-text-2" style={{ transform: roomOptionsOpen ? "rotate(180deg)" : undefined }} aria-hidden="true" />
            </button>
            <div id="room-options-panel" className="ds-reveal" data-open={roomOptionsOpen} inert={!roomOptionsOpen} onTransitionEnd={handleRevealEnd}>
              <div>
                <div className="px-5 pb-6 sm:px-7">
                  <p className="ds-body">{t("Essas opções mudam a voz, o que aparece e quando o microfone começa a capturar.")}</p>
                  <div className="mt-5">
                    <VoicePicker
                      value={voice}
                      onChange={chooseVoice}
                      onSampleStart={() => { cancelAudioTest(); setAudioTestStatus({ kind: "idle" }); }}
                      disabled={!config.playInterviewerAudio}
                      disabledNote={t("Disponível com áudio. No modo somente texto o entrevistador não fala.")}
                    />
                  </div>
                  <div className="-mx-1 mt-4 grid gap-1 sm:grid-cols-2">
                    <SettingToggle id="show-question-captions" label={t("Legendas das perguntas")} description={t(config.playInterviewerAudio ? "Mantenha as perguntas escritas à vista. Se desligar, o texto aparece quando o áudio falhar." : "No modo somente texto, as perguntas ficam sempre visíveis.")} checked={config.playInterviewerAudio ? config.showQuestionCaptions : true} disabled={!config.playInterviewerAudio} disabledStatusLabel={t("Sempre visível")} onChange={(checked) => updateOption("showQuestionCaptions", checked)} />
                    <SettingToggle id="candidate-camera" label={t("Prévia da câmera")} description={t("Mostre a câmera somente neste navegador. O vídeo não é enviado nem salvo.")} checked={config.candidateCameraEnabled} onChange={(checked) => updateOption("candidateCameraEnabled", checked)} />
                    <SettingToggle id="auto-capture-voice" label={t("Iniciar microfone automaticamente")} description={t("Peça acesso e comece após cada pergunta. Você também pode iniciar manualmente na sala.")} checked={config.autoCaptureVoice} onChange={(checked) => updateOption("autoCaptureVoice", checked)} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Summary + primary action: sticky beside the form on desktop, recap in flow on mobile */}
        <div className="ds-enter lg:sticky lg:top-24" style={{ "--i": 4 } as CSSProperties}>
          <aside className="isu-aside ds-mata px-6 py-7 sm:px-8" aria-labelledby="session-preview-title">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-on-panel-accent">
              <Leaf className="size-3.5 text-[color:var(--ds-brand-warm)]" aria-hidden="true" />
              {t("Sua sessão ")}</p>
            <h2
              id="session-preview-title"
              key={cargoSummary.value}
              className="ds-fade-in mt-2 text-balance font-[family-name:var(--font-display)] text-[1.875rem] leading-[1.1] tracking-[-0.02em] [overflow-wrap:anywhere]"
            >
              {t(cargoSummary.value)}
            </h2>
            <dl className="mt-5 space-y-2.5 text-sm">
              {restSummary.map(({ label, value }) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-on-panel-accent">{label}</dt>
                  <dd key={value} className="ds-fade-in min-w-0 text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
            <button type="submit" className="ds-btn ds-btn-cta mt-7 hidden lg:flex" disabled={startBlocked} aria-describedby={startBlocked ? "start-hint-desktop" : undefined}>
              {config.playInterviewerAudio && voiceReadiness === "warming" && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}
              {t(startLabel)} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
            </button>
            {startBlocked && <p id="start-hint-desktop" className="ds-hint ds-fade-in mt-3 hidden text-on-panel-accent lg:block">{t(startHint)}</p>}
            <button type="button" className="ds-btn ds-btn-quiet mt-2 hidden w-full text-on-panel-accent hover:text-[color:var(--ds-on-panel)] lg:flex" onClick={onBack}>
              {t("Cancelar ")}</button>
          </aside>
          <p className="ds-small mt-4 px-2">
            {t("Você pode encerrar a qualquer momento. Uma resposta já iniciada pode terminar após o tempo planejado. ")}</p>
        </div>

        {/* Mobile: the primary action stays reachable */}
        <div className="isu-bar fixed inset-x-0 z-20 px-4 pb-3 pt-3 lg:hidden">
          {startBlocked && <p id="start-hint-mobile" className="ds-hint ds-fade-in mb-2 text-center text-text-2">{t(startHint)}</p>}
          <button type="submit" form="interview-setup-form" className="ds-btn ds-btn-cta-green" disabled={startBlocked} aria-describedby={startBlocked ? "start-hint-mobile" : undefined}>
            {config.playInterviewerAudio && voiceReadiness === "warming" && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}
            {t(startLabel)} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
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
          <span className={`shrink-0 text-xs font-semibold ${checked || disabled ? "text-green" : "text-text-3"}`}>{stateLabel}</span>
        </span>
        <span className="ds-small mt-1 block">{description}</span>
      </span>
    </label>
  );
}
