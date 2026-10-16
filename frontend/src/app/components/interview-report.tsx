"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { findingsForAnswer, phonemeHint } from "@/lib/interview/report-response.mjs";
import { deriveOverviewTiles, flattenAndRankPhrases, groupPatternsByType } from "@/lib/interview/report-overview.mjs";
import { AzureVoiceReport } from "./azure-voice-report";
import "./interview-report.css";

export type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };
type Turns = ReturnType<typeof pairInterviewTurns>;

function PhrasePlayer({ phrase, slow }: { phrase: ReturnType<typeof flattenAndRankPhrases>[number]; slow: boolean }) {
  const [playing, setPlaying] = useState<"self" | "model" | null>(null);
  const [message, setMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  async function playSelf() {
    if (!phrase.clip) return;
    try {
      const url = await getAnswerClipUrl(phrase.clip.path);
      if (!url) throw new Error();
      const player = new Audio(url);
      audioRef.current = player;
      player.onended = () => setPlaying(null);
      setPlaying("self");
      await player.play();
    } catch {
      setMessage(t("Não foi possível reproduzir este trecho."));
      setPlaying(null);
    }
  }
  async function playModel() {
    try {
      const blob = await fetchSpeechBlob(phrase.text, {
        endpoint: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/speech`,
        fetcher: authorizedFetch,
        speed: slow ? 0.8 : 1,
        retainMs: 300_000,
      });
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      audioRef.current = player;
      player.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(null);
      };
      setPlaying("model");
      await player.play();
    } catch {
      setMessage(t("Não foi possível gerar a reprodução agora."));
      setPlaying(null);
    }
  }
  const problemWords = phrase.problemWords ?? [];
  const hint = phrase.issue === "intonation"
    ? problemWords.some((word) => word.prosodyErrors?.some((error) => /pause/i.test(error)))
      ? "Pausa no meio da frase."
      : "Entonação plana: tente subir ou descer o tom em uma palavra-chave."
    : problemWords.map((word) => phonemeHint(word.worstPhoneme ?? undefined)).find(Boolean)
      ?? "Observe os sons destacados e articule-os com clareza.";
  const words = phrase.text.split(/(\s+)/u);

  return (
    <article className="rp-phrase">
      <p lang="en" className="rp-sentence-text">
        {words.map((part, index) => {
          const clean = part.replace(/[^\p{L}'-]/gu, "").toLowerCase();
          const isProblemWord = problemWords.some((word) => word.word.toLowerCase() === clean);

          return isProblemWord
            ? <span key={index} className="rp-problem-word">{part}</span>
            : part;
        })}
      </p>
      <p className="rp-hint mt-2">{t(hint)}</p>
      <p className="rp-phrase-ref">{t("Resposta ")}{phrase.ordinal}</p>
      <div className="rp-player-row">
        {phrase.clip && (
          <button type="button" className="ds-btn ds-btn-soft" onClick={playSelf}>
            <Play className="size-4" aria-hidden="true" />
            {t(playing === "self" ? "Reproduzindo" : "Você")}
          </button>
        )}
        <button type="button" className="ds-btn ds-btn-soft" onClick={playModel}>
          <Play className="size-4" aria-hidden="true" />
          {t(playing === "model" ? "Reproduzindo" : "Como soa")}
        </button>
      </div>
      {message && <p className="rp-hint" role="status">{t(message)}</p>}
    </article>
  );
}

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
  children,
}: {
  title: string;
  description: string;
  id: string;
  children?: ReactNode;
}) {
  return (
    <header className={`rp-section-heading${children ? " rp-section-heading-with-control" : ""}`}>
      <div className="rp-section-heading-copy">
        <h2 id={id} className="ds-h2">{t(title)}</h2>
        <p className="rp-hint mt-1">{t(description)}</p>
      </div>
      {children}
    </header>
  );
}

function ReadyReport({
  result,
  turns,
  azureSummary,
  coverage,
}: {
  result: InterviewReportResult;
  turns: Turns;
  azureSummary: AzureMetricSummary;
  coverage: { available: number; pending: number; total: number };
}) {
  const answers = azureSummary.answers ?? [];
  const tiles = deriveOverviewTiles(result, answers);
  const phrases = flattenAndRankPhrases(answers, turns);
  const patterns = groupPatternsByType(turns.flatMap((turn) => findingsForAnswer(result, turn.sequenceNumber).patterns));
  const [showAllPatterns, setShowAllPatterns] = useState(false);
  const [slow, setSlow] = useState(false);
  const reference = (sequenceNumber: number) => answerOrdinalForSequence(turns, sequenceNumber);
  const allPatterns = patterns.flatMap((group) => group.items);
  const visiblePatterns = showAllPatterns ? allPatterns : allPatterns.slice(0, 4);
  const patternCount = allPatterns.length;

  return (
    <div className="rp-stack rp-ready">
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
      </section>
      {phrases.length > 0 && (
        <section className="rp-section" aria-labelledby="phrases-title">
          <SectionHeading
            id="phrases-title"
            title="Frases para ouvir"
            description="Escute trechos curtos e compare sua fala com uma pronúncia clara."
          >
            <label className="ds-toggle rp-speed-toggle">
              <input
                type="checkbox"
                className="ds-switch"
                checked={slow}
                onChange={(event) => setSlow(event.target.checked)}
              />
              {t("Mais devagar")}
            </label>
          </SectionHeading>
          <div className="rp-phrase-grid">
            {phrases.map((phrase) => (
              <PhrasePlayer
                key={`${phrase.sequenceNumber}-${phrase.phraseIndex}`}
                phrase={phrase}
                slow={slow}
              />
            ))}
          </div>
        </section>
      )}
      {answers.length > 0 && phrases.length === 0 && (
        <section className="rp-section" aria-labelledby="voice-phrases-empty">
          <p id="voice-phrases-empty" className="rp-hint">
            {t("Nenhuma frase com problema claro de pronúncia nesta entrevista.")}
          </p>
        </section>
      )}
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
              <span className="rp-pattern-eyebrow">
                {t(patternTypeLabels[pattern.type] ?? pattern.type)}
              </span>
              <p lang="en">
                <span className="rp-quiet-label">{t("Você disse")}</span>
                <br />
                {pattern.evidence}
              </p>
              <p lang="en" className="rp-rephrase-text">
                <span className="rp-quiet-label">{t("Mais natural")}</span>
                <br />
                {pattern.rephrasedExample}
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
            <p className="rp-priority-item" key={index}>
              <strong>{item.focus}</strong>
              {item.evidence?.trim().split(/\s+/u).length >= 4 && (
                <span lang="en">{item.evidence}</span>
              )}
              <span className="rp-phrase-ref">{t("Resposta ")}{reference(item.sequenceNumber)}</span>
            </p>
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

export function InterviewReport({ config, elapsed, totalClock, answerCount, persistenceLabel, persistenceMessage, feedbackSyncMessage, reportState, reportCaption, turns, azureSummary, coverage, onLeave, currentInterviewId, historical = false }: {
  config: InterviewConfig; elapsed: string; totalClock: string; answerCount: number; persistenceLabel: string; persistenceMessage: string | null; feedbackSyncMessage: string | null; reportState: ReportState; progressRecords: ProgressRecord[]; currentInterviewId?: string; historical?: boolean; reportCaption: string; turns: Turns; azureSummary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; onLeave: () => void;
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
  return (
    <section className="rp-root mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
      {historical && <button type="button" className="ds-btn ds-btn-quiet mb-3" onClick={onLeave}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {getCurrentLocale() === "en" ? "Back to Progress" : t("Voltar ao Progresso")}
        </button>}
      <header className="rp-hero ds-enter">
        <p className="rp-eyebrow">{t("Prática concluída")}</p>
        <h1 id="interview-complete-title" className="font-display text-balance rp-title">
          {t("Seu relatório de entrevista")}
        </h1>
        <p className="ds-body mt-3 max-w-[60ch]">
          {t(persistenceLabel)}. {t("As respostas foram transcritas; trechos disponíveis podem ser reproduzidos neste relatório.")}
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
            <p className="ds-body mt-3">
              {t(reportCaption)}. {t("A análise não avalia seu sotaque.")}
            </p>
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
          />
        ) : null}
      </div>
      <div className="rp-foot">
        <p className="rp-hint">{persistenceLabel}</p>
        <button type="button" className="ds-btn ds-btn-cta-green rp-back" onClick={onLeave}>{t(historical ? "Voltar ao Progresso " : "Voltar ao dashboard ")}
          <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
