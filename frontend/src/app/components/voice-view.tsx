"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Play } from "lucide-react";

import { authorizedFetch } from "@/lib/auth/backend-auth";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { getAnswerClipUrl, purgeExpiredAnswerClips } from "@/lib/interview/answer-clips";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { phonemeTip } from "@/lib/interview/report-presentation.mjs";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { buildVoiceInsights, type VoicePhrase } from "@/lib/interview/voice-insights.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { useLocale } from "@/lib/locale";

import { PageIntro } from "./shared";
import "./voice-view.css";

const speechEndpoint = `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/speech`;

function formatMetric(value: number | null) {
  return value === null ? "—" : Math.round(value).toString();
}

function highlightedPhrase(phrase: VoicePhrase) {
  const words = new Set(phrase.problemWords.map((word) => word.word.toLocaleLowerCase()));
  if (!words.size) return phrase.text;
  return phrase.text.split(/(\s+)/u).map((part, index) => {
    const clean = part.replace(/[^\p{L}'’-]/gu, "").toLocaleLowerCase();
    return words.has(clean) ? <span className="vv-problem-word" key={`${part}-${index}`}>{part}</span> : part;
  });
}

function PhraseCard({
  phrase,
  metric,
  slow,
  unavailableClips,
  onClipUnavailable,
}: {
  phrase: VoicePhrase;
  metric: "accuracy" | "fluency" | "prosody";
  slow: boolean;
  unavailableClips: Set<string>;
  onClipUnavailable: (path: string) => void;
}) {
  const { locale, t } = useLocale();
  const [playing, setPlaying] = useState<"self" | "model" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const key = `${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`;
  const date = phrase.date
    ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "pt-BR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(phrase.date))
    : t("Data indisponível");
  // Sound tips belong to precision; rhythm and prosody phrases get stress and phrasing tips instead.
  const hints = metric === "accuracy"
    ? phrase.problemWords.filter((word) => word.worstPhoneme)
    : phrase.problemWords.filter((word) => word.prosodyErrors.length > 0);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const playUrl = async (url: string, kind: "self" | "model", revoke = false) => {
    const audio = new Audio(url);
    audioRef.current?.pause();
    audioRef.current = audio;
    setPlaying(kind);
    audio.onended = () => {
      if (revoke) URL.revokeObjectURL(url);
      setPlaying(null);
    };
    audio.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      setPlaying(null);
    };
    try {
      await audio.play();
    } catch {
      if (revoke) URL.revokeObjectURL(url);
      setPlaying(null);
    }
  };

  const playCandidate = async () => {
    if (!phrase.clipPath) return;
    try {
      const url = await getAnswerClipUrl(phrase.clipPath);
      if (!url) {
        onClipUnavailable(phrase.clipPath);
        return;
      }
      await playUrl(url, "self");
    } catch {
      onClipUnavailable(phrase.clipPath);
    }
  };

  const playModel = async () => {
    setPlaying("model");
    try {
      const blob = await fetchSpeechBlob(phrase.text, {
        endpoint: speechEndpoint,
        fetcher: authorizedFetch,
        speed: slow ? 0.8 : 1,
      });
      await playUrl(URL.createObjectURL(blob), "model", true);
    } catch {
      setPlaying(null);
    }
  };

  return (
    <article className="vv-phrase ds-card" key={key}>
      <p className="vv-phrase-label ds-small">{t("Você disse")}</p>
      <p className="vv-phrase-text" lang="en">{highlightedPhrase(phrase)}</p>
      {metric === "accuracy" && hints.length > 0 && (
        <ul className="vv-word-tips">
          {hints.map((word, index) => (
            <li key={`${word.word}-${index}`}>
              <strong lang="en">{word.word}</strong>
              <span>{t(phonemeTip(word.worstPhoneme ?? "", word.word))}</span>
            </li>
          ))}
        </ul>
      )}
      {metric !== "accuracy" && hints.length > 0 && (
        <p className="vv-word-tips">
          {t("Palavras para destacar: ")}
          <strong lang="en">{[...new Set(hints.map((word) => word.word))].join(", ")}</strong>
        </p>
      )}
      <p className="vv-phrase-meta">{date} · {t("Resposta {number}", { number: phrase.answerNumber })}</p>
      <div className="vv-phrase-actions">
        {phrase.clipPath && !unavailableClips.has(phrase.clipPath) && (
          <button type="button" className="ds-btn ds-btn-soft" onClick={() => void playCandidate()} disabled={playing !== null}>
            <Play className="size-4 fill-current" aria-hidden="true" />
            {t(playing === "self" ? "Reproduzindo" : "Você")}
          </button>
        )}
        <button type="button" className="ds-btn ds-btn-quiet" onClick={() => void playModel()} disabled={playing !== null}>
          <Play className="size-4 fill-current" aria-hidden="true" />
          {t(playing === "model" ? "Reproduzindo" : "Como deveria soar")}
        </button>
      </div>
    </article>
  );
}

export function VoiceView({ onStart }: { onStart?: () => void } = {}) {
  const { t } = useLocale();
  const [cached] = useState(() => readDashboardCache("progress") as ProgressRecord[] | undefined);
  const [records, setRecords] = useState<ProgressRecord[]>(() => cached ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [unavailableClips, setUnavailableClips] = useState<Set<string>>(() => new Set());
  const insights = useMemo(() => buildVoiceInsights(records), [records]);
  const sections = useMemo(() => [...insights.metrics].sort((first, second) => Number(second.key === insights.focus) - Number(first.key === insights.focus)), [insights]);

  useEffect(() => {
    void purgeExpiredAnswerClips();
  }, []);

  useEffect(() => {
    let active = true;
    void loadProgressRecords().then((result) => {
      if (!active) return;
      if (result.ok) {
        setRecords(result.value);
        setError(false);
      } else if (!cached) {
        setRecords([]);
        setError(true);
      }
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [attempt, cached]);

  const retry = () => {
    setIsLoading(true);
    setError(false);
    setAttempt((value) => value + 1);
  };

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <PageIntro title={t("Sua voz")} description={t("Como sua fala soa nas entrevistas e o que treinar em cada ponto.")} />
      {isLoading ? (
        <section className="mt-8 space-y-5" aria-busy="true" aria-label={t("Carregando sua voz")}>
          <div className="vv-skeleton-grid">
            <div className="skeleton h-44 w-full !rounded-[var(--ds-r-card)]" />
            <div className="skeleton h-44 w-full !rounded-[var(--ds-r-card)]" />
            <div className="skeleton h-44 w-full !rounded-[var(--ds-r-card)]" />
          </div>
          <div className="skeleton h-64 w-full !rounded-[var(--ds-r-card)]" />
        </section>
      ) : error ? (
        <section className="mt-8 rounded-[var(--ds-r-card)] bg-[var(--ds-surface)] p-6" role="alert">
          <p className="ds-h2">{t("Não foi possível carregar os dados da sua voz agora.")}</p>
          <button type="button" className="ds-btn ds-btn-soft mt-4" onClick={retry}>{t("Tentar novamente")}</button>
        </section>
      ) : !insights.hasVoiceData ? (
        <section className="vv-empty ds-card ds-enter mt-8 p-6 sm:p-8">
          <AudioLines className="size-6 text-[var(--ds-green)]" aria-hidden="true" />
          <p className="ds-body">{t("Sua análise de voz aparece aqui depois da próxima entrevista com respostas faladas.")}</p>
          {onStart && <button type="button" className="ds-btn ds-btn-cta-green" onClick={onStart}><Play className="size-4 fill-current" aria-hidden="true" />{t("Começar entrevista")}</button>}
        </section>
      ) : (
        <div className="vv-content mt-8 lg:mt-10">
          <section aria-labelledby="voice-metrics-title">
            <h2 id="voice-metrics-title" className="sr-only">{t("Métricas da sua voz")}</h2>
            <div className="vv-metric-grid">
              {insights.metrics.map((metric) => (
                <article className="vv-metric ds-card" data-focus={metric.key === insights.focus} key={metric.key}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="ds-label">{t(metric.label)}</h3>
                    {metric.key === insights.focus && <span className="vv-focus-note">{t("Seu foco agora")}</span>}
                  </div>
                  <p className="vv-metric-value">{formatMetric(metric.value)}<span>/ 100</span></p>
                  {metric.previousAverage !== null ? <p className="vv-change">{t("{before} → {after} desde as últimas entrevistas", { before: Math.round(metric.previousAverage), after: Math.round(metric.value ?? 0) })}</p> : <p className="vv-change">{metric.reliability === "limited" ? t("Estimativa: ainda há pouco áudio avaliado.") : metric.reliability === "insufficient" ? t("Ainda não há áudio suficiente para mostrar um número.") : t("Ainda não há comparação suficiente.")}</p>}
                  <p className="ds-body mt-3">{t(metric.measure)}</p>
                </article>
              ))}
            </div>
            <p className="vv-disclaimer ds-small">{t("Estas métricas não medem seu nível de inglês nem seu sotaque. A prosódia pode ficar mais baixa para falantes de português mesmo com boa inteligibilidade.")}</p>
          </section>
          <label className="ds-toggle vv-speed-toggle">
            <input type="checkbox" className="ds-switch" checked={slow} onChange={(event) => setSlow(event.target.checked)} />
            {t("Mais devagar")}
          </label>
          {sections.map((metric) => (
            <section className="vv-section" aria-labelledby={`voice-${metric.key}`} key={metric.key}>
              <h2 id={`voice-${metric.key}`} className="ds-h2">{t(metric.heading)}</h2>
              <ul className="vv-tips">
                {metric.tips.map((tip, index) => <li key={`${metric.key}-${index}`}>{t(typeof tip === "string" ? tip : tip.key, typeof tip === "string" ? undefined : tip.values)}</li>)}
              </ul>
              <h3 className="vv-phrases-heading">{t("Frases para treinar")}</h3>
              {metric.phrases.length ? (
                <div className="vv-phrases">
                  {metric.phrases.map((phrase) => (
                    <PhraseCard
                      key={`${metric.key}-${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`}
                      phrase={phrase}
                      metric={metric.key}
                      slow={slow}
                      unavailableClips={unavailableClips}
                      onClipUnavailable={(path) => setUnavailableClips((previous) => new Set(previous).add(path))}
                    />
                  ))}
                </div>
              ) : <p className="ds-body mt-3">{t("Ainda não há uma frase salva para treinar este ponto.")}</p>}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
