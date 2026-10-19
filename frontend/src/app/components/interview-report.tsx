"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentLocale, t } from "@/lib/locale";
import { ArrowLeft, ArrowUpRight, ArrowRight } from "lucide-react";
import { answerOrdinalForSequence, pairInterviewTurns, type InterviewReportResult } from "@/lib/interview/report";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { InterviewConfig } from "@/lib/interview/types";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { RESUME_PRACTICE_LABEL } from "@/lib/interview/resume-neutral.mjs";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { findingsForAnswer } from "@/lib/interview/report-response.mjs";
import { deriveOverviewTiles, groupPatternsByType } from "@/lib/interview/report-overview.mjs";
import { buildReportDeltas, diffReportWords } from "@/lib/interview/report-presentation.mjs";
import { AzureVoiceReport } from "./azure-voice-report";
import "./interview-report.css";

export type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };
type Turns = ReturnType<typeof pairInterviewTurns>;
const reportLoadingSteps = [
  "Revisando a transcrição das suas respostas",
  "Analisando conteúdo técnico",
  "Analisando seu inglês",
  "Juntando os sinais da sua voz",
];

function AnswerCard({ turn, result, ordinal }: { turn: Turns[number]; result: InterviewReportResult; ordinal: number }) {
  const [expanded, setExpanded] = useState(false);
  const findings = findingsForAnswer(result, turn.sequenceNumber);
  return (
    <article className="ds-card rp-card rp-answer" aria-labelledby={`answer-${turn.sequenceNumber}`}>
      <p className="rp-answer-question" lang="en">{turn.question}</p>
      <h3 id={`answer-${turn.sequenceNumber}`} className="ds-label">{t("Resposta ")}{ordinal}</h3>
      <p lang="en" className={`rp-answer-text${expanded ? " is-expanded" : ""}`}>{turn.answer}</p>
      {turn.answer.length > 90 && (
        <button type="button" className="rp-inline-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t(expanded ? "Recolher resposta" : "Ver resposta completa")}
        </button>
      )}
      {(findings.strengths.length > 0 || findings.gaps.length > 0) && (
        <div className="rp-answer-columns">
          {findings.strengths.length > 0 && (
            <section>
              <h4 className="rp-subtitle">{t("O que funcionou")}</h4>
              {findings.strengths.map((item, index) => (
                <p key={index} className="rp-answer-finding">{item.explanation}</p>
              ))}
            </section>
          )}
          {findings.gaps.length > 0 && (
            <section>
              <h4 className="rp-subtitle">{t("O que faltou")}</h4>
              {findings.gaps.map((item, index) => (
                <p key={index} className="rp-answer-finding">{item.explanation}</p>
              ))}
            </section>
          )}
        </div>
      )}
      {findings.patterns.length > 0 && (
        <section className="rp-answer-english">
          <h4 className="rp-subtitle">{t("Inglês")}</h4>
          {findings.patterns.map((pattern, index) => (
            <div className="rp-pattern" key={`${pattern.type}-${index}`}>
              <p lang="en" className="rp-quote">{t("Você disse: “")}{pattern.evidence}{t("”")}</p>
              <p className="rp-rephrase-text" lang="en">{t("Mais natural: “")}{pattern.rephrasedExample}{t("”")}</p>
              <p className="rp-hint mt-1">{pattern.suggestion}</p>
              {pattern.why && <p className="rp-hint mt-1">{t("Por que acontece: ")}{pattern.why}</p>}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

function CapturedAnswers({ turns }: { turns: Turns }) {
  return <details className="rp-more"><summary>{t("Transcrição completa")}</summary><ol className="rp-transcript">{turns.map((turn, index) => <li key={`${turn.sequenceNumber}-${index}`}><p lang="en"><span className="font-semibold">{t("Pergunta:")}</span> {turn.question}</p><p lang="en" className="mt-2"><span className="font-semibold">{t("Sua resposta:")}</span> {turn.answer}</p></li>)}</ol></details>;
}

const patternTypeLabels: Record<string, string> = {
  GRAMMAR: "Gramática",
  WORD_CHOICE: "Escolha de palavras",
  FALSE_COGNATE: "Falso cognato",
  STRUCTURE: "Estrutura",
};

function SectionHeading({
  title,
  description,
  id,
}: {
  title: string;
  description: string;
  id: string;
}) {
  return (
    <header className="rp-section-heading">
      <h2 id={id} className="ds-h2">{t(title)}</h2>
      <p className="rp-hint mt-1">{t(description)}</p>
    </header>
  );
}

function ReadyReport({
  result,
  turns,
  azureSummary,
  coverage,
  progressRecords,
  currentInterviewId,
  answerCount,
}: {
  result: InterviewReportResult;
  turns: Turns;
  azureSummary: AzureMetricSummary;
  coverage: { available: number; pending: number; total: number };
  progressRecords: ProgressRecord[];
  currentInterviewId?: string;
  answerCount: number;
}) {
  const answers = azureSummary.answers ?? [];
  const tiles = deriveOverviewTiles(result, answers);
  const patterns = groupPatternsByType(turns.flatMap((turn) => findingsForAnswer(result, turn.sequenceNumber).patterns));
  const [showAllPatterns, setShowAllPatterns] = useState(false);
  const reference = (sequenceNumber: number) => answerOrdinalForSequence(turns, sequenceNumber);
  const allPatterns = patterns.flatMap((group) => group.items);
  const visiblePatterns = showAllPatterns ? allPatterns : allPatterns.slice(0, 4);
  const patternCount = allPatterns.length;
  const deltas = buildReportDeltas(result, azureSummary, progressRecords, currentInterviewId, answerCount);

  return (
    <div className="rp-stack rp-ready">
      {(result.interviewerTakeaway?.remember?.trim() || result.interviewerTakeaway?.concern?.trim()) && <section className="rp-section" aria-labelledby="perceived-title">
        <SectionHeading id="perceived-title" title="Como você foi percebido" description="O que pode ficar na memória depois da conversa." />
        <div className="rp-perception-grid">
          {result.interviewerTakeaway?.remember?.trim() && <article className="ds-card rp-card rp-perception" data-tone="remember"><h3 className="ds-label">{t("O que o entrevistador vai lembrar")}</h3><p>{result.interviewerTakeaway.remember}</p></article>}
          {result.interviewerTakeaway?.concern?.trim() && <article className="ds-card rp-card rp-perception" data-tone="concern"><h3 className="ds-label">{t("O que pode pesar contra")}</h3><p>{result.interviewerTakeaway.concern}</p></article>}
        </div>
      </section>}
      <section className="rp-section" aria-labelledby="overview-title">
        <SectionHeading
          id="overview-title"
          title="Visão geral"
          description="Um panorama do conteúdo, do inglês e da sua voz nesta entrevista."
        />
        <div className="ds-card rp-card">
          {result.technicalContent.summary?.trim() && (
            <p className="rp-summary">{result.technicalContent.summary}</p>
          )}
          <div className="rp-overview-grid">
            {tiles.map((tile) => (
              <article className="rp-overview-tile" key={tile.id}>
                <h3 className="ds-label">{t(tile.title)}</h3>
                <p>{tile.text ? t(tile.text) : t("Sem sinais suficientes nesta entrevista.")}</p>
                <a href={`#${tile.id}-section`}>{t("Ver seção")}</a>
              </article>
            ))}
          </div>
        </div>
        {deltas.length > 0 && <section className="rp-deltas" aria-label={t("Desde a última entrevista")}><h3 className="rp-subtitle">{t("Desde a última entrevista")}</h3>{deltas.map((delta) => <p key={delta.label} data-change={delta.change}><ArrowRight className="size-4" aria-hidden="true" /><span>{t(delta.label)} ({delta.before} → {delta.after})</span></p>)}</section>}
      </section>
      <section className="rp-section" id="english-section" aria-labelledby="english-title">
        <SectionHeading
          id="english-title"
          title="Seu inglês"
          description="Padrões que apareceram nas respostas, agrupados por tipo."
        />
        <div className="rp-pattern-list">
          {visiblePatterns.map((pattern, index) => (
            <article
              className="ds-card rp-card rp-pattern-card"
              key={`${pattern.type}-${pattern.sequenceNumber}-${index}`}
            >
              <span className="rp-pattern-eyebrow" data-type={pattern.type}>
                {t(patternTypeLabels[pattern.type] ?? pattern.type)}
              </span>
              <p lang="en">
                <span className="rp-quiet-label">{t("Você disse")}</span>
                <br />
                {diffReportWords(pattern.evidence ?? "", pattern.rephrasedExample ?? "").original.map((part, partIndex) => part.changed ? <del className="rp-diff-old" key={partIndex}>{part.text}</del> : <span key={partIndex}>{part.text}</span>)}
              </p>
              <p lang="en" className="rp-rephrase-text">
                <span className="rp-quiet-label">{t("Mais natural")}</span>
                <br />
                {diffReportWords(pattern.evidence ?? "", pattern.rephrasedExample ?? "").revised.map((part, partIndex) => part.changed ? <mark className="rp-diff-new" key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>)}
              </p>
              <p className="rp-hint mt-2">{pattern.suggestion}</p>
              {pattern.why && (
                <p className="rp-hint mt-1">{t("Por que acontece: ")}{pattern.why}</p>
              )}
              <p className="rp-phrase-ref">{t("Resposta ")}{reference(pattern.sequenceNumber)}</p>
            </article>
          ))}
        </div>
        {patternCount > 4 && (
          <button
            type="button"
            className="rp-inline-button"
            aria-expanded={showAllPatterns}
            onClick={() => setShowAllPatterns((value) => !value)}
          >
            {t(showAllPatterns ? "Ver menos" : "Ver todos")}
          </button>
        )}
      </section>
      <section className="rp-section" id="technical-section" aria-labelledby="technical-title">
        <SectionHeading
          id="technical-title"
          title="Conteúdo técnico"
          description="O que suas respostas demonstraram e o que poderia ficar mais explícito."
        />
        <div className="ds-card rp-card rp-cols">
          <section>
            <h3 className="rp-subtitle">{t("O que funcionou")}</h3>
            {result.technicalContent.strengths.map((item, index) => (
              <p className="rp-answer-finding" key={index}>
                {item.explanation} <span className="rp-phrase-ref">{t("Resposta ")}{reference(item.sequenceNumber)}</span>
              </p>
            ))}
          </section>
          <section>
            <h3 className="rp-subtitle">{t("O que faltou")}</h3>
            {result.technicalContent.gaps.map((item, index) => (
              <p className="rp-answer-finding" key={index}>
                {item.explanation} <span className="rp-phrase-ref">{t("Resposta ")}{reference(item.sequenceNumber)}</span>
              </p>
            ))}
          </section>
        </div>
      </section>
      <section className="rp-section">
        <SectionHeading
          id="priorities-title"
          title="O que mais pesa"
          description="Até três pontos que mais influenciam a clareza das respostas."
        />
        <div className="ds-card rp-card">
          {result.priorities.slice(0, 3).map((item, index) => (
            <article className="rp-priority-item" data-area={item.area} key={index}><span className="rp-priority-number" aria-hidden="true">{index + 1}</span><div><span className="rp-priority-area">{t(item.area === "TECHNICAL_CONTENT" ? "Técnico" : "Inglês")}</span><strong>{item.focus}</strong>{item.evidence?.trim() && <span lang="en" className="rp-priority-evidence">“{item.evidence}”</span>}<span className="rp-phrase-ref">{t("Resposta ")}{reference(item.sequenceNumber)}</span></div></article>
          ))}
        </div>
      </section>
      <section className="rp-section" id="voice-section">
        <SectionHeading
          id="voice-title"
          title="Ritmo e voz"
          description="Sinais de entrega vocal e uma estimativa experimental da pronúncia."
        />
        <div className="rp-voice-compact">
          <AzureVoiceReport summary={azureSummary} coverage={coverage} title={t("Sinais vocais")} />
        </div>
      </section>
      <details className="rp-more rp-response-details">
        <summary>{t("Resposta por resposta")}</summary>
        <p className="rp-hint mt-2">{t("Perguntas, transcrições e observações de cada resposta.")}</p>
        {turns.length ? (
          <div className="rp-stack mt-4">
            {turns.map((turn, index) => (
              <AnswerCard
                key={turn.sequenceNumber}
                turn={turn}
                ordinal={answerOrdinalForSequence(turns, turn.sequenceNumber) ?? index + 1}
                result={result}
              />
            ))}
          </div>
        ) : (
          <p className="ds-body mt-3">{t("As perguntas e respostas desta entrevista não estão disponíveis.")}</p>
        )}
      </details>
    </div>
  );
}

export function InterviewReport({ config, elapsed, totalClock, answerCount, persistenceLabel, persistenceMessage, feedbackSyncMessage, reportState, turns, azureSummary, coverage, onLeave, progressRecords, currentInterviewId, historical = false }: {
  config: InterviewConfig; elapsed: string; totalClock: string; answerCount: number; persistenceLabel: string; persistenceMessage: string | null; feedbackSyncMessage: string | null; reportState: ReportState; progressRecords: ProgressRecord[]; currentInterviewId?: string; historical?: boolean; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; onLeave: () => void;
}): ReactNode {
  const [loadedTurns, setLoadedTurns] = useState<Turns>(turns);
  const [loadingTurns, setLoadingTurns] = useState(historical && turns.length === 0 && Boolean(currentInterviewId));
  const [loadingStep, setLoadingStep] = useState(0);
  useEffect(() => {
    if (reportState.status !== "pending") return;
    const interval = window.setInterval(() => setLoadingStep((step) => (step + 1) % reportLoadingSteps.length), 3_500);
    return () => window.clearInterval(interval);
  }, [reportState.status]);
  useEffect(() => {
    if (!historical || turns.length || !currentInterviewId) return;
    let active = true;
    void getSupabaseBrowserClient().from("interview_turns").select("sequence_number,speaker,content").eq("interview_id", currentInterviewId).order("sequence_number", { ascending: true }).then(({ data, error }) => {
      if (!active) return;
      if (!error && data) setLoadedTurns(pairInterviewTurns(data.map((item) => ({ sequenceNumber: item.sequence_number, speaker: item.speaker, content: item.content }))));
      setLoadingTurns(false);
    });
    return () => { active = false; };
  }, [historical, turns, currentInterviewId]);
  const reportDirection = reportState.result?.jobDirection ?? config.jobDirection;
  const headingFacts = useMemo(() => config.interviewSource === "resume" ? RESUME_PRACTICE_LABEL : config.role, [config.interviewSource, config.role]);
  return (
    <section className="rp-root mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
      {historical && <button type="button" className="ds-btn ds-btn-quiet mb-3" onClick={onLeave}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {getCurrentLocale() === "en" ? "Back to Progress" : t("Voltar ao Progresso")}
        </button>}
      <header className="rp-hero ds-enter">
        <h1 id="interview-complete-title" className="font-display text-balance rp-title">
          {t("Seu relatório de entrevista")}
        </h1>
        <p className="ds-body mt-3 max-w-[60ch]">
          {t(persistenceLabel)}. {t("Suas respostas foram transcritas.")}
        </p>
        <dl className="rp-facts">
          <div>
            <dt>{t(config.interviewSource === "resume" ? "Modo" : "Cargo")}</dt>
            <dd>{config.interviewSource === "resume" ? t(headingFacts) : headingFacts}</dd>
          </div>
          <div>
            <dt>{t(historical ? "Tempo registrado" : "Tempo")}</dt>
            <dd className="tabular-nums">
              {historical ? elapsed : <>{elapsed} {t("/ ")}{totalClock}</>}
            </dd>
          </div>
          <div>
            <dt>{t("Respostas")}</dt>
            <dd>{answerCount}</dd>
          </div>
        </dl>
        {reportDirection && config.interviewSource !== "resume" && (
          <p className="rp-hint mt-3">{t("Direção da vaga: ")}{reportDirection.mainInterviewEmphasis}</p>
        )}
      </header>
      {persistenceMessage && (
        <div role="status" className="rp-alert mt-5">{t(persistenceMessage)}</div>
      )}
      {feedbackSyncMessage && (
        <div role="status" className="rp-alert mt-4">{t(feedbackSyncMessage)}</div>
      )}
      <div className="mt-6" aria-busy={reportState.status === "pending" || loadingTurns}>
        {loadingTurns && (
          <p className="rp-hint mb-4" role="status">{t("Carregando perguntas e respostas…")}</p>
        )}
        {reportState.status === "pending" ? (
          <div className="ds-card rp-card rp-pending" role="status">
            <div className="rp-bar" aria-hidden="true" />
            <p className="rp-loading-step mt-3" key={loadingStep}>{t(reportLoadingSteps[loadingStep])}</p>
            <p className="rp-hint mt-2">{t("Leva cerca de 30 segundos. Mantenha esta página aberta enquanto montamos o relatório.")}</p>
          </div>
        ) : reportState.status === "unavailable" ? (
          <div className="rp-stack">
            <div role="status" className="rp-alert">
              <h2 className="ds-label">
                {t(loadedTurns.length ? "Não foi possível montar o relatório detalhado." : "Não há respostas para analisar.")}
              </h2>
              <p className="mt-1 text-sm leading-6">
                {t(reportState.message ?? "")} {t("Os sinais vocais disponíveis continuam abaixo.")}
              </p>
            </div>
            {loadedTurns.length > 0 && <CapturedAnswers turns={loadedTurns} />}
            <AzureVoiceReport summary={azureSummary} coverage={coverage} />
          </div>
        ) : reportState.status === "ready" && reportState.result ? (
          <ReadyReport
            result={reportState.result}
            turns={loadedTurns}
            azureSummary={azureSummary}
            coverage={coverage}
            progressRecords={progressRecords}
            currentInterviewId={currentInterviewId}
            answerCount={answerCount}
          />
        ) : null}
      </div>
      <div className="rp-foot">
        <button type="button" className={`ds-btn ${reportState.status === "pending" ? "ds-btn-quiet" : "ds-btn-cta-green"} rp-back`} onClick={onLeave}>{t(historical ? "Voltar ao Progresso " : "Voltar ao dashboard ")}
          <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
