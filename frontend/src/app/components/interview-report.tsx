import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, Dumbbell, Quote } from "lucide-react";
import { answerOrdinalForSequence, type InterviewReportResult, type pairInterviewTurns } from "@/lib/interview/report";
import { emptyEnglishEvidenceMessage, emptyReportEvidenceMessage, partialEvidenceReviewNote } from "@/lib/interview/report-evidence-copy.mjs";
import { clarityHelp, englishPatternsHelp, technicalContentHelp } from "@/lib/interview/report-metric-copy.mjs";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { InterviewConfig } from "@/lib/interview/types";
import { deriveMainPoints, toSecondPerson } from "@/lib/interview/report-main-points.mjs";
import { AzureVoiceReport } from "./azure-voice-report";
import "./interview-report.css";

export type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };
type Turns = ReturnType<typeof pairInterviewTurns>;
type EvidenceCounts = NonNullable<InterviewReportResult["evidenceReview"]>["englishPatterns"];

const enter = (index: number) => ({ "--i": index }) as CSSProperties;

function clarityLabel(value: InterviewReportResult["englishCommunication"]["clarity"]) {
  return value === "CLEAR" ? "Clara" : value === "MOSTLY_CLEAR" ? "Na maior parte clara" : "Precisa de mais clareza";
}

function patternLabel(value: InterviewReportResult["englishCommunication"]["patterns"][number]["type"]) {
  const labels: Record<typeof value, string> = { GRAMMAR: "Gramática", WORD_CHOICE: "Escolha de palavras", FALSE_COGNATE: "Falso cognato", STRUCTURE: "Estrutura da resposta" };
  return labels[value];
}

function EvidenceCountNote({ counts }: { counts: EvidenceCounts | undefined }) {
  const note = partialEvidenceReviewNote(counts);
  return note ? <p className="rp-hint mt-3">{note}</p> : null;
}

function CapturedAnswers({ turns }: { turns: Turns }) {
  return (
    <section className="ds-card rp-card" aria-labelledby="captured-answers-title">
      <h2 id="captured-answers-title" className="ds-h2">Respostas registradas</h2>
      {turns.length ? (
        <ol className="rp-list mt-4">
          {turns.map((turn, index) => (
            <li key={`${turn.sequenceNumber}-${index}`} className="rp-item">
              <p className="ds-label">Pergunta {answerOrdinalForSequence(turns, turn.sequenceNumber) ?? index + 1}</p>
              <p lang="en" className="mt-2 text-sm leading-6"><span className="font-semibold">Pergunta:</span> {turn.question}</p>
              <p lang="en" className="mt-2 text-sm leading-6"><span className="font-semibold">Sua resposta:</span> {turn.answer}</p>
            </li>
          ))}
        </ol>
      ) : <p className="ds-body mt-2">Nenhuma resposta foi enviada nesta sessão. Sem respostas, não há evidência para uma análise detalhada.</p>}
    </section>
  );
}

function AreaHeader({ step, id, title, help }: { step: number; id: string; title: string; help: string }) {
  return (
    <header>
      <div className="flex items-center gap-3">
        <span className="ds-step" aria-hidden="true">{step}</span>
        <h2 id={id} className="ds-h2">{title}</h2>
      </div>
      <p className="rp-hint mt-2">{help}</p>
    </header>
  );
}

function EvidenceList({ items, turns, empty, counts, tone }: { items: { sequenceNumber: number; evidence: string; explanation: string }[]; turns: Turns; empty: string; counts: EvidenceCounts | undefined; tone: "good" | "gap" }) {
  return (
    <div>
      {items.length ? (
        <ul className="rp-list">
          {items.map((item, index) => (
            <li key={`${item.sequenceNumber}-${index}`} className="rp-item" data-tone={tone}>
              <p className="rp-quote">Resposta {answerOrdinalForSequence(turns, item.sequenceNumber) ?? "—"}: “{item.evidence}”</p>
              <p className="mt-1 text-sm leading-6">{item.explanation}</p>
            </li>
          ))}
        </ul>
      ) : <p className="ds-body">{empty}</p>}
      <EvidenceCountNote counts={counts} />
    </div>
  );
}

function MainPoints({ main, result, turns }: { main: ReturnType<typeof deriveMainPoints>; result: InterviewReportResult; turns: Turns }) {
  return (
    <section className="ds-card rp-card" aria-labelledby="main-points-title">
      <h2 id="main-points-title" className="ds-h2">Pontos principais</h2>
      <div className="rp-cols">
        <div>
          <h3 className="rp-subtitle">Inglês</h3>
          {main.english.length ? (
            <ul className="rp-list">
              {main.english.map((pattern, index) => (
                <li key={`${pattern.sequenceNumber}-${pattern.type}-${index}`} className="rp-item">
                  <p className="ds-label"><span className="rp-tag">{patternLabel(pattern.type)}</span> <span className="rp-where">resposta {answerOrdinalForSequence(turns, pattern.sequenceNumber) ?? "—"}</span></p>
                  <p lang="en" className="rp-fix mt-2"><span className="rp-fix-from">“{pattern.evidence}”</span><span aria-hidden="true" className="rp-fix-arrow"> → </span><span className="sr-only"> corrigido para </span><span className="rp-fix-to">“{pattern.rephrasedExample}”</span></p>
                  <p className="rp-hint mt-2">{pattern.suggestion}</p>
                </li>
              ))}
            </ul>
          ) : <p className="ds-body">{emptyEnglishEvidenceMessage(result.englishCommunication.evidenceStatus, result.evidenceReview?.englishPatterns)}</p>}
        </div>
        <div>
          <h3 className="rp-subtitle">Técnico</h3>
          {main.technical.length ? (
            <ul className="rp-list">
              {main.technical.map((item, index) => (
                <li key={`${item.sequenceNumber}-${item.kind}-${index}`} className="rp-item" data-tone={item.kind === "gap" ? "gap" : "good"}>
                  <p className="ds-label"><span className="rp-tag" data-tone={item.kind}>{item.kind === "gap" ? "Para reforçar" : "Ponto forte"}</span> <span className="rp-where">resposta {answerOrdinalForSequence(turns, item.sequenceNumber) ?? "—"}</span></p>
                  <p className="rp-quote mt-2">“{item.evidence}”</p>
                  <p className="mt-1 text-sm leading-6">{item.explanation}</p>
                  {item.vacancyCompetency && <p className="rp-hint mt-2">Prioridade da vaga avaliada nesta resposta: {item.vacancyCompetency}.</p>}
                </li>
              ))}
            </ul>
          ) : <p className="ds-body">Nenhum ponto técnico relevante foi apontado com segurança nesta sessão.</p>}
        </div>
      </div>
    </section>
  );
}

function ReadyReport({ result, turns, azureSummary, coverage }: { result: InterviewReportResult; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number } }) {
  const main = deriveMainPoints(result);
  return (
    <div className="rp-stack">
      <section className="ds-card rp-card ds-enter" style={enter(0)} aria-labelledby="summary-title">
        <h2 id="summary-title" className="ds-h2">Resumo</h2>
        <p className="rp-summary">{main.summary}</p>
        <p className="rp-hint mt-2">Clareza geral em inglês: <span className="rp-clarity-value">{clarityLabel(result.englishCommunication.clarity)}</span></p>
      </section>

      <div className="ds-enter" style={enter(1)}>
        <AzureVoiceReport summary={azureSummary} coverage={coverage} title="Pontuação da fala" />
      </div>

      <div className="rp-leaf" aria-hidden="true"><span /></div>

      <div className="ds-enter" style={enter(2)}>
        <MainPoints main={main} result={result} turns={turns} />
      </div>

      <div className="rp-leaf" aria-hidden="true"><span /></div>

      <section className="rp-priorities ds-mata ds-enter" style={enter(3)} aria-labelledby="priorities-title">
        <p className="rp-eyebrow">Próximos passos</p>
        <h2 id="priorities-title" className="rp-priorities-title">Prioridades para praticar</h2>
        {main.priorities.length ? (
          <ol className="rp-priority-list">
            {main.priorities.map((priority, index) => (
              <li key={`${priority.sequenceNumber}-${index}`} className="rp-priority">
                <span className="rp-priority-num" aria-hidden="true">{index + 1}</span>
                <div className="min-w-0">
                  <p className="rp-priority-focus">{priority.focus}</p>
                  <p className="rp-priority-evidence">Baseado na resposta {answerOrdinalForSequence(turns, priority.sequenceNumber) ?? "—"}: “{priority.evidence}”</p>
                  {priority.vacancyCompetency && <p className="rp-hint mt-1">Prioridade da vaga: {priority.vacancyCompetency}</p>}
                  <p className="rp-exercise"><Dumbbell className="size-4 shrink-0" aria-hidden="true" /><span><span className="font-semibold">Exercício:</span> {priority.exercise}</span></p>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="rp-priority-empty">{emptyReportEvidenceMessage(result.evidenceReview?.priorities)}</p>}
      </section>

      <details className="rp-more ds-enter" style={enter(4)}>
        <summary>Ver análise completa</summary>
        <div className="rp-stack mt-4">
          <section className="ds-card rp-card" aria-labelledby="technical-report-title">
            <AreaHeader step={1} id="technical-report-title" title="Conteúdo técnico" help={technicalContentHelp} />
            <div className="rp-cols">
              <div>
                <h3 className="rp-subtitle">O que correspondeu à pergunta</h3>
                <EvidenceList items={result.technicalContent.strengths} turns={turns} tone="good" empty={emptyReportEvidenceMessage(result.evidenceReview?.technicalStrengths)} counts={result.evidenceReview?.technicalStrengths} />
              </div>
              <div>
                <h3 className="rp-subtitle">O que precisava de mais explicação</h3>
                <EvidenceList items={result.technicalContent.gaps} turns={turns} tone="gap" empty={emptyReportEvidenceMessage(result.evidenceReview?.technicalGaps)} counts={result.evidenceReview?.technicalGaps} />
              </div>
            </div>
          </section>

          <section className="ds-card rp-card" aria-labelledby="english-report-title">
            <AreaHeader step={2} id="english-report-title" title="Comunicação em inglês" help={englishPatternsHelp} />
            <div className="rp-clarity">
              <p className="ds-label">Clareza geral: <span className="rp-clarity-value">{clarityLabel(result.englishCommunication.clarity)}</span></p>
              <p className="rp-hint mt-1">{clarityHelp}</p>
            </div>
            {result.englishCommunication.patterns.length ? (
              <ul className="rp-list mt-5">
                {result.englishCommunication.patterns.map((pattern, index) => (
                  <li key={`${pattern.sequenceNumber}-${pattern.type}-${index}`} className="rp-item">
                    <p className="ds-label"><span className="rp-tag">{patternLabel(pattern.type)}</span> <span className="rp-where">resposta {answerOrdinalForSequence(turns, pattern.sequenceNumber) ?? "—"}</span></p>
                    <p className="rp-quote mt-2">Trecho: “{pattern.evidence}”</p>
                    <p className="mt-1 text-sm leading-6">Sugestão: {toSecondPerson(pattern.suggestion)}</p>
                    <p className="rp-rephrase">
                      <Quote className="size-4 shrink-0" aria-hidden="true" />
                      <span><span className="rp-rephrase-label">Exemplo</span> <span lang="en" className="rp-rephrase-text">“{pattern.rephrasedExample}”</span></span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="ds-body mt-4">{emptyEnglishEvidenceMessage(result.englishCommunication.evidenceStatus, result.evidenceReview?.englishPatterns)}</p>}
            <EvidenceCountNote counts={result.evidenceReview?.englishPatterns} />
          </section>

          <CapturedAnswers turns={turns} />
        </div>
      </details>
    </div>
  );
}

export function InterviewReport({ config, elapsed, totalClock, answerCount, persistenceLabel, persistenceMessage, feedbackSyncMessage, reportState, reportCaption, turns, azureSummary, coverage, onLeave }: {
  config: InterviewConfig;
  elapsed: string;
  totalClock: string;
  answerCount: number;
  persistenceLabel: string;
  persistenceMessage: string | null;
  feedbackSyncMessage: string | null;
  reportState: ReportState;
  reportCaption: string;
  turns: Turns;
  azureSummary: AzureMetricSummary;
  coverage: { available: number; pending: number; total: number };
  onLeave: () => void;
}): ReactNode {
  const reportDirection = reportState.result?.jobDirection ?? config.jobDirection;
  return (
    <section className="rp-root mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
      <header className="rp-hero ds-enter">
        <p className="rp-eyebrow">Prática concluída</p>
        <h1 id="interview-complete-title" className="font-display text-balance rp-title">Seu relatório de entrevista</h1>
        <p className="ds-body mt-3 max-w-[60ch]">{persistenceLabel} As respostas por voz foram transcritas; o áudio não é salvo.</p>
        <dl className="rp-facts">
          <div><dt>Cargo</dt><dd>{config.role}</dd></div>
          <div><dt>Tempo</dt><dd className="tabular-nums">{elapsed} / {totalClock}</dd></div>
          <div><dt>Respostas</dt><dd>{answerCount}</dd></div>
        </dl>
        {reportDirection && (
          <p className="rp-hint mt-3">
            Relatório direcionado {config.interviewSource === "resume" ? "pelo currículo" : "para esta vaga"}: {reportDirection.mainInterviewEmphasis}
          </p>
        )}
      </header>

      {persistenceMessage && <div role="status" className="rp-alert mt-5">{persistenceMessage}</div>}
      {feedbackSyncMessage && <div role="status" className="rp-alert mt-4">{feedbackSyncMessage}</div>}

      <div className="mt-6" aria-busy={reportState.status === "pending"}>
        {reportState.status === "pending" ? (
          <div className="ds-card rp-card rp-pending" role="status">
            <div className="rp-bar" aria-hidden="true" />
            <p className="ds-body mt-3">{reportCaption} A análise não avalia seu sotaque.</p>
          </div>
        ) : reportState.status === "unavailable" ? (
          <div className="rp-stack">
            <div role="status" className="rp-alert">
              <h2 className="ds-label">{turns.length ? "Não foi possível montar o relatório detalhado." : "Não há respostas para analisar."}</h2>
              <p className="mt-1 text-sm leading-6">{reportState.message} Os sinais vocais disponíveis continuam abaixo.</p>
            </div>
            <CapturedAnswers turns={turns} />
            <AzureVoiceReport summary={azureSummary} coverage={coverage} />
          </div>
        ) : reportState.status === "ready" && reportState.result ? (
          <ReadyReport result={reportState.result} turns={turns} azureSummary={azureSummary} coverage={coverage} />
        ) : null}
      </div>

      <div className="rp-foot">
        <p className="rp-hint">{persistenceLabel}</p>
        <button type="button" className="ds-btn ds-btn-cta-green rp-back" onClick={onLeave}>Voltar ao dashboard <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" /></button>
      </div>
    </section>
  );
}
