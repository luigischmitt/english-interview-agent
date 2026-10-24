"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { getCurrentLocale, t } from "@/lib/locale";
import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
import { answerOrdinalForSequence, pairInterviewTurns, type InterviewReportResult } from "@/lib/interview/report";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { InterviewConfig } from "@/lib/interview/types";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { RESUME_PRACTICE_LABEL } from "@/lib/interview/resume-neutral.mjs";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { findingsForAnswer } from "@/lib/interview/report-response.mjs";
import { analysisCoverageNotice, buildReportDeltas, displayInterviewerTakeaway, displayTechnicalFindings, isCompleteSentence } from "@/lib/interview/report-presentation.mjs";
import { buildErrorRows, buildJobCoverage, buildPracticePriorities, buildVoiceNotes, formatReportDate, reportFileBase, reportSummaryText, type JobCoverageItem } from "@/lib/interview/report-document.mjs";
import { useReplayReveal } from "@/lib/use-replay-reveal";
import { LoadingMark, LoadingRegion, SkCard } from "@/components/ui/loading-state";
import { AzureVoiceReport } from "./azure-voice-report";
import "./interview-report.css";

/** Joins neighbouring changed words (and the spaces between them) so a correction reads as one mark, like the landing. */
function mergeChanged(parts: Array<{ text: string; changed: boolean }>) {
  const merged: Array<{ text: string; changed: boolean }> = [];
  parts.forEach((part, index) => {
    const bridge = !part.changed && !part.text.trim() && parts[index - 1]?.changed && parts[index + 1]?.changed;
    const changed = part.changed || Boolean(bridge);
    const last = merged.at(-1);
    if (last && last.changed === changed) last.text += part.text;
    else merged.push({ text: part.text, changed });
  });
  return merged;
}

export type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };
type Turns = ReturnType<typeof pairInterviewTurns>;
const reportLoadingSteps = [
  "Revisando a transcrição das suas respostas",
  "Analisando conteúdo técnico",
  "Analisando seu inglês",
  "Juntando os sinais da sua voz",
];
const maxVisibleErrors = 5;
const maxStrengths = 4;
const seniorityLabels: Record<string, string> = { junior: "Júnior", "mid-level": "Pleno", senior: "Sênior" };
const jobStatusLabels: Record<JobCoverageItem["status"], string> = {
  shown: "Citado nas respostas",
  partial: "Citado, com lacunas",
  missing: "Ainda não apareceu",
};

const rise = (index: number) => ({ "--i": index }) as CSSProperties;

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
              {isCompleteSentence(pattern.suggestion) && <p className="rp-hint mt-1">{pattern.suggestion}</p>}
              {isCompleteSentence(pattern.why) && <p className="rp-hint mt-1">{t("Por que acontece: ")}{pattern.why}</p>}
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

/** Antes → depois rows tick in: the row slides in, the arrow points, then the new value lands. */
function DeltaRow({ label, change, index }: { label: string; change?: string; index: number }) {
  const [from, to] = label.split(" → ");
  return (
    <p className="rp-delta ds-item" data-change={change} style={{ "--i": index + 3 } as CSSProperties}>
      {to === undefined ? label : <>{from} <span className="rp-delta-arrow" aria-hidden="true">→</span><span className="sr-only"> → </span> <span className="rp-delta-to">{to}</span></>}
    </p>
  );
}

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
    <header className="rp-section-heading ds-item">
      <h2 id={id} className="ds-h2">{t(title)}</h2>
      <p className="rp-hint mt-1">{t(description)}</p>
    </header>
  );
}

/** Everything the ready report shows, derived once from the result (shared by the paper and the appendix). */
function buildReadyModel(result: InterviewReportResult, turns: Turns, azureSummary: AzureMetricSummary, progressRecords: ProgressRecord[], currentInterviewId: string | undefined, answerCount: number) {
  const reference = (sequenceNumber: number) => answerOrdinalForSequence(turns, sequenceNumber);
  const allPatterns = turns.flatMap((turn) => findingsForAnswer(result, turn.sequenceNumber).patterns);
  const initialTakeaway = displayInterviewerTakeaway(result.interviewerTakeaway);
  const technical = displayTechnicalFindings(result.technicalContent.strengths, result.technicalContent.gaps, initialTakeaway.concern ? [{ explanation: initialTakeaway.concern }] : []);
  return {
    reference,
    summary: reportSummaryText(result),
    coverageNotice: analysisCoverageNotice(result.analysisCoverage, reference),
    strengths: technical.strengths.slice(0, maxStrengths),
    errorRows: buildErrorRows(allPatterns),
    voiceNotes: buildVoiceNotes(azureSummary),
    priorities: buildPracticePriorities(result),
    takeaway: displayInterviewerTakeaway(result.interviewerTakeaway, technical.gaps),
    deltas: buildReportDeltas(result, azureSummary, progressRecords, currentInterviewId, answerCount),
  };
}

type ReadyModel = ReturnType<typeof buildReadyModel>;

function refLabel(sequenceNumber: number | null | undefined) {
  return sequenceNumber === null || sequenceNumber === undefined ? null : `${t("Resposta ")}${sequenceNumber}`;
}

/** The document itself: the blocks that the landing's printed report shows, in the same order. */
function ReadyDocument({ model, jobItems, dateLabel }: { model: ReadyModel; jobItems: JobCoverageItem[]; dateLabel: string }) {
  const [showAllErrors, setShowAllErrors] = useState(false);
  const { reference, errorRows } = model;
  const hasVoice = model.voiceNotes.some((note) => note.value !== null);
  return (
    <>
      {(model.summary || model.coverageNotice) && (
        <section className="rp-pblock ds-item" style={rise(0)}>
          <h2 className="rp-ph">{t("Resumo da entrevista")}</h2>
          {model.summary && <p className="rp-psummary">{model.summary}</p>}
          {model.coverageNotice && <p className="rp-pnote">{t(model.coverageNotice)}</p>}
        </section>
      )}
      {model.strengths.length > 0 && (
        <section className="rp-pblock ds-item" style={rise(1)}>
          <h2 className="rp-ph">{t("O que funcionou")}</h2>
          <ul className="rp-good">
            {model.strengths.map((item, index) => <li key={index}>{item.explanation}</li>)}
          </ul>
        </section>
      )}
      {jobItems.length > 0 && (
        <section className="rp-pblock ds-item" style={rise(2)}>
          <h2 className="rp-ph">{t("Ligado à vaga")}</h2>
          <ul className="rp-job">
            {jobItems.map((item) => (
              <li key={item.competency} data-status={item.status}>
                <b>{item.competency}</b>
                <span>{t(jobStatusLabels[item.status])}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rp-pblock ds-item" style={rise(3)}>
        <h2 className="rp-ph">{t("Seus erros")}</h2>
        {errorRows.length > 0 ? (
          <>
            <div className="rp-errh" aria-hidden="true"><span>{t("Você disse")}</span><span>{t("O certo")}</span></div>
            <ul className={`rp-errs${showAllErrors ? " is-all" : ""}`}>
              {errorRows.map((row, index) => {
                const meta = [row.note, refLabel(row.sequenceNumber === undefined ? null : reference(row.sequenceNumber))].filter(Boolean).join(" · ");
                return (
                  <li key={`${row.sequenceNumber}-${index}`} className={index >= maxVisibleErrors ? "rp-extra" : undefined}>
                    <p lang="en" className="rp-said">
                      {mergeChanged(row.said).map((part, partIndex) => part.changed ? <s key={partIndex}>{part.text}</s> : <span key={partIndex}>{part.text}</span>)}
                    </p>
                    <p lang="en" className="rp-right">
                      {mergeChanged(row.right).map((part, partIndex) => part.changed ? <u key={partIndex}>{part.text}</u> : <span key={partIndex}>{part.text}</span>)}
                    </p>
                    {meta && <small>{meta}</small>}
                  </li>
                );
              })}
            </ul>
            {errorRows.length > maxVisibleErrors && (
              <button type="button" className="rp-inline-button rp-noprint" aria-expanded={showAllErrors} onClick={() => setShowAllErrors((value) => !value)}>
                {showAllErrors ? t("Ver menos") : t("Ver todos os {n} erros", { n: errorRows.length })}
              </button>
            )}
          </>
        ) : (
          <p className="rp-pnote">{t("Nenhum erro de inglês recorrente apareceu nesta entrevista.")}</p>
        )}
      </section>
      <section className="rp-pblock ds-item" style={rise(4)}>
        <h2 className="rp-ph">{t("Notas da sua voz")}</h2>
        {hasVoice ? (
          <>
            <ul className="rp-voice">
              {model.voiceNotes.map((note) => (
                <li key={note.key} style={{ "--p": `${note.value ?? 0}%` } as CSSProperties}>
                  <b>{note.value ?? "—"}</b>
                  <span>{t(note.label)}</span>
                  <small>{t(note.measure)}</small>
                </li>
              ))}
            </ul>
            <p className="rp-pnote">{t("De 0 a 100. A análise não avalia sotaque.")}</p>
          </>
        ) : (
          <p className="rp-pnote">{t("Sem sinais de voz suficientes nesta entrevista.")}</p>
        )}
      </section>
      {model.priorities.length > 0 && (
        <section className="rp-pblock ds-item" style={rise(5)}>
          <h2 className="rp-ph">{t("Prioridades para praticar")}</h2>
          <ol className="rp-prio">
            {model.priorities.map((item, index) => {
              const areaText = item.area === "english" ? t("Inglês") : t("Conteúdo técnico");
              return (
                <li key={index}>
                  <b>{item.count !== null ? t(item.title) : item.title}</b>
                  <span>
                    {item.count !== null
                      ? (item.count === 1 ? t("1 vez") : t("{n} vezes", { n: item.count }))
                      : [areaText, refLabel(item.sequenceNumber === null ? null : reference(item.sequenceNumber))].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <footer className="rp-pfoot ds-item" style={rise(6)}>
        {t("Entoa · Gerado a partir da sua entrevista simulada de {date}", { date: dateLabel })}
      </footer>
    </>
  );
}

/** Screen-only extras below the paper: perception, changes since last time, the detailed voice data and each answer. */
function ReadyAppendix({ result, model, turns, azureSummary, coverage }: { result: InterviewReportResult; model: ReadyModel; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number } }) {
  const { takeaway, deltas } = model;
  return (
    <div className="rp-appendix">
      {(takeaway.remember || takeaway.concern) && <section className="rp-section" aria-labelledby="perceived-title" data-reveal="group">
        <SectionHeading id="perceived-title" title="Como você foi percebido" description="O que pode ficar na memória depois da conversa." />
        <div className="rp-perception-grid ds-stagger">
          {takeaway.remember && <article className="ds-card rp-card rp-perception ds-item" data-tone="remember"><h3 className="ds-label">{t("O que o entrevistador vai lembrar")}</h3><p>{takeaway.remember}</p></article>}
          {takeaway.concern && <article className="ds-card rp-card rp-perception ds-item" data-tone="concern"><h3 className="ds-label">{t("O que pode pesar contra")}</h3><p>{takeaway.concern}</p></article>}
        </div>
      </section>}
      {deltas.length > 0 && <section className="rp-deltas" data-reveal="group" aria-label={t("Desde a última entrevista")}><h3 className="rp-subtitle">{t("Desde a última entrevista")}</h3>{deltas.map((delta, index) => <DeltaRow key={delta.label} label={t(delta.label)} change={delta.change} index={index} />)}</section>}
      <section className="rp-section" data-reveal="group">
        <div className="rp-voice-compact">
          <AzureVoiceReport summary={azureSummary} coverage={coverage} title={t("Ritmo da fala")} />
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

/** Opens the browser's print dialog on the paper only; the file name becomes the suggested PDF name. */
function exportPdf(fileBase: string) {
  const root = document.documentElement;
  const previousTitle = document.title;
  const restore = () => {
    document.title = previousTitle;
    root.classList.remove("rp-printing");
  };
  document.title = fileBase;
  root.classList.add("rp-printing");
  window.addEventListener("afterprint", restore, { once: true });
  window.print();
}

export function InterviewReport({ config, elapsed, totalClock, answerCount, persistenceMessage, feedbackSyncMessage, reportState, turns, azureSummary, coverage, onLeave, progressRecords, currentInterviewId, historical = false, onRetry, retrying = false }: {
  config: InterviewConfig; elapsed: string; totalClock: string; answerCount: number; persistenceLabel: string; persistenceMessage: string | null; feedbackSyncMessage: string | null; reportState: ReportState; progressRecords: ProgressRecord[]; currentInterviewId?: string; historical?: boolean; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; onLeave: () => void; onRetry?: () => void; retrying?: boolean;
}): ReactNode {
  const [loadedTurns, setLoadedTurns] = useState<Turns>(turns);
  const [loadingTurns, setLoadingTurns] = useState(historical && turns.length === 0 && Boolean(currentInterviewId));
  const [loadingStep, setLoadingStep] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  // Sections and their cards rise in once, the first time they are on screen (and again only for genuinely new content).
  useReplayReveal(rootRef, [reportState.status, loadingTurns, loadedTurns.length], { once: true });
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
  const isResume = config.interviewSource === "resume";
  const role = isResume ? t(RESUME_PRACTICE_LABEL) : config.role;
  // The document date is the record's own date when this interview is in progress history, otherwise today. Computed once per record set.
  const reportDate = useMemo(() => {
    const record = currentInterviewId ? progressRecords.find((item) => item.id === currentInterviewId) : undefined;
    const value = record?.completedAt ?? record?.startedAt ?? record?.createdAt;
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  }, [progressRecords, currentInterviewId]);
  const fileBase = useMemo(() => reportFileBase(role, reportDate), [role, reportDate]);
  const dateLabel = formatReportDate(reportDate, getCurrentLocale() === "en" ? "en" : "pt-BR");
  const seniorityLabel = config.seniority === "staff" ? "Staff / Lead" : seniorityLabels[config.seniority] ? t(seniorityLabels[config.seniority]) : null;
  const focusLabel = config.focus === "technical-depth" ? t("Profundidade técnica")
    : config.focus === "communication" ? t("Comunicação e clareza")
      : config.focus === "behavioral" ? t("Respostas comportamentais")
        : t("Prática equilibrada");
  const duration = historical ? elapsed : `${elapsed} / ${totalClock}`;
  const readyModel = useMemo(
    () => reportState.result ? buildReadyModel(reportState.result, loadedTurns, azureSummary, progressRecords, currentInterviewId, answerCount) : null,
    [reportState.result, loadedTurns, azureSummary, progressRecords, currentInterviewId, answerCount],
  );
  const jobItems = useMemo(
    () => !isResume && reportDirection?.priorityCompetencies?.length && reportState.result
      ? buildJobCoverage(reportDirection.priorityCompetencies, reportState.result.technicalContent.strengths, reportState.result.technicalContent.gaps)
      : [],
    [isResume, reportDirection, reportState.result],
  );
  const readyResult = reportState.status === "ready" ? reportState.result : undefined;
  const ready = readyResult && readyModel ? { result: readyResult, model: readyModel } : null;
  return (
    <section ref={rootRef} className="rp-root mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
      {historical && <button type="button" className="ds-btn ds-btn-quiet mb-3" onClick={onLeave}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {getCurrentLocale() === "en" ? "Back to Progress" : t("Voltar ao Progresso")}
        </button>}
      <div className="rp-docbar">
        <span className="rp-file">{fileBase}.pdf</span>
        <button type="button" className="rp-pdf" disabled={reportState.status !== "ready"} onClick={() => exportPdf(fileBase)}>
          <Download width={14} height={14} aria-hidden="true" />
          {t("Exportar PDF")}
        </button>
      </div>
      {persistenceMessage && (
        <div role="status" className="rp-alert mt-5">{t(persistenceMessage)}</div>
      )}
      {feedbackSyncMessage && (
        <div role="status" className="rp-alert mt-4">{t(feedbackSyncMessage)}</div>
      )}
      {loadingTurns && (
        <LoadingRegion label={t("Carregando perguntas e respostas…")} className="mt-4 mb-4 ld-fade">
          <SkCard minHeight="9rem" i={1} lines={3} />
          <SkCard minHeight="9rem" i={3} lines={3} />
        </LoadingRegion>
      )}
      <article className="rp-paper" data-reveal="group" aria-busy={reportState.status === "pending" || loadingTurns}>
        <header className="rp-ptop">
          <div className="rp-brand"><Image src="/landing/tucano-mark.webp" width={18} height={21} alt="" unoptimized /><span>Entoa</span></div>
          <span>{t("Relatório de entrevista")} · {dateLabel}</span>
        </header>
        <div className="rp-cover">
          <h1 id="interview-complete-title" className="rp-ptitle">{role}{seniorityLabel && !isResume ? ` · ${seniorityLabel}` : ""}</h1>
          <dl className="rp-pfacts">
            <div><dt>{t("Foco")}</dt><dd>{focusLabel}</dd></div>
            <div><dt>{t("Duração")}</dt><dd className="tabular-nums">{duration}</dd></div>
            <div><dt>{t("Respostas")}</dt><dd>{answerCount}</dd></div>
          </dl>
        </div>
        {reportState.status === "pending" ? (
          <div className="rp-pending-wrap ld-fade">
            <div className="ds-card rp-card rp-pending" role="status" aria-live="polite">
              <p className="rp-loading-step"><LoadingMark /><span key={loadingStep}>{t(reportLoadingSteps[loadingStep])}…</span></p>
              <p className="rp-hint mt-2">{t("Você pode sair. O relatório continua sendo preparado; volte ao Progresso para ver o resultado.")}</p>
              {onRetry && <button type="button" className="btn ds-btn ds-btn-soft mt-4" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
                {retrying && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}
                {t(retrying ? "Gerando relatório…" : "Tentar gerar novamente")}
              </button>}
            </div>
            <div className="ld-grid-3" aria-hidden="true">
              <SkCard minHeight="8rem" i={1} lines={2} />
              <SkCard minHeight="8rem" i={3} lines={2} />
              <SkCard minHeight="8rem" i={5} lines={2} />
            </div>
            <SkCard minHeight="11rem" i={6} lines={4} />
          </div>
        ) : reportState.status === "unavailable" ? (
          <div className="rp-stack">
            <div role="status" className="rp-alert">
              <h2 className="ds-label">
                {t(loadedTurns.length ? (reportState.message ?? "O relatório continua indisponível. Tente novamente em instantes.") : "Não há respostas para analisar.")}
              </h2>
              {loadedTurns.length > 0 && <p className="mt-1 text-sm leading-6">{t("Os sinais vocais disponíveis continuam abaixo.")}</p>}
              {loadedTurns.length > 0 && onRetry && (
                <button type="button" className="btn ds-btn ds-btn-soft mt-4" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
                  {retrying && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}
                  {t(retrying ? "Gerando relatório…" : "Tentar gerar novamente")}
                </button>
              )}
            </div>
            {loadedTurns.length > 0 && <CapturedAnswers turns={loadedTurns} />}
            <AzureVoiceReport summary={azureSummary} coverage={coverage} />
          </div>
        ) : ready ? (
          <ReadyDocument model={ready.model} jobItems={jobItems} dateLabel={dateLabel} />
        ) : null}
      </article>
      {ready && <ReadyAppendix result={ready.result} model={ready.model} turns={loadedTurns} azureSummary={azureSummary} coverage={coverage} />}
      <div className="rp-foot">
        <button type="button" className={`ds-btn ${reportState.status === "pending" ? "ds-btn-quiet" : "ds-btn-cta-green"} rp-back`} onClick={onLeave}>{t(historical ? "Voltar ao Progresso " : "Voltar ao dashboard ")}
          <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
