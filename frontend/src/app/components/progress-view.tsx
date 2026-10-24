"use client";


import { useLocale, t } from "@/lib/locale";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Play } from "lucide-react";
import { LoadingRegion, SkCard, SkChart } from "@/components/ui/loading-state";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { purgeExpiredAnswerClips } from "@/lib/interview/answer-clips";
import { invalidateDashboardCache, readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { buildProgressInsights, sessionDurationMs } from "@/lib/interview/progress-insights.mjs";
import type { InterviewReportResult } from "@/lib/interview/report";
import type { InterviewConfig } from "@/lib/interview/types";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { PageIntro } from "./shared";
import { formatPracticeDuration, ProgressContent } from "./progress/progress-content";
import { InterviewReport } from "./interview-report";
import type { ReportState } from "./interview-report";
import { requestPersistedInterviewReport } from "@/lib/interview/persisted-report";

const emptyAzureSummary: AzureMetricSummary = {
  accuracy: { mean: null, sampleCount: 0 },
  fluency: { mean: null, sampleCount: 0 },
  prosody: { mean: null, sampleCount: 0 },
};

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function ProgressView({ onStart }: { onStart?: () => void } = {}) {
  const { locale } = useLocale();
  const cachedRecords = readDashboardCache("progress") as ProgressRecord[] | undefined;
  const [records, setRecords] = useState<ProgressRecord[]>(() => cachedRecords ?? []);
  const [isLoading, setIsLoading] = useState(!cachedRecords);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [recoveryStates, setRecoveryStates] = useState<Record<string, ReportState>>({});
  const [retryingSessionId, setRetryingSessionId] = useState<string | null>(null);
  const progressScrollTop = useRef(0);

  useEffect(() => { void purgeExpiredAnswerClips(); }, []);

  useEffect(() => {
    let active = true;
    const hasCached = !!(readDashboardCache("progress") as ProgressRecord[] | undefined);
    const load = async () => {
      const result = await loadProgressRecords();
      if (!active) return;
      if (result.ok) {
        setRecords(result.value);
        setError(null);
      } else {
        if (!hasCached) {
          setRecords([]);
          setError(result.message);
        }
      }
      setIsLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [attempt]);

  const insights = useMemo(() => buildProgressInsights(records, { locale }), [records, locale]);
  const selectedSession = records.find((record) => record.id === selectedSessionId);
  const selectedStoredReport = selectedSession?.feedback?.status === "ready" && selectedSession.feedback.analysis
    ? selectedSession.feedback.analysis as InterviewReportResult
    : null;
  const selectedReportState: ReportState = selectedStoredReport
    ? { status: "ready", result: selectedStoredReport }
    : recoveryStates[selectedSession?.id ?? ""]
      ?? (selectedSession?.feedback?.status === "pending"
        ? { status: "pending" }
        : { status: "unavailable", message: selectedSession?.feedback?.status === "unavailable" ? "O relatório continua indisponível. Tente novamente em instantes." : "Este relatório ainda não foi gerado. Você pode tentar novamente agora." });

  // An old report opens at its top, like a fresh one: jump there before paint (a smooth scroll up from the list would run
  // the report backwards, playing and skipping its entrances on the way).
  const selectedReportId = selectedSession?.id ?? null;
  useLayoutEffect(() => {
    if (selectedReportId) window.scrollTo({ top: 0, behavior: "instant" });
  }, [selectedReportId]);

  const retry = () => {
    setIsLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  };

  const generateHistoricalReport = async (sessionId: string) => {
    const session = records.find((record) => record.id === sessionId);
    if (!session || retryingSessionId === sessionId) return;
    setRetryingSessionId(sessionId);
    setRecoveryStates((current) => ({ ...current, [sessionId]: { status: "pending" } }));
    try {
      const result = await requestPersistedInterviewReport(sessionId, session.feedback?.azureSummary ?? null, locale === "en" ? "en" : "pt-BR");
      setRecoveryStates((current) => ({ ...current, [sessionId]: { status: "ready", result } }));
      invalidateDashboardCache("progress");
      const refreshed = await loadProgressRecords();
      if (refreshed.ok) setRecords(refreshed.value);
    } catch (error) {
      setRecoveryStates((current) => ({
        ...current,
        [sessionId]: { status: "unavailable", message: error instanceof Error ? error.message : "O relatório continua indisponível. Tente novamente em instantes." },
      }));
      invalidateDashboardCache("progress");
      const refreshed = await loadProgressRecords();
      if (refreshed.ok) setRecords(refreshed.value);
    } finally {
      setRetryingSessionId((current) => current === sessionId ? null : current);
    }
  };

  const openHistoricalReport = (sessionId: string) => {
    progressScrollTop.current = window.scrollY;
    setSelectedSessionId(sessionId);
    const session = records.find((record) => record.id === sessionId);
    if (session?.feedback?.status === "pending") void generateHistoricalReport(sessionId);
  };

  const closeHistoricalReport = () => {
    setSelectedSessionId(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: progressScrollTop.current, behavior: "auto" }));
  };

  const startAction = onStart && (
    <button type="button" className="ds-btn ds-btn-soft" onClick={onStart}>
      <Play className="size-4 fill-current" aria-hidden="true" /> {t("Nova prática ")}</button>
  );

  const historicalAzureSummary = selectedSession?.feedback?.azureSummary ?? emptyAzureSummary;
  const historicalDuration = selectedSession ? sessionDurationMs(selectedSession) : null;
  const historicalAssessmentCount = Math.max(0, ...[historicalAzureSummary.accuracy, historicalAzureSummary.fluency, historicalAzureSummary.prosody].map((metric) => metric.sampleCount));
  const historicalConfig: InterviewConfig | null = selectedSession ? {
    role: selectedSession.targetRole,
    seniority: selectedSession.seniority ?? "",
    focus: selectedSession.focus ?? "mixed",
    duration: "",
    questionCount: null,
    playInterviewerAudio: false,
    showInterviewerCharacter: false,
    showQuestionCaptions: false,
    candidateCameraEnabled: false,
    autoCaptureVoice: false,
    jobDirection: selectedStoredReport?.jobDirection,
    interviewSource: "manual",
  } : null;

  useEffect(() => {
    if (!selectedSession || selectedReportState.status !== "pending") return;
    let active = true;
    let timer: number | null = null;
    const refresh = async () => {
      invalidateDashboardCache("progress");
      const result = await loadProgressRecords();
      if (!active) return;
      if (result.ok) setRecords(result.value);
      timer = window.setTimeout(() => { void refresh(); }, 2_500);
    };
    timer = window.setTimeout(() => { void refresh(); }, 2_500);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [selectedReportState.status, selectedSession]);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <PageIntro
        kicker={t("Progresso")}
        title={t("Seu progresso")}
        description={t("O que se repete nas suas respostas e como você evolui a cada entrevista.")}
        action={insights.sessionCount > 0 ? startAction : undefined}
      />
      {isLoading ? (
        <LoadingRegion label={`${t("Carregando progresso")}…`} className="mt-8 lg:mt-10 ld-fade">
          <SkCard className="ld-panel" minHeight="20rem" i={1}><SkChart bars={12} h="11rem" i={2} /></SkCard>
          <div className="ld-grid-2">
            <SkCard minHeight="14rem" i={3} lines={4} />
            <SkCard minHeight="14rem" i={5} lines={4} />
          </div>
          <SkCard minHeight="16rem" i={7} lines={5} />
        </LoadingRegion>
      ) : error ? (
        <section className="mt-8 lg:mt-10" role="alert">
          <div className="pg-error flex flex-col items-start gap-4 p-5 sm:p-6">
            <div>
              <h2 className="ds-h2">{t("Não foi possível carregar seu progresso.")}</h2>
              <p className="mt-1 text-sm">{t("Verifique sua conexão e tente novamente.")}</p>
            </div>
            <button type="button" className="ds-btn ds-btn-soft" onClick={retry}>{t("Tentar novamente")}</button>
          </div>
        </section>
      ) : insights.sessionCount === 0 ? (
        <section className="mt-8 lg:mt-10">
          <div className="pg-first-wrap">
            <div className="ds-card pg-first">
              <h2 className="ds-card-title">{t("Sua primeira prática começa o seu painel.")}</h2>
              <p className="ds-body mt-2 max-w-xl">
                {t("Depois de concluir uma entrevista você vê aqui seus erros mais comuns, o que estudar primeiro e a evolução a cada prática. Sessões em andamento ou abandonadas não entram. ")}</p>
              {onStart && (
                <button type="button" className="ds-btn ds-btn-cta-green pg-first-btn mt-6" onClick={onStart}>
                  <Play className="size-4 fill-current" aria-hidden="true" /> {t("Começar primeira prática ")}</button>
              )}
            </div>
            <figure className="ds-art pg-first-art" aria-hidden="true" style={{ "--art-ratio": "4 / 3" } as CSSProperties}>
              <img src="/landing/hero-mata-mobile.webp" alt="" width={704} height={552} loading="lazy" decoding="async" />
            </figure>
          </div>
        </section>
      ) : (
        <>
          <div hidden={!!selectedSession}>
            <ProgressContent insights={insights} onOpenReport={openHistoricalReport} />
          </div>
          {selectedSession && historicalConfig && (
            <div className="mt-8 lg:mt-10">
              <InterviewReport
                config={historicalConfig}
                elapsed={formatPracticeDuration(historicalDuration)}
                totalClock={historicalDuration === null ? "" : formatClock(Math.round(historicalDuration / 1000))}
                answerCount={selectedSession.answerCount}
                persistenceLabel={t(selectedReportState.status === "ready" ? "Relatório salvo desta prática." : "Entrevista salva; relatório recuperável.")}
                persistenceMessage={null}
                feedbackSyncMessage={null}
                reportState={selectedReportState}
                turns={[]}
                azureSummary={historicalAzureSummary}
                coverage={{ available: historicalAssessmentCount, pending: 0, total: historicalAssessmentCount }}
                onLeave={closeHistoricalReport}
                progressRecords={records}
                currentInterviewId={selectedSession.id}
                historical
                onRetry={() => { void generateHistoricalReport(selectedSession.id); }}
                retrying={retryingSessionId === selectedSession.id}
              />
            </div>
          )}
        </>
      )}
      {!selectedSession && <div className="ds-band" aria-hidden="true" />}
    </main>
  );
}
