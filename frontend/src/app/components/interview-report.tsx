"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { getCurrentLocale, t } from "@/lib/locale";
import { ArrowLeft, ArrowUpRight, Play } from "lucide-react";
import { answerOrdinalForSequence, pairInterviewTurns, type InterviewReportResult } from "@/lib/interview/report";
import type { AzureMetricSummary } from "@/lib/interview/report-metrics.mjs";
import type { InterviewConfig } from "@/lib/interview/types";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { RESUME_PRACTICE_LABEL } from "@/lib/interview/resume-neutral.mjs";
import { getAnswerClipUrl } from "@/lib/interview/answer-clips";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { findingsForAnswer, phonemeHint, summarizeDelivery, worstSentence } from "@/lib/interview/report-response.mjs";
import { AzureVoiceReport } from "./azure-voice-report";
import "./interview-report.css";

export type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };
type Turns = ReturnType<typeof pairInterviewTurns>;
const enter = (index: number) => ({ "--i": index }) as CSSProperties;

function SpeechReview({ text, sentence, answer }: { text: string; sentence: NonNullable<ReturnType<typeof worstSentence>>; answer: NonNullable<AzureMetricSummary["answers"]>[number] }) {
  const [slow, setSlow] = useState(false);
  const [playing, setPlaying] = useState<"self" | "model" | null>(null);
  const [message, setMessage] = useState("");
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const clip = answer.clips?.find((item) => item.sentenceIndex === sentence.sentenceIndex);
  useEffect(() => () => { audio?.pause(); }, [audio]);
  async function playSelf() {
    if (!clip) return;
    try {
      const url = await getAnswerClipUrl(clip.path);
      if (!url) throw new Error();
      const player = new Audio(url); setAudio(player); setPlaying("self");
      player.onended = () => setPlaying(null); await player.play();
    } catch { setMessage(t("Não foi possível reproduzir este trecho.")); setPlaying(null); }
  }
  async function playModel() {
    try {
      const blob = await fetchSpeechBlob(text, { endpoint: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/speech`, fetcher: authorizedFetch, speed: slow ? 0.85 : 1, retainMs: 300_000 });
      const url = URL.createObjectURL(blob); const player = new Audio(url); setAudio(player); setPlaying("model");
      player.onended = () => { URL.revokeObjectURL(url); setPlaying(null); }; await player.play();
    } catch { setMessage(t("Não foi possível gerar a reprodução agora.")); setPlaying(null); }
  }
  return <div className="rp-sentence-review">
    <p lang="en" className="rp-sentence-text">{sentence.text.split(/(\s+)/u).map((part, index) => {
      const problem = sentence.problemWords?.find((item) => item.word.toLowerCase() === part.replace(/[^\p{L}'-]/gu, "").toLowerCase());
      return problem ? <span key={index} className="rp-problem-word" title={phonemeHint(problem.worstPhoneme) ? t(phonemeHint(problem.worstPhoneme)!) : undefined}>{part}</span> : part;
    })}</p>
    {sentence.problemWords?.map((word) => { const hint = phonemeHint(word.worstPhoneme); return hint ? <p key={`${word.word}-${word.score}`} className="rp-hint">{word.word}: {t(hint)}</p> : null; })}
    <div className="rp-player-row">
      {clip && <button type="button" className="ds-btn ds-btn-soft" onClick={playSelf}><Play className="size-4" aria-hidden="true" />{t(playing === "self" ? "Reproduzindo" : "Você")}</button>}
      <button type="button" className="ds-btn ds-btn-soft" onClick={playModel}><Play className="size-4" aria-hidden="true" />{t(playing === "model" ? "Reproduzindo" : "Como soa")}</button>
      <label className="rp-speed"><input type="checkbox" checked={slow} onChange={(event) => setSlow(event.target.checked)} />{t("Mais devagar (0,85×)")}</label>
    </div>
    {message && <p className="rp-hint" role="status">{message}</p>}
  </div>;
}

function DeliveryLine({ delivery }: { delivery: NonNullable<ReturnType<typeof summarizeDelivery>> }) {
  const entries: ReactNode[] = [];
  if (delivery.wordsPerMinute !== null) entries.push(<span key="rate">{delivery.wordsPerMinute} {t("palavras/min")}</span>);
  if (delivery.pauseCount > 0) entries.push(<span key="pauses">{delivery.pauseCount} {t("pausas")}{delivery.longestPauseMs >= 1_000 ? <> · {t("mais longa")} {Math.round(delivery.longestPauseMs / 100) / 10} s</> : null}</span>);
  if (delivery.fillerCount > 0) entries.push(<span key="fillers">{delivery.fillerCount} {t("hesitações")}</span>);
  return <p className="rp-delivery-line">{entries.map((entry, index) => <span key={index}>{index > 0 ? " · " : null}{entry}</span>)}</p>;
}

function AnswerCard({ turn, result, azureAnswers, ordinal }: { turn: Turns[number]; result: InterviewReportResult; azureAnswers: NonNullable<AzureMetricSummary["answers"]>; ordinal: number }) {
  const [expanded, setExpanded] = useState(false);
  const findings = findingsForAnswer(result, turn.sequenceNumber);
  const answerVoice = azureAnswers.find((item) => item.sequenceNumber === turn.sequenceNumber);
  const delivery = summarizeDelivery(answerVoice?.delivery);
  const worst = worstSentence(answerVoice);
  return <article className="ds-card rp-card rp-answer" aria-labelledby={`answer-${turn.sequenceNumber}`}>
    <p className="rp-answer-question" lang="en">{turn.question}</p>
    <h3 id={`answer-${turn.sequenceNumber}`} className="ds-label">{t("Resposta ")}{ordinal}</h3>
    <p lang="en" className={`rp-answer-text${expanded ? " is-expanded" : ""}`}>{turn.answer}</p>
    {turn.answer.length > 90 && <button type="button" className="rp-inline-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? "Recolher resposta" : "Ver resposta completa")}</button>}
    {(findings.strengths.length > 0 || findings.gaps.length > 0) && <div className="rp-answer-columns">
      {findings.strengths.length > 0 && <section><h4 className="rp-subtitle">{t("O que funcionou")}</h4>{findings.strengths.map((item, index) => <p key={index} className="rp-answer-finding">{item.explanation}</p>)}</section>}
      {findings.gaps.length > 0 && <section><h4 className="rp-subtitle">{t("O que faltou")}</h4>{findings.gaps.map((item, index) => <p key={index} className="rp-answer-finding">{item.explanation}</p>)}</section>}
    </div>}
    {findings.patterns.length > 0 && <section className="rp-answer-english"><h4 className="rp-subtitle">{t("Inglês")}</h4>{findings.patterns.map((pattern, index) => <div className="rp-pattern" key={`${pattern.type}-${index}`}>
      <p lang="en" className="rp-quote">{t("Você disse: “")}{pattern.evidence}{t("”")}</p><p className="rp-rephrase-text" lang="en">{t("Uma forma mais natural: “")}{pattern.rephrasedExample}{t("”")}</p><p className="rp-hint mt-1">{pattern.suggestion}</p>{pattern.why && <p className="rp-hint mt-1">{t("Por que isso acontece: ")}{pattern.why}</p>}
    </div>)}</section>}
    {answerVoice && <section className="rp-answer-voice"><h4 className="rp-subtitle">{t("Voz")}</h4>{delivery && <DeliveryLine delivery={delivery} />}{delivery?.hint && <p className="rp-hint">{t(delivery.hint)}</p>}{worst && worst.score < 75 && <><p className="rp-hint mt-2">{t("Trecho que pode ficar mais claro")}</p><SpeechReview text={worst.text} sentence={worst} answer={answerVoice} /></>}</section>}
  </article>;
}

function CapturedAnswers({ turns }: { turns: Turns }) {
  return <details className="rp-more"><summary>{t("Transcrição completa")}</summary><ol className="rp-transcript">{turns.map((turn, index) => <li key={`${turn.sequenceNumber}-${index}`}><p lang="en"><span className="font-semibold">{t("Pergunta:")}</span> {turn.question}</p><p lang="en" className="mt-2"><span className="font-semibold">{t("Sua resposta:")}</span> {turn.answer}</p></li>)}</ol></details>;
}

function ReadyReport({ result, turns, azureSummary, coverage }: { result: InterviewReportResult; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number } }) {
  const answers = azureSummary.answers ?? [];
  return <div className="rp-stack">
    <section className="ds-card rp-card ds-enter" style={enter(0)}><p className="rp-eyebrow">{t("Seu desempenho")}</p><p className="rp-summary">{result.technicalContent.summary}</p></section>
    <section className="rp-priorities ds-mata ds-enter" style={enter(1)} aria-labelledby="priority-title"><p className="rp-eyebrow">{t("O que mais pesa")}</p><h2 id="priority-title" className="rp-priorities-title">{t("Prioridades para praticar")}</h2>{result.priorities.length ? <ol className="rp-priority-list">{result.priorities.slice(0, 3).map((item, index) => <li className="rp-priority" key={`${item.sequenceNumber}-${index}`}><span className="rp-priority-num" aria-hidden="true">{index + 1}</span><div><p className="rp-priority-focus">{item.focus}</p><p className="rp-priority-evidence">{t("Baseado em: “")}{item.evidence}{t("”")}</p><details className="rp-exercise-disclosure"><summary>{t("Ver exercício")}</summary><p>{item.exercise}</p></details></div></li>)}</ol> : <p className="rp-priority-empty">{t("Nenhuma prioridade específica foi destacada.")}</p>}</section>
    <section className="rp-answer-section ds-enter" style={enter(2)} aria-labelledby="answers-title"><h2 id="answers-title" className="ds-h2">{t("Resposta por resposta")}</h2>{turns.length ? <div className="rp-stack mt-4">{turns.map((turn, index) => <AnswerCard key={turn.sequenceNumber} turn={turn} ordinal={answerOrdinalForSequence(turns, turn.sequenceNumber) ?? index + 1} result={result} azureAnswers={answers} />)}</div> : <p className="ds-body mt-3">{t("As perguntas e respostas desta entrevista não estão disponíveis.")}</p>}</section>
    <section className="ds-enter" style={enter(3)}><AzureVoiceReport summary={azureSummary} coverage={coverage} title={t("Sua voz")} /></section>
    <CapturedAnswers turns={turns} />
  </div>;
}

export function InterviewReport({ config, elapsed, totalClock, answerCount, persistenceLabel, persistenceMessage, feedbackSyncMessage, reportState, reportCaption, turns, azureSummary, coverage, onLeave, currentInterviewId, historical = false }: {
  config: InterviewConfig; elapsed: string; totalClock: string; answerCount: number; persistenceLabel: string; persistenceMessage: string | null; feedbackSyncMessage: string | null; reportState: ReportState; progressRecords: ProgressRecord[]; currentInterviewId?: string; historical?: boolean; reportCaption: string; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; onLeave: () => void;
  /** Future slot for a “Refazer esta resposta” action; intentionally not rendered yet. */
  onRetryAnswer?: (sequenceNumber: number) => void;
}): ReactNode {
  const [loadedTurns, setLoadedTurns] = useState<Turns>(turns);
  const [loadingTurns, setLoadingTurns] = useState(historical && turns.length === 0 && Boolean(currentInterviewId));
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
  return <section className="rp-root mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
    {historical && <button type="button" className="ds-btn ds-btn-quiet mb-3" onClick={onLeave}><ArrowLeft className="size-4" aria-hidden="true" />{getCurrentLocale() === "en" ? "Back to Progress" : t("Voltar ao Progresso")}</button>}
    <header className="rp-hero ds-enter"><p className="rp-eyebrow">{t("Prática concluída")}</p><h1 id="interview-complete-title" className="font-display text-balance rp-title">{t("Seu relatório de entrevista")}</h1><p className="ds-body mt-3 max-w-[60ch]">{t(persistenceLabel)} {t("As respostas foram transcritas; trechos disponíveis podem ser reproduzidos neste relatório.")}</p><dl className="rp-facts"><div><dt>{t(config.interviewSource === "resume" ? "Modo" : "Cargo")}</dt><dd>{config.interviewSource === "resume" ? t(headingFacts) : headingFacts}</dd></div><div><dt>{t(historical ? "Tempo registrado" : "Tempo")}</dt><dd className="tabular-nums">{historical ? elapsed : <>{elapsed} {t("/ ")}{totalClock}</>}</dd></div><div><dt>{t("Respostas")}</dt><dd>{answerCount}</dd></div></dl>{reportDirection && config.interviewSource !== "resume" && <p className="rp-hint mt-3">{t("Direção da vaga: ")}{reportDirection.mainInterviewEmphasis}</p>}</header>
    {persistenceMessage && <div role="status" className="rp-alert mt-5">{t(persistenceMessage)}</div>}{feedbackSyncMessage && <div role="status" className="rp-alert mt-4">{t(feedbackSyncMessage)}</div>}
    <div className="mt-6" aria-busy={reportState.status === "pending" || loadingTurns}>{loadingTurns && <p className="rp-hint mb-4" role="status">{t("Carregando perguntas e respostas…")}</p>}{reportState.status === "pending" ? <div className="ds-card rp-card rp-pending" role="status"><div className="rp-bar" aria-hidden="true"/><p className="ds-body mt-3">{t(reportCaption)} {t("A análise não avalia seu sotaque.")}</p></div> : reportState.status === "unavailable" ? <div className="rp-stack"><div role="status" className="rp-alert"><h2 className="ds-label">{t(loadedTurns.length ? "Não foi possível montar o relatório detalhado." : "Não há respostas para analisar.")}</h2><p className="mt-1 text-sm leading-6">{t(reportState.message ?? "")} {t("Os sinais vocais disponíveis continuam abaixo.")}</p></div>{loadedTurns.length > 0 && <CapturedAnswers turns={loadedTurns} />}<AzureVoiceReport summary={azureSummary} coverage={coverage}/></div> : reportState.status === "ready" && reportState.result ? <ReadyReport result={reportState.result} turns={loadedTurns} azureSummary={azureSummary} coverage={coverage}/> : null}</div>
    <div className="rp-foot"><p className="rp-hint">{persistenceLabel}</p><button type="button" className="ds-btn ds-btn-cta-green rp-back" onClick={onLeave}>{t(historical ? "Voltar ao Progresso " : "Voltar ao dashboard ")}<ArrowUpRight className="ds-arrow size-4" aria-hidden="true"/></button></div>
  </section>;
}
