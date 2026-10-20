"use client";


import { useLocale, t } from "@/lib/locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { LoadingRegion, SkCard, SkChart } from "@/components/ui/loading-state";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { purgeExpiredAnswerClips } from "@/lib/interview/answer-clips";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { buildProgressInsights, sessionDurationMs } from "@/lib/interview/progress-insights.mjs";
import type { InterviewReportResult } from "@/lib/interview/report";
import type { InterviewConfig } from "@/lib/interview/types";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { PageIntro } from "./shared";
import { formatPracticeDuration, ProgressContent } from "./progress/progress-content";
import { InterviewReport } from "./interview-report";

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
  const selectedSession = records.find((record) => record.id === selectedSessionId && record.feedback?.status === "ready" && record.feedback.analysis);

  useEffect(() => {
    if (selectedSession) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selectedSession]);

  const retry = () => {
    setIsLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  };

  const openHistoricalReport = (sessionId: string) => {
    progressScrollTop.current = window.scrollY;
    setSelectedSessionId(sessionId);
  };

  const closeHistoricalReport = () => {
    setSelectedSessionId(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: progressScrollTop.current, behavior: "auto" }));
  };

  const startAction = onStart && (
    <button type="button" className="ds-btn ds-btn-soft" onClick={onStart}>
      <Play className="size-4 fill-current" aria-hidden="true" /> {t("Nova prática ")}</button>
  );

  const historicalReport = selectedSession?.feedback?.analysis as InterviewReportResult | undefined;
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
    jobDirection: historicalReport?.jobDirection,
    interviewSource: "manual",
  } : null;

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <PageIntro
        title={t("Seu progresso")}
        description={t("O que se repete nas suas respostas, o que estudar primeiro e como você evolui a cada prática.")}
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
          <div className="shl-error ds-fade-in flex flex-col items-start gap-4 p-5 sm:p-6">
            <div>
              <h2 className="ds-h2">{t("Não foi possível carregar seu progresso.")}</h2>
              <p className="mt-1 text-sm">{t("Verifique sua conexão e tente novamente.")}</p>
            </div>
            <button type="button" className="ds-btn ds-btn-soft" onClick={retry}>{t("Tentar novamente")}</button>
          </div>
        </section>
      ) : insights.sessionCount === 0 ? (
        <section className="mt-8 lg:mt-10">
          <div className="shl-dashed ds-enter p-6 sm:p-8">
            <span className="shl-pill shl-pill-off">{t("Nenhuma sessão concluída ainda")}</span>
            <div className="mt-4">
              <h2 className="ds-h2">{t("Sua primeira prática começa o seu painel.")}</h2>
              <p className="ds-body mt-2 max-w-xl">
                {t("Depois de concluir uma entrevista você vê aqui seus erros mais comuns, o que estudar primeiro e a evolução a cada prática. Sessões em andamento ou abandonadas não entram. ")}</p>
              {onStart && (
                <div className="mt-5">
                  <button type="button" className="ds-btn ds-btn-soft" onClick={onStart}>
                    <Play className="size-4 fill-current" aria-hidden="true" /> {t("Começar primeira prática ")}</button>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <div hidden={!!selectedSession}>
            <ProgressContent insights={insights} onOpenReport={openHistoricalReport} />
          </div>
          {selectedSession && historicalReport && historicalConfig && (
            <div className="mt-8 lg:mt-10">
              <InterviewReport
                config={historicalConfig}
                elapsed={formatPracticeDuration(historicalDuration)}
                totalClock={historicalDuration === null ? "" : formatClock(Math.round(historicalDuration / 1000))}
                answerCount={selectedSession.answerCount}
                persistenceLabel={t("Relatório salvo desta prática.")}
                persistenceMessage={null}
                feedbackSyncMessage={null}
                reportState={{ status: "ready", result: historicalReport }}
                turns={[]}
                azureSummary={historicalAzureSummary}
                coverage={{ available: historicalAssessmentCount, pending: 0, total: historicalAssessmentCount }}
                onLeave={closeHistoricalReport}
                progressRecords={records}
                currentInterviewId={selectedSession.id}
                historical
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}
