import { getCurrentLocale, t } from "@/lib/locale";
import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Dumbbell, Quote } from "lucide-react";
import { answerOrdinalForSequence, type InterviewReportResult, type pairInterviewTurns } from "@/lib/interview/report";
import { emptyEnglishEvidenceMessage, emptyReportEvidenceMessage, partialEvidenceReviewNote } from "@/lib/interview/report-evidence-copy.mjs";
import { clarityHelp, englishPatternsHelp, technicalContentHelp } from "@/lib/interview/report-metric-copy.mjs";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { InterviewConfig } from "@/lib/interview/types";
import { reportTechnicalFocus } from "@/lib/interview/personalization.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { RESUME_PRACTICE_LABEL } from "@/lib/interview/resume-neutral.mjs";
import { deriveMainPoints, toSecondPerson } from "@/lib/interview/report-main-points.mjs";
import type { ReportSuggestion } from "@/lib/practice/report-suggestions.mjs";
import { AzureVoiceReport } from "./azure-voice-report";
import "./interview-report.css";

export type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };
type Turns = ReturnType<typeof pairInterviewTurns>;
export type PracticeSuggestionsState = { status: "idle" | "loading" | "ready"; items: ReportSuggestion[] };
type EvidenceCounts = NonNullable<InterviewReportResult["evidenceReview"]>["englishPatterns"];

const enter = (index: number) => ({ "--i": index }) as CSSProperties;

function clarityLabel(value: InterviewReportResult["englishCommunication"]["clarity"]) {
  return t(value === "CLEAR" ? "Clara" : value === "MOSTLY_CLEAR" ? "Na maior parte clara" : "Precisa de mais clareza");
}

function reportFocusDisclosure(focus: InterviewConfig["focus"]): string {
  switch (focus) {
    case "technical-depth": return "A leitura priorizou conteúdo técnico; comunicação em inglês e as demais áreas também foram avaliadas com justiça.";
    case "communication": return "A leitura priorizou comunicação em inglês; conteúdo técnico também foi avaliado com justiça.";
    case "behavioral": return "A leitura priorizou exemplos de colaboração, decisões e impacto; comunicação em inglês também foi avaliada com justiça.";
    default: return "A leitura manteve equilíbrio entre conteúdo técnico, comunicação em inglês e as demais áreas.";
  }
}

function patternLabel(value: InterviewReportResult["englishCommunication"]["patterns"][number]["type"]) {
  const labels: Record<typeof value, string> = { GRAMMAR: "Gramática", WORD_CHOICE: "Escolha de palavras", FALSE_COGNATE: "Falso cognato", STRUCTURE: "Estrutura da resposta" };
  return t(labels[value]);
}

function EvidenceCountNote({ counts }: { counts: EvidenceCounts | undefined }) {
  const note = partialEvidenceReviewNote(counts);
  return note ? <p className="rp-hint mt-3">{t(note)}</p> : null;
}

function CapturedAnswers({ turns }: { turns: Turns }) {
  return (
    <section className="ds-card rp-card" aria-labelledby="captured-answers-title">
      <h2 id="captured-answers-title" className="ds-h2">{t("Respostas registradas")}</h2>
      {turns.length ? (
        <ol className="rp-list mt-4">
          {turns.map((turn, index) => (
            <li key={`${turn.sequenceNumber}-${index}`} className="rp-item">
              <p className="ds-label">{t("Pergunta ")}{answerOrdinalForSequence(turns, turn.sequenceNumber) ?? index + 1}</p>
              <p lang="en" className="mt-2 text-sm leading-6"><span className="font-semibold">{t("Pergunta:")}</span> {turn.question}</p>
              <p lang="en" className="mt-2 text-sm leading-6"><span className="font-semibold">{t("Sua resposta:")}</span> {turn.answer}</p>
            </li>
          ))}
        </ol>
      ) : <p className="ds-body mt-2">{t("Nenhuma resposta foi enviada nesta sessão. Sem respostas, não há evidência para uma análise detalhada.")}</p>}
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
      <p className="rp-hint mt-2">{t(help)}</p>
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
              <p className="rp-quote">{t("Resposta ")}{answerOrdinalForSequence(turns, item.sequenceNumber) ?? "—"}{t(": “")}{item.evidence}{t("”")}</p>
              <p className="mt-1 text-sm leading-6">{item.explanation}</p>
            </li>
          ))}
        </ul>
      ) : <p className="ds-body">{t(empty)}</p>}
      <EvidenceCountNote counts={counts} />
    </div>
  );
}

function MainPoints({ main, result, turns }: { main: ReturnType<typeof deriveMainPoints>; result: InterviewReportResult; turns: Turns }) {
  return (
    <section className="ds-card rp-card" aria-labelledby="main-points-title">
      <h2 id="main-points-title" className="ds-h2">{t("Pontos principais")}</h2>
      <div className="rp-cols">
        <div>
          <h3 className="rp-subtitle">{t("Inglês")}</h3>
          {main.english.length ? (
            <ul className="rp-list">
              {main.english.map((pattern, index) => (
                <li key={`${pattern.sequenceNumber}-${pattern.type}-${index}`} className="rp-item">
                  <p className="ds-label"><span className="rp-tag">{patternLabel(pattern.type)}</span> <span className="rp-where">{t("resposta ")}{answerOrdinalForSequence(turns, pattern.sequenceNumber) ?? "—"}</span></p>
                  <p lang="en" className="rp-fix mt-2"><span className="rp-fix-from">{t("“")}{pattern.evidence}{t("”")}</span><span aria-hidden="true" className="rp-fix-arrow"> {t("→ ")}</span><span className="sr-only"> {t("corrigido para ")}</span><span className="rp-fix-to">{t("“")}{pattern.rephrasedExample}{t("”")}</span></p>
                  <p className="rp-hint mt-2">{pattern.suggestion}</p>
                </li>
              ))}
            </ul>
          ) : <p className="ds-body">{t(emptyEnglishEvidenceMessage(result.englishCommunication.evidenceStatus, result.evidenceReview?.englishPatterns))}</p>}
        </div>
        <div>
          <h3 className="rp-subtitle">{t("Técnico")}</h3>
          {main.technical.length ? (
            <ul className="rp-list">
              {main.technical.map((item, index) => (
                <li key={`${item.sequenceNumber}-${item.kind}-${index}`} className="rp-item" data-tone={item.kind === "gap" ? "gap" : "good"}>
                  <p className="ds-label"><span className="rp-tag" data-tone={item.kind}>{t(item.kind === "gap" ? "Para reforçar" : "Ponto forte")}</span> <span className="rp-where">{t("resposta ")}{answerOrdinalForSequence(turns, item.sequenceNumber) ?? "—"}</span></p>
                  <p className="rp-quote mt-2">{t("“")}{item.evidence}{t("”")}</p>
                  <p className="mt-1 text-sm leading-6">{item.explanation}</p>
                  {item.vacancyCompetency && <p className="rp-hint mt-2">{t("Prioridade da vaga avaliada nesta resposta: ")}{item.vacancyCompetency}{t(".")}</p>}
                </li>
              ))}
            </ul>
          ) : <p className="ds-body">{t("Nenhum ponto técnico relevante foi apontado com segurança nesta sessão.")}</p>}
        </div>
      </div>
    </section>
  );
}

function PracticeSuggestions({ state, onOpen }: { state: PracticeSuggestionsState; onOpen: (href: string) => void }) {
  if (state.status === "loading") return <p className="rp-suggest-loading mt-5" role="status">{t("Separando o que treinar…")}</p>;
  if (!state.items.length) return null;
  return (
    <div className="rp-suggest mt-5">
      <h3 className="rp-suggest-title">{t("Treine isto agora")}</h3>
      <ul className="rp-suggest-list">
        {state.items.map((item, index) => (
          <li key={`${item.lessonKey}-${item.ruleId ?? ""}`} className="rp-suggest-card" style={enter(index)}>
            <p className="rp-suggest-where">{t(item.lessonTitle)}{item.partLabel ? <> · {t(item.partLabel)}</> : null}</p>
            <p className="rp-fix" lang="en"><span className="rp-suggest-from">{item.evidence}</span> <span aria-hidden="true">→</span><span className="sr-only">{t("melhor:")}</span> <span className="rp-suggest-to">{item.rephrased}</span></p>
            <button type="button" className="ds-btn ds-btn-soft rp-suggest-btn" onClick={() => onOpen(item.href)}><Dumbbell className="size-4" aria-hidden="true" />{t("Estudar esta parte")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyReport({ result, turns, azureSummary, coverage, onTrain, onOpenPractice, practiceSuggestions, focus, focusDisclosure, historical }: { onOpenPractice?: (href: string) => void; practiceSuggestions?: PracticeSuggestionsState; result: InterviewReportResult; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; onTrain?: () => void; focus: { focus: string; priorSessionCount: number } | null; focusDisclosure: string | null; historical: boolean }) {
  const main = deriveMainPoints(result);
  return (
    <div className="rp-stack">
      <section className="ds-card rp-card ds-enter" style={enter(0)} aria-labelledby="summary-title">
        <h2 id="summary-title" className="ds-h2">{t("Resumo")}</h2>
        <p className="rp-summary">{main.summary}</p>
        <p className="rp-hint mt-2">{t("Clareza geral em inglês: ")}<span className="rp-clarity-value">{clarityLabel(result.englishCommunication.clarity)}</span></p>
      </section>

      {focus && <section className="rp-focus ds-enter" style={enter(1)} aria-labelledby="next-focus-title">
        <h2 id="next-focus-title" className="ds-label">{t("Seu próximo foco")}</h2>
        <p className="mt-1 text-sm leading-6">{focus.focus}</p>
        {focus.priorSessionCount > 0 && <p className="rp-hint mt-1">{t("Este foco apareceu em ")}{focus.priorSessionCount}{t(focus.priorSessionCount === 1 ? " entrevista concluída." : " entrevistas concluídas.")}</p>}
      </section>}

      <div className="ds-enter" style={enter(2)}>
        <AzureVoiceReport summary={azureSummary} coverage={coverage} title={t("Pontuação da fala")} />
      </div>

      <div className="rp-leaf" aria-hidden="true"><span /></div>

      <div className="ds-enter" style={enter(3)}>
        <MainPoints main={main} result={result} turns={turns} />
      </div>

      <div className="rp-leaf" aria-hidden="true"><span /></div>

      <section className="rp-priorities ds-mata ds-enter" style={enter(4)} aria-labelledby="priorities-title">
        <p className="rp-eyebrow">{t("Próximos passos")}</p>
        <h2 id="priorities-title" className="rp-priorities-title">{t("Prioridades para praticar")}</h2>
        {focusDisclosure && <p className="rp-hint mt-2">{focusDisclosure}</p>}
        {main.priorities.length ? (
          <ol className="rp-priority-list">
            {main.priorities.map((priority, index) => (
              <li key={`${priority.sequenceNumber}-${index}`} className="rp-priority">
                <span className="rp-priority-num" aria-hidden="true">{index + 1}</span>
                <div className="min-w-0">
                  <p className="rp-priority-focus">{priority.focus}</p>
                  <p className="rp-priority-evidence">{t("Baseado na resposta ")}{answerOrdinalForSequence(turns, priority.sequenceNumber) ?? "—"}{t(": “")}{priority.evidence}{t("”")}</p>
                  {priority.vacancyCompetency && <p className="rp-hint mt-1">{t("Prioridade da vaga: ")}{priority.vacancyCompetency}</p>}
                  <p className="rp-exercise"><Dumbbell className="size-4 shrink-0" aria-hidden="true" /><span><span className="font-semibold">{t("Exercício:")}</span> {priority.exercise}</span></p>
                </div>
              </li>
            ))}
          </ol>
          ) : <p className="rp-priority-empty">{t(emptyReportEvidenceMessage(result.evidenceReview?.priorities))}</p>}
        {onOpenPractice && practiceSuggestions && <PracticeSuggestions state={practiceSuggestions} onOpen={onOpenPractice} />}
        {result.englishCommunication.patterns.length > 0 && onTrain && !(practiceSuggestions?.status === "ready" && practiceSuggestions.items.length > 0 && onOpenPractice) && <button type="button" className="ds-btn ds-btn-cta mt-5" onClick={onTrain}><Dumbbell className="size-4" aria-hidden="true" />{t("Treinar meus erros")}</button>}
      </section>

      <details className="rp-more ds-enter" style={enter(5)}>
        <summary>{t("Ver análise completa")}</summary>
        <div className="rp-stack mt-4">
          <section className="ds-card rp-card" aria-labelledby="technical-report-title">
            <AreaHeader step={1} id="technical-report-title" title={t("Conteúdo técnico")} help={t(technicalContentHelp)} />
            <div className="rp-cols">
              <div>
                <h3 className="rp-subtitle">{t("O que correspondeu à pergunta")}</h3>
                <EvidenceList items={result.technicalContent.strengths} turns={turns} tone="good" empty={emptyReportEvidenceMessage(result.evidenceReview?.technicalStrengths)} counts={result.evidenceReview?.technicalStrengths} />
              </div>
              <div>
                <h3 className="rp-subtitle">{t("O que precisava de mais explicação")}</h3>
                <EvidenceList items={result.technicalContent.gaps} turns={turns} tone="gap" empty={emptyReportEvidenceMessage(result.evidenceReview?.technicalGaps)} counts={result.evidenceReview?.technicalGaps} />
              </div>
            </div>
          </section>

          <section className="ds-card rp-card" aria-labelledby="english-report-title">
            <AreaHeader step={2} id="english-report-title" title={t("Comunicação em inglês")} help={t(englishPatternsHelp)} />
            <div className="rp-clarity">
              <p className="ds-label">{t("Clareza geral: ")}<span className="rp-clarity-value">{clarityLabel(result.englishCommunication.clarity)}</span></p>
              <p className="rp-hint mt-1">{t(clarityHelp)}</p>
            </div>
            {result.englishCommunication.patterns.length ? (
              <ul className="rp-list mt-5">
                {result.englishCommunication.patterns.map((pattern, index) => (
                  <li key={`${pattern.sequenceNumber}-${pattern.type}-${index}`} className="rp-item">
                    <p className="ds-label"><span className="rp-tag">{patternLabel(pattern.type)}</span> <span className="rp-where">{t("resposta ")}{answerOrdinalForSequence(turns, pattern.sequenceNumber) ?? "—"}</span></p>
                    <p className="rp-quote mt-2">{t("Trecho: “")}{pattern.evidence}{t("”")}</p>
                    <p className="mt-1 text-sm leading-6">{t("Sugestão: ")}{toSecondPerson(pattern.suggestion)}</p>
                    <p className="rp-rephrase">
                      <Quote className="size-4 shrink-0" aria-hidden="true" />
                      <span><span className="rp-rephrase-label">{t("Exemplo")}</span> <span lang="en" className="rp-rephrase-text">{t("“")}{pattern.rephrasedExample}{t("”")}</span></span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="ds-body mt-4">{t(emptyEnglishEvidenceMessage(result.englishCommunication.evidenceStatus, result.evidenceReview?.englishPatterns))}</p>}
            <EvidenceCountNote counts={result.evidenceReview?.englishPatterns} />
          </section>

          {!historical && <CapturedAnswers turns={turns} />}
        </div>
      </details>
    </div>
  );
}

export function InterviewReport({ config, elapsed, totalClock, answerCount, persistenceLabel, persistenceMessage, feedbackSyncMessage, reportState, reportCaption, turns, azureSummary, coverage, onLeave, onTrain, onOpenPractice, practiceSuggestions, progressRecords, currentInterviewId, historical = false }: {
  config: InterviewConfig;
  elapsed: string;
  totalClock: string;
  answerCount: number;
  persistenceLabel: string;
  persistenceMessage: string | null;
  feedbackSyncMessage: string | null;
  reportState: ReportState;
  progressRecords: ProgressRecord[];
  currentInterviewId?: string;
  historical?: boolean;
  reportCaption: string;
  turns: Turns;
  azureSummary: AzureMetricSummary;
  coverage: { available: number; pending: number; total: number };
  onLeave: () => void;
  onTrain?: () => void;
  onOpenPractice?: (href: string) => void;
  practiceSuggestions?: PracticeSuggestionsState;
}): ReactNode {
  const reportDirection = reportState.result?.jobDirection ?? config.jobDirection;
  const focus = reportState.result ? reportTechnicalFocus(reportState.result, progressRecords, config.role, currentInterviewId) : null;
  const focusDisclosure = config.interviewSource === "resume" ? null : reportFocusDisclosure(config.focus);
  return (
    <section className="rp-root mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
      {historical && (
        <button type="button" className="ds-btn ds-btn-quiet mb-3" onClick={onLeave}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {getCurrentLocale() === "en" ? "Back to Progress" : t("Voltar ao Progresso")}
        </button>
      )}
      <header className="rp-hero ds-enter">
        <p className="rp-eyebrow">{t("Prática concluída")}</p>
        <h1 id="interview-complete-title" className="font-display text-balance rp-title">{t("Seu relatório de entrevista")}</h1>
        <p className="ds-body mt-3 max-w-[60ch]">{t(persistenceLabel)} {t("As respostas por voz foram transcritas; o áudio não é salvo.")}</p>
        <dl className="rp-facts">
          {config.interviewSource === "resume"
            ? <div><dt>{t("Modo")}</dt><dd>{t(RESUME_PRACTICE_LABEL)}</dd></div>
            : <div><dt>{t("Cargo")}</dt><dd>{config.role}</dd></div>}
          <div><dt>{t(historical ? "Tempo registrado" : "Tempo")}</dt><dd className="tabular-nums">{historical ? elapsed : <>{elapsed} {t("/ ")}{totalClock}</>}</dd></div>
          <div><dt>{t("Respostas")}</dt><dd>{answerCount}</dd></div>
        </dl>
        {config.interviewSource === "resume" ? (
          <p className="rp-hint mt-3">{t("Relatório baseado nas respostas às perguntas personalizadas do currículo.")}</p>
        ) : reportDirection && (
          <p className="rp-hint mt-3">
            {t("Relatório direcionado para esta vaga: ")}{reportDirection.mainInterviewEmphasis}
          </p>
        )}
      </header>

      {persistenceMessage && <div role="status" className="rp-alert mt-5">{t(persistenceMessage)}</div>}
      {feedbackSyncMessage && <div role="status" className="rp-alert mt-4">{t(feedbackSyncMessage)}</div>}

      <div className="mt-6" aria-busy={reportState.status === "pending"}>
        {reportState.status === "pending" ? (
          <div className="ds-card rp-card rp-pending" role="status">
            <div className="rp-bar" aria-hidden="true" />
            <p className="ds-body mt-3">{t(reportCaption)} {t("A análise não avalia seu sotaque.")}</p>
          </div>
        ) : reportState.status === "unavailable" ? (
          <div className="rp-stack">
            <div role="status" className="rp-alert">
              <h2 className="ds-label">{t(turns.length ? "Não foi possível montar o relatório detalhado." : "Não há respostas para analisar.")}</h2>
              <p className="mt-1 text-sm leading-6">{t(reportState.message ?? "")} {t("Os sinais vocais disponíveis continuam abaixo.")}</p>
            </div>
            <CapturedAnswers turns={turns} />
            <AzureVoiceReport summary={azureSummary} coverage={coverage} />
          </div>
        ) : reportState.status === "ready" && reportState.result ? (
          <ReadyReport result={reportState.result} turns={turns} azureSummary={azureSummary} coverage={coverage} onTrain={onTrain} onOpenPractice={onOpenPractice} practiceSuggestions={practiceSuggestions} focus={focus} focusDisclosure={focusDisclosure} historical={historical} />
        ) : null}
      </div>

      <div className="rp-foot">
        <p className="rp-hint">{persistenceLabel}</p>
        <div className="flex flex-wrap gap-3">
          {reportState.result?.englishCommunication.patterns.length && onTrain ? <button type="button" className="ds-btn ds-btn-soft" onClick={onTrain}><Dumbbell className="size-4" aria-hidden="true" />{t("Treinar meus erros")}</button> : null}
          <button type="button" className="ds-btn ds-btn-cta-green rp-back" onClick={onLeave}>{t(historical ? "Voltar ao Progresso " : "Voltar ao dashboard ")}<ArrowUpRight className="ds-arrow size-4" aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  );
}
