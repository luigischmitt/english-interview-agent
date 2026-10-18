"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, AudioLines, LoaderCircle, Mic, Play, Square, Volume2 } from "lucide-react";

import { authorizedFetch } from "@/lib/auth/backend-auth";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { readStoredInterviewerSpeechSpeed } from "@/lib/interview/interviewer-speech-speed.mjs";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { readStoredInterviewerVoice } from "@/lib/interview/voice-picker.mjs";
import { buildVoiceInsights, buildVoiceLesson, buildVoicePracticePlan, encodeWav16Mono, readPracticeAttempts, savePracticeAttempt, type VoiceMetricKey, type VoicePracticeAttempt, type VoiceTip } from "@/lib/interview/voice-insights.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { useLocale } from "@/lib/locale";

import { PageIntro } from "./shared";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";
import "./voice-view.css";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const speechEndpoint = `${backendUrl}/api/v1/speech`;
const practiceEndpoint = `${backendUrl}/api/v1/voice/practice`;
const metricKeys: VoiceMetricKey[] = ["accuracy", "fluency", "prosody"];
const formatMetric = (value: number | null) => value === null ? "—" : Math.round(value).toString();

function HighlightedText({ text, words }: { text: string; words: string[] }) {
  const attention = new Set(words.map((word) => word.toLocaleLowerCase()));
  return <>{text.split(/(\s+)/u).map((part, index) => {
    const clean = part.replace(/[^\p{L}'’-]/gu, "").toLocaleLowerCase();
    return attention.has(clean) ? <span className="vv-problem-word" key={`${part}-${index}`}>{part}</span> : part;
  })}</>;
}

function LessonExample({ text, emphasis }: { text: string; emphasis: string[] }) {
  return <>{text.split(/(\s+)/u).map((part, index) => {
    const clean = part.replace(/[^\p{L}'’-]/gu, "").toLocaleLowerCase();
    return emphasis.some((word) => word.toLocaleLowerCase() === clean) ? <strong key={`${part}-${index}`}>{part}</strong> : part;
  })}</>;
}

function translateTip(t: (key: string, values?: Record<string, string | number>) => string, tip: VoiceTip) {
  return typeof tip === "string" ? t(tip) : t(tip.key, tip.values);
}

const metricLabel: Record<VoiceMetricKey, string> = { accuracy: "Precisão", fluency: "Ritmo", prosody: "Prosódia" };

function sameScores(first: VoicePracticeAttempt, second: VoicePracticeAttempt) {
  return metricKeys.every((key) => (first.scores[key] === null ? null : Math.round(first.scores[key]!)) === (second.scores[key] === null ? null : Math.round(second.scores[key]!)));
}

/** Latest attempt with full metric names, the change against the previous attempt and the words Azure flagged. */
function AttemptResult({ attempts, focus }: { attempts: VoicePracticeAttempt[]; focus: VoiceMetricKey }) {
  const { t } = useLocale();
  const latest = attempts.at(-1)!;
  const previous = attempts.length > 1 ? attempts.at(-2)! : null;
  const flagged = latest.words.some((word) => word.errorType && word.errorType !== "None");
  const history = attempts.map((attempt) => attempt.scores[focus]).filter((value): value is number => value !== null);
  const time = new Date(latest.createdAt);
  const when = Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <div className="vv-result" role="status" aria-live="polite">
    <div className="vv-result-head">
      <p className="ds-label">{attempts.length === 1 ? t("Sua primeira tentativa") : t("Tentativa {n}", { n: attempts.length })}{when && <span> · {when}</span>}</p>
      {previous && <p className="ds-small">{t("Comparada com a tentativa anterior")}</p>}
    </div>
    <div className="vv-scores">{metricKeys.map((key) => {
      const value = latest.scores[key];
      const before = previous?.scores[key] ?? null;
      const delta = value !== null && before !== null ? Math.round(value) - Math.round(before) : null;
      return <div className="vv-score" data-focus={key === focus} key={key}>
        <span className="vv-score-name">{t(metricLabel[key])}</span>
        <span className="vv-score-value">{formatMetric(value)}</span>
        {delta !== null && <span className="vv-score-delta" data-direction={delta > 0 ? "up" : delta < 0 ? "down" : "same"}>{delta > 0 ? `+${delta}` : delta === 0 ? t("igual") : delta}</span>}
        <span className="vv-score-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, value ?? 0))}%` }} /></span>
      </div>;
    })}</div>
    {latest.words.length > 0 && <>
      <p className="vv-attempt-words" lang="en">{latest.words.map((word, index) => <span className={word.errorType && word.errorType !== "None" ? "vv-problem-word" : ""} key={`${word.word}-${index}`}>{word.word}</span>)}</p>
      <p className="ds-small mt-1">{t(flagged ? "Em destaque: palavras que o Azure marcou nesta tentativa." : "Nenhuma palavra marcada nesta tentativa.")}</p>
    </>}
    {previous && sameScores(previous, latest) && <p className="vv-same ds-small">{t("Mesmo resultado da tentativa anterior. Tente outra vez exagerando a palavra destacada ou falando um pouco mais devagar.")}</p>}
    {history.length > 1 && <p className="vv-history ds-small">{t("{metric} nas suas tentativas", { metric: t(metricLabel[focus]) })}: <b>{history.map((value) => Math.round(value)).join(" → ")}</b></p>}
  </div>;
}

type Capture = { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; node: AudioWorkletNode; sink: GainNode; frames: Float32Array[]; timer: number; target: string; text: string };

export function VoiceView({ onStart }: { onStart?: () => void } = {}) {
  const { t } = useLocale();
  const [cached] = useState(() => readDashboardCache("progress") as ProgressRecord[] | undefined);
  const [records, setRecords] = useState<ProgressRecord[]>(() => cached ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [selectedMetric, setSelectedMetric] = useState<VoiceMetricKey | null>(null);
  const [activeCapture, setActiveCapture] = useState<string | null>(null);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<"sentence" | "word">("sentence");
  const [attempts, setAttempts] = useState<Record<string, VoicePracticeAttempt[]>>(() => typeof window === "undefined" ? {} : readPracticeAttempts(window.localStorage));
  const captureRef = useRef<Capture | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trainingRef = useRef<HTMLElement | null>(null);
  const insights = useMemo(() => buildVoiceInsights(records), [records]);
  const plan = useMemo(() => buildVoicePracticePlan(records), [records]);
  const activeMetric = selectedMetric ?? insights.focus ?? "accuracy";
  const lesson = useMemo(() => buildVoiceLesson(records, activeMetric), [records, activeMetric]);
  const currentSentenceIndex = Math.min(sentenceIndex, Math.max(0, plan.sentences.length - 1));
  const sentence = plan.sentences[currentSentenceIndex] ?? null;

  useEffect(() => {
    let active = true;
    void loadProgressRecords().then((result) => {
      if (!active) return;
      if (result.ok) { setRecords(result.value); setError(false); } else if (!cached) { setRecords([]); setError(true); }
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [cached, reload]);

  const playText = async (text: string) => {
    setMessage(null);
    try {
      const blob = await fetchSpeechBlob(text, { endpoint: speechEndpoint, fetcher: authorizedFetch, voice: readStoredInterviewerVoice(window.localStorage), speed: readStoredInterviewerSpeechSpeed(window.localStorage) });
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = audio.onerror = () => URL.revokeObjectURL(audio.src);
      await audio.play();
    } catch { setMessage(t("Não foi possível reproduzir o áudio agora.")); }
  };

  const assess = async (target: string, text: string, samples: Float32Array[]) => {
    setAssessing(target); setMessage(null);
    try {
      const length = samples.reduce((sum, item) => sum + item.length, 0);
      const merged = new Float32Array(Math.min(length, 320_000));
      let offset = 0;
      for (const frame of samples) { if (offset >= merged.length) break; merged.set(frame.subarray(0, merged.length - offset), offset); offset += frame.length; }
      const response = await authorizedFetch(`${practiceEndpoint}?text=${encodeURIComponent(text)}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: encodeWav16Mono(merged) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.code;
        setMessage(t(code === "PRACTICE_DAILY_LIMIT" ? "Você chegou ao limite de treinos de hoje." : code === "PRACTICE_UNAVAILABLE" ? "O treino de voz está indisponível agora. Tente novamente em instantes." : "Não foi possível avaliar esta gravação. Tente novamente."));
        return;
      }
      const attempt: VoicePracticeAttempt = { scores: { accuracy: Number.isFinite(body?.scores?.accuracy) ? body.scores.accuracy : null, fluency: Number.isFinite(body?.scores?.fluency) ? body.scores.fluency : null, prosody: Number.isFinite(body?.scores?.prosody) ? body.scores.prosody : null }, words: Array.isArray(body?.words) ? body.words.map((word: { word?: unknown; accuracyScore?: unknown; errorType?: unknown }) => ({ word: typeof word.word === "string" ? word.word : "", accuracyScore: Number.isFinite(word.accuracyScore) ? Number(word.accuracyScore) : null, errorType: typeof word.errorType === "string" ? word.errorType : null })).filter((word: { word: string }) => word.word) : [], createdAt: new Date().toISOString() };
      setAttempts(savePracticeAttempt(window.localStorage, target, attempt));
    } catch { setMessage(t("Não foi possível avaliar esta gravação. Verifique sua conexão e tente novamente.")); }
    finally { setAssessing(null); }
  };

  async function stopRecording(submit = true) {
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    window.clearTimeout(capture.timer);
    try { capture.source.disconnect(); capture.node.disconnect(); capture.sink.disconnect(); } catch { /* Already disconnected. */ }
    stopMediaStreamTracks(capture.stream);
    await capture.context.close().catch(() => {});
    setActiveCapture(null);
    if (submit && capture.frames.length) await assess(capture.target, capture.text, capture.frames);
  }

  const startRecording = async (target: string, text: string) => {
    if (captureRef.current) return;
    setMessage(null);
    setMessageTarget(target.startsWith("word:") ? "word" : "sentence");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const context = new AudioContext();
      await context.audioWorklet.addModule("/pcm-capture-processor.js");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm-capture-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const sink = context.createGain(); sink.gain.value = 0;
      const frames: Float32Array[] = [];
      node.port.onmessage = (event) => { if (event.data?.type === "frame" && event.data.samples) frames.push(new Float32Array(event.data.samples)); };
      source.connect(node); node.connect(sink); sink.connect(context.destination);
      const timer = window.setTimeout(() => { void stopRecording(); }, 20_000);
      captureRef.current = { stream, context, source, node, sink, frames, timer, target, text };
      setActiveCapture(target);
    } catch (reason) {
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError";
      setMessage(t(denied ? "Permita o uso do microfone para gravar seu treino." : "Não foi possível abrir o microfone agora. Tente novamente."));
    }
  };

  useEffect(() => () => {
    const capture = captureRef.current;
    if (capture) {
      window.clearTimeout(capture.timer);
      try { capture.source.disconnect(); capture.node.disconnect(); capture.sink.disconnect(); } catch { /* Already disconnected. */ }
      stopMediaStreamTracks(capture.stream);
      void capture.context.close().catch(() => {});
    }
    audioRef.current?.pause();
  }, []);
  const retry = () => { setIsLoading(true); setError(false); setReload((value) => value + 1); };
  const nextSentence = () => setSentenceIndex((value) => plan.sentences.length ? (value + 1) % plan.sentences.length : 0);
  const practiceNow = () => trainingRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  return <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
    <PageIntro
      title={t("Sua voz")}
      description={t("Repita frases suas, ouça com calma e acompanhe o que muda a cada tentativa.")}
    />
    {isLoading ? <section className="mt-8 space-y-5" aria-busy="true" aria-label={t("Carregando sua voz")}>
      <div className="vv-skeleton-grid">
        <div className="skeleton h-36 w-full !rounded-[var(--ds-r-card)]" />
        <div className="skeleton h-36 w-full !rounded-[var(--ds-r-card)]" />
        <div className="skeleton h-36 w-full !rounded-[var(--ds-r-card)]" />
      </div>
      <div className="skeleton h-80 w-full !rounded-[var(--ds-r-card)]" />
    </section> : error ? <section className="mt-8 rounded-[var(--ds-r-card)] bg-[var(--ds-surface)] p-6" role="alert">
      <p className="ds-h2">{t("Não foi possível carregar os dados da sua voz agora.")}</p>
      <button type="button" className="ds-btn ds-btn-soft mt-4" onClick={retry}>{t("Tentar novamente")}</button>
    </section> : !insights.hasVoiceData ? <section className="vv-empty ds-card ds-enter mt-8 p-6 sm:p-8">
      <AudioLines className="size-6 text-[var(--ds-green)]" aria-hidden="true" />
      <p className="ds-body">{t("Sua análise de voz aparece aqui depois da próxima entrevista com respostas faladas.")}</p>
      {onStart && <button type="button" className="ds-btn ds-btn-cta-green" onClick={onStart}>
        <Play className="size-4 fill-current" aria-hidden="true" />
        {t("Começar entrevista")}
      </button>}
    </section> : <div className="vv-content mt-8 lg:mt-10">
            <section aria-labelledby="voice-metrics-title">
              <h2 id="voice-metrics-title" className="sr-only">{t("Métricas da sua voz")}</h2>
              <div className="vv-metric-grid">{insights.metrics.map((metric) => <article className="vv-metric ds-card" data-focus={metric.key === insights.focus} key={metric.key}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="ds-label">{t(metric.label)}</h3>
                  {metric.key === insights.focus && <span className="vv-focus-note">{t("Seu foco agora")}</span>}
                </div>
                <p className="vv-metric-value">{formatMetric(metric.value)}<span>/ 100</span></p>
                <p className="vv-change">{metric.previousAverage !== null ? t("{before} → {after} desde as últimas entrevistas", { before: Math.round(metric.previousAverage), after: Math.round(metric.value ?? 0) }) : t("Ainda não há comparação suficiente.")}</p>
                <p className="ds-body mt-3">{t(metric.measure)}</p>
              </article>)}</div>
              <p className="vv-disclaimer ds-small">{t("Estas métricas não medem seu nível de inglês nem seu sotaque. A prosódia pode ficar mais baixa para falantes de português mesmo com boa inteligibilidade.")}</p>
            </section>
            <section className="vv-lesson vv-section" aria-labelledby="how-to-improve">
              <h2 id="how-to-improve" className="ds-h2">{t("Como melhorar")}</h2>
              <SlidingSegmented
                name="voice-lesson"
                ariaLabel={t("Escolha um aspecto da sua voz para aprender")}
                options={metricKeys.map((key) => ({ value: key, label: t(key === "accuracy" ? "Precisão" : key === "fluency" ? "Ritmo" : "Prosódia") }))}
                value={activeMetric}
                onChange={(value) => setSelectedMetric(value as VoiceMetricKey)}
                className="grid-cols-3 w-full sm:w-[24rem]"
              />
              <p className="vv-lesson-measure ds-body">{t(lesson.measure)}</p>
              <div className="vv-lesson-detail">
                <h3 className="ds-label">{t("O que fazer")}</h3>
                <ul>{lesson.techniques.map((technique) => <li key={technique}>{t(technique)}</li>)}</ul>
              </div>
              {lesson.personalized.length > 0 && <div className="vv-lesson-detail">
                <h3 className="ds-label">{t("No seu caso")}</h3>
                <ul>{lesson.personalized.map((tip, index) => <li key={typeof tip === "string" ? tip : `${tip.key}-${index}`}>{translateTip(t, tip)}</li>)}</ul>
              </div>}
              <div className="vv-lesson-example">
                <h3 className="ds-label">{t("Exemplo")}</h3><p lang="en"><LessonExample text={lesson.example.text} emphasis={lesson.example.emphasis} /></p>
                <button type="button" className="ds-btn ds-btn-quiet" onClick={() => void playText(lesson.example.text)} disabled={activeCapture !== null || assessing !== null}><Volume2 className="size-4" aria-hidden="true" />{t("Ouvir")}</button>
              </div>
              <button type="button" className="ds-btn ds-btn-quiet vv-practice-now" onClick={practiceNow}>{t("Praticar agora")}<ArrowRight className="size-4 ds-arrow" aria-hidden="true" /></button>
            </section>
            <section ref={trainingRef} className="vv-section" aria-labelledby="today-training"><h2 id="today-training" className="ds-h2">{t("Treino de hoje · foco em {metric}", { metric: t(lesson.label).toLocaleLowerCase() })}</h2>{sentence ? <article className="vv-training ds-card"><div className="vv-training-top"><p className="ds-small">{t("Frase completa da sua entrevista")}</p><p className="ds-small">{t("{current} de {total}", { current: currentSentenceIndex + 1, total: plan.sentences.length })}</p></div><p className="vv-training-sentence" lang="en"><HighlightedText text={sentence.text} words={sentence.attentionWords} /></p><div className="vv-training-actions"><div className="vv-training-primary-actions"><button type="button" className="ds-btn ds-btn-soft" onClick={() => void playText(sentence.text)} disabled={activeCapture !== null || assessing !== null}><Volume2 className="size-4" aria-hidden="true" />{t("Ouvir")}</button>{activeCapture === sentence.id ? <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => void stopRecording()}><Square className="size-4 fill-current" aria-hidden="true" />{t("Parar")}</button> : <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => void startRecording(sentence.id, sentence.text)} disabled={activeCapture !== null || assessing !== null}><Mic className="size-4" aria-hidden="true" />{assessing === sentence.id && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{t("Gravar")}</button>}</div><button type="button" className="ds-btn ds-btn-quiet vv-next-sentence" onClick={nextSentence} disabled={activeCapture !== null || plan.sentences.length < 2}>{t("Próxima frase")}<ArrowRight className="size-4 ds-arrow" aria-hidden="true" /></button></div>{activeCapture === sentence.id ? <p className="vv-status ds-small" role="status"><span className="vv-rec-dot" aria-hidden="true" />{t("Gravando. Leia a frase e toque em Parar.")}</p> : assessing === sentence.id ? <p className="vv-status ds-small" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("Avaliando sua gravação…")}</p> : null}{message && messageTarget !== "word" && <p className="vv-message mt-4" role="alert">{message}</p>}{attempts[sentence.id]?.length ? <AttemptResult attempts={attempts[sentence.id]} focus={activeMetric} /> : <p className="ds-body mt-4">{t("Grave uma tentativa para ver suas métricas e as palavras avaliadas.")}</p>}</article> : <p className="ds-body mt-3">{t("Ainda não há frases completas e confiáveis das suas entrevistas para repetir.")}</p>}</section>
            <section className="vv-section" aria-labelledby="work-words"><h2 id="work-words" className="ds-h2">{t("Suas palavras de trabalho")}</h2>{plan.words.length ? <div className="vv-words">{plan.words.map((word) => { const key = `word:${word.word}`; const latest = attempts[key]?.at(-1); return <article className="vv-word ds-card" key={word.word}><p lang="en" className="vv-word-name">{word.word}</p><div className="vv-word-actions"><button type="button" className="ds-btn ds-btn-quiet" onClick={() => void playText(word.word)} disabled={activeCapture !== null || assessing !== null}><Volume2 className="size-4" aria-hidden="true" />{t("Ouvir")}</button>{activeCapture === key ? <button type="button" className="ds-btn ds-btn-soft" onClick={() => void stopRecording()}><Square className="size-4 fill-current" aria-hidden="true" />{t("Parar")}</button> : <button type="button" className="ds-btn ds-btn-soft" onClick={() => void startRecording(key, word.word)} disabled={activeCapture !== null || assessing !== null}><Mic className="size-4" aria-hidden="true" />{t("Gravar")}</button>}</div>{latest && <p className="vv-word-score">{t("Precisão")}: {formatMetric(latest.scores.accuracy)}</p>}</article>; })}</div> : <p className="ds-body mt-3">{t("Quando uma palavra relevante aparecer em mais entrevistas, ela fica disponível aqui.")}</p>}</section>
            <section className="vv-section" aria-labelledby="voice-evolution"><h2 id="voice-evolution" className="ds-h2">{t("Evolução")}</h2><div className="vv-evolution ds-card">{insights.metrics.map((metric) => { const points = plan.evolution[metric.key]; const delta = points.length > 1 ? Math.round(points.at(-1)!.value - points[0].value) : 0; return <div className="vv-evolution-row" key={metric.key}><div className="vv-evolution-label"><span className="ds-label">{t(metric.label)}</span>{delta !== 0 && <span className="vv-evolution-delta">{t("{delta} desde a primeira", { delta: `${delta > 0 ? "+" : ""}${delta}` })}</span>}</div>{points.length ? <div className="vv-evolution-series">{points.map((point, index) => <div className="vv-evolution-point" key={point.id}><span className="vv-evolution-value">{Math.round(point.value)}</span><span className="vv-evolution-bar" data-latest={index === points.length - 1} style={{ "--vv-value": `${point.value}%` } as CSSProperties} aria-label={t("{metric}: {value} em {date}", { metric: metric.label, value: Math.round(point.value), date: point.date ? new Date(point.date).toLocaleDateString() : t("data não disponível") })}><span /></span></div>)}</div> : <span className="ds-body">{t("Dados confiáveis ainda não disponíveis.")}</span>}</div>; })}</div></section>
            {message && messageTarget === "word" && <p className="vv-message" role="alert">{message}</p>}
          </div>}
  </main>;
}
