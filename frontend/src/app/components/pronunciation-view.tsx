"use client";

import { useEffect, useMemo, useState } from "react";
import { AudioLines, Play } from "lucide-react";
import { useLocale } from "@/lib/locale";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { getAnswerClipUrl, purgeExpiredAnswerClips } from "@/lib/interview/answer-clips";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { buildPronunciationInsights, type PronunciationPhrase } from "@/lib/interview/pronunciation-insights.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { PageIntro } from "./shared";
import "./pronunciation.css";

const speechEndpoint = `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/speech`;

function emphasizedPhrase(phrase: PronunciationPhrase) {
  const words = [...new Set(phrase.problemWords.map(({ word }) => word.toLocaleLowerCase()))];
  if (!words.length) return phrase.text;
  const escapedWords = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const pattern = new RegExp(`\\b(${escapedWords.join("|")})\\b`, "giu");
  const parts = phrase.text.split(pattern);
  return parts.map((part, index) => words.includes(part.toLocaleLowerCase()) ? <u key={`${part}-${index}`} className="pr-word">{part}</u> : part);
}

function playUrl(url: string) {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("audio playback failed"));
    void audio.play().catch(reject);
  });
}

export function PronunciationView({ onStart }: { onStart?: () => void } = {}) {
  const { locale, t } = useLocale();
  const [cached] = useState(() => readDashboardCache("progress") as ProgressRecord[] | undefined);
  const [records, setRecords] = useState<ProgressRecord[]>(() => cached ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [unavailableClips, setUnavailableClips] = useState<Set<string>>(() => new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const insights = useMemo(() => buildPronunciationInsights(records), [records]);

  useEffect(() => { void purgeExpiredAnswerClips(); }, []);
  useEffect(() => {
    let active = true;
    void loadProgressRecords().then((result) => {
      if (!active) return;
      if (result.ok) { setRecords(result.value); setError(false); }
      else if (!cached) { setRecords([]); setError(true); }
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [attempt, cached]);

  const playSpeech = async (text: string, key: string) => {
    setPlaying(key);
    let objectUrl: string | null = null;
    try {
      const blob = await fetchSpeechBlob(text, { endpoint: speechEndpoint, fetcher: authorizedFetch });
      objectUrl = URL.createObjectURL(blob);
      await playUrl(objectUrl);
    } catch { /* Speech playback is optional; keep the practice screen calm. */ }
    finally { if (objectUrl) URL.revokeObjectURL(objectUrl); setPlaying(null); }
  };

  const playCandidate = async (phrase: PronunciationPhrase) => {
    const path = phrase.clipPath;
    if (!path) return;
    setPlaying(`you-${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`);
    try {
      const url = await getAnswerClipUrl(path);
      if (!url) {
        setUnavailableClips((previous) => new Set(previous).add(path));
        return;
      }
      await playUrl(url);
    } catch {
      setUnavailableClips((previous) => new Set(previous).add(path));
    } finally { setPlaying(null); }
  };

  const retry = () => { setIsLoading(true); setError(false); setAttempt((value) => value + 1); };

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <PageIntro title={t("Pronúncia")} description={t("Perceba os sons que se repetem e ouça como eles aparecem nas suas respostas.")} />
      {isLoading ? <section className="mt-8 space-y-5" aria-busy="true" aria-label={t("Carregando pronúncia")}><div className="skeleton h-36 w-full !rounded-[var(--ds-r-card)]" /><div className="skeleton h-56 w-full !rounded-[var(--ds-r-card)]" /></section> : error ? (
        <section className="mt-8 rounded-[var(--ds-r-card)] bg-[var(--ds-surface)] p-6" role="alert"><p className="ds-h2">{t("Não foi possível carregar suas frases agora.")}</p><button type="button" className="ds-btn ds-btn-soft mt-4" onClick={retry}>{t("Tentar novamente")}</button></section>
      ) : insights.phrases.length === 0 ? (
        <section className="pr-empty ds-card ds-enter mt-8 p-6 sm:p-8">
          <AudioLines className="size-6 text-[var(--ds-green)]" aria-hidden="true" />
          <p className="ds-body">{t("Suas frases aparecem aqui depois da próxima entrevista.")}</p>
          {onStart && <button type="button" className="ds-btn ds-btn-cta-green" onClick={onStart}><Play className="size-4 fill-current" aria-hidden="true" />{t("Começar entrevista")}</button>}
        </section>
      ) : (
        <div className="pr-content mt-8 lg:mt-10">
          {insights.families.length > 0 && <section aria-labelledby="pr-families-title">
            <h2 id="pr-families-title" className="ds-h2">{t("Sons que mais aparecem")}</h2>
            <div className="pr-families mt-4">{insights.families.slice(0, 4).map((family, index) => (
              <article className="pr-family ds-card ds-enter" style={{ "--i": index } as React.CSSProperties} key={family.id}>
                <h3 className="pr-family-title">{t(family.label)}</h3>
                <p className="ds-small mt-1">{t("apareceu em {count} frases", { count: family.count })}{family.examples.length > 0 ? ` · ${family.examples.join(", ")}` : ""}</p>
                <p className="ds-body mt-3">{t(family.tip)}</p>
                <button type="button" className="ds-btn ds-btn-quiet mt-3" onClick={() => void playSpeech(family.examples.join(", ") || insights.phrases.find((phrase) => phrase.issue === "intonation")?.text || family.label, `family-${family.id}`)} disabled={playing === `family-${family.id}`}><Play className="size-4 fill-current" aria-hidden="true" />{playing === `family-${family.id}` ? t("Preparando áudio") : t("Como soa")}</button>
              </article>
            ))}</div>
          </section>}
          <section aria-labelledby="pr-phrases-title">
            <h2 id="pr-phrases-title" className="ds-h2">{t("Suas frases")}</h2>
            <ul className="pr-phrases mt-4">{insights.phrases.map((phrase) => {
              const key = `you-${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`;
              const date = phrase.date ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "pt-BR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(phrase.date)) : t("Data indisponível");
              return <li className="pr-phrase ds-card" key={`${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`}>
                <p className="pr-phrase-text" lang="en">{emphasizedPhrase(phrase)}</p>
                <p className="ds-small mt-2">{date} · {t("Resposta {number}", { number: phrase.answerNumber })}</p>
                <div className="pr-actions mt-3">
                  {phrase.clipPath && !unavailableClips.has(phrase.clipPath) && <button type="button" className="ds-btn ds-btn-soft" onClick={() => void playCandidate(phrase)} disabled={playing === key}><Play className="size-4 fill-current" aria-hidden="true" />{t("Você")}</button>}
                  <button type="button" className="ds-btn ds-btn-quiet" onClick={() => void playSpeech(phrase.text, `tts-${key}`)} disabled={playing === `tts-${key}`}><Play className="size-4 fill-current" aria-hidden="true" />{t("Como soa")}</button>
                </div>
              </li>;
            })}</ul>
          </section>
        </div>
      )}
    </main>
  );
}
