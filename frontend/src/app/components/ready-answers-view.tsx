"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Volume2 } from "lucide-react";
import { useLocale } from "@/lib/locale";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { loadAnsweredQuestions, requestPolishedAnswer, savePolishedAnswer, type AnsweredQuestion, type PolishedAnswer } from "@/lib/interview/polished-answers";
import "./ready-answers.css";

const backend = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export function ReadyAnswersView({ onStart }: { onStart: () => void }) {
  const { t, locale } = useLocale();
  const [questions, setQuestions] = useState<AnsweredQuestion[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [answerOpen, setAnswerOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    void loadAnsweredQuestions().then((result) => {
      if (!active) return;
      if (result.ok) setQuestions(result.value);
      else setLoadError(result.message);
    });
    return () => { active = false; };
  }, []);

  const generate = async (item: AnsweredQuestion, index: number) => {
    setLoading(index); setError("");
    try {
      const result = await requestPolishedAnswer({ question: item.question, answer: item.answer, ...(item.targetRole.trim() ? { roleContext: { targetRole: item.targetRole.trim().slice(0, 120) } } : {}), locale: locale === "en" ? "en" : "pt-BR" });
      const polishedAnswer: PolishedAnswer = { polishedAnswer: result.polishedAnswer, keyChanges: result.keyChanges, generatedAt: new Date().toISOString() };
      const saved = await savePolishedAnswer(item.interviewId, item.sequenceNumber, polishedAnswer);
      if (!saved.ok) throw new Error(saved.message);
      setQuestions((current) => current.map((question, at) => at === index ? { ...question, polishedAnswer } : question));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Não foi possível gerar sua versão pronta agora. Tente novamente."));
    } finally { setLoading(null); }
  };

  const listen = async (text: string, index: number) => {
    setPlaying(index); setError("");
    try {
      const blob = await fetchSpeechBlob(text, { endpoint: `${backend}/api/v1/speech`, fetcher: authorizedFetch });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPlaying(null); };
      audio.onerror = () => { URL.revokeObjectURL(url); setPlaying(null); setError(t("Não foi possível reproduzir o áudio agora. Tente novamente.")); };
      await audio.play();
    } catch {
      setPlaying(null); setError(t("Não foi possível reproduzir o áudio agora. Tente novamente."));
    }
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-4xl px-4 pb-28 pt-7 sm:px-8 sm:pb-12">
      <header className="ra-intro ds-enter">
        <h1 className="ds-h2">{t("Suas respostas prontas")}</h1>
        <p className="ds-body">{t("Revise versões mais claras das respostas que você já deu nas entrevistas.")}</p>
      </header>
      {loadError && <p className="ds-small ra-error" role="alert">{t(loadError)}</p>}
      {!loadError && questions.length === 0 ? (
        <section className="ds-card ra-empty ds-enter">
          <p className="ds-body">{t("Suas respostas vão aparecer aqui depois da primeira entrevista.")}</p>
          <button type="button" className="ds-btn ds-btn-cta-green" onClick={onStart}>{t("Começar entrevista")}</button>
        </section>
      ) : (
        <div className="ra-list">
          {questions.map((item, index) => {
            const isOpen = expanded === index;
            return (
              <article className="ds-card ra-item ds-enter" style={{ "--i": index } as React.CSSProperties} key={`${item.interviewId}-${item.sequenceNumber}`}>
                <button className="ra-question" type="button" aria-expanded={isOpen} onClick={() => { setExpanded(isOpen ? null : index); setError(""); }}>
                  <span lang="en">{item.question}</span><ChevronDown className="ra-chevron" aria-hidden="true" />
                </button>
                {isOpen && <div className="ra-content">
                  <button type="button" className="ra-answer-toggle ds-small" aria-expanded={answerOpen === index} onClick={() => setAnswerOpen(answerOpen === index ? null : index)}>{t("Sua resposta")} <ChevronDown className="ra-chevron" aria-hidden="true" /></button>
                  {answerOpen === index && <p className="ra-original ds-body" lang="en">{item.answer}</p>}
                  {item.polishedAnswer ? <div className="ra-polished" lang="en">
                    <p className="ra-polished-text">{item.polishedAnswer.polishedAnswer}</p>
                    <button type="button" className="ds-btn ds-btn-soft" onClick={() => void listen(item.polishedAnswer!.polishedAnswer, index)} disabled={playing === index}><Volume2 aria-hidden="true" className="size-4" />{playing === index ? t("Preparando áudio") : t("Ouvir")}</button>
                    {item.polishedAnswer.keyChanges.length > 0 && <ul className="ra-changes">{item.polishedAnswer.keyChanges.map((change, at) => <li key={`${at}-${change.from}`}><span>{change.from} → {change.to}</span><small>{change.note}</small></li>)}</ul>}
                  </div> : <button type="button" className="ds-btn ds-btn-cta-green ra-generate" disabled={loading === index} onClick={() => void generate(item, index)}>{loading === index ? t("Preparando sua versão…") : t("Gerar versão pronta")}</button>}
                  {error && <p className="ra-error ds-small" role="alert">{t(error)}</p>}
                </div>}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
