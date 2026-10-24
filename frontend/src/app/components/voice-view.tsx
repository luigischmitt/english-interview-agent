"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LoadingRegion, Sk, SkCard, SkChart } from "@/components/ui/loading-state";
import { ArrowRight, AudioLines, LoaderCircle, Mic, Play, Square, Volume2 } from "lucide-react";

import { authorizedFetch } from "@/lib/auth/backend-auth";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { readStoredInterviewerSpeechSpeed } from "@/lib/interview/interviewer-speech-speed.mjs";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { fetchSpeechBlob, playInterviewerSegments, prewarmInterviewerSpeech, splitInterviewerSpeech } from "@/lib/interview/speech-playback.mjs";
import { readStoredInterviewerVoice } from "@/lib/interview/voice-picker.mjs";
import { buildVoiceInsights, buildVoiceLesson, buildVoicePracticePlan, buildVoiceTrainingPhrases, encodeWav16Mono, migrateLegacyPracticeAttempts, normalizePracticeSpokenText, readPracticeAttempts, savePracticeAttempt, type VoiceMetricKey, type VoicePracticeAttempt, type VoiceTip } from "@/lib/interview/voice-insights.mjs";
import { loadVoicePracticeAttempts, saveVoicePracticeAttempt, type VoicePracticeAssessment, type VoicePracticeSource } from "@/lib/interview/voice-practice-persistence";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { useLocale } from "@/lib/locale";

import { PageIntro } from "./shared";
import { CountUp } from "@/components/ui/count-up";
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
    if (/^\s*$/u.test(part)) return part;
    const clean = part.replace(/[^\p{L}'’-]/gu, "").toLocaleLowerCase();
    return attention.has(clean)
      ? <span className="vv-problem-word" key={`${part}-${index}`}>{part}</span>
      : <span key={`${part}-${index}`}>{part}</span>;
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
function AttemptResult({ attempts, focus, beforeAccuracy = null }: { attempts: VoicePracticeAttempt[]; focus: VoiceMetricKey; beforeAccuracy?: number | null }) {
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
        <span className="vv-score-value">{value === null ? "—" : <CountUp value={Math.round(value)} duration={700} />}</span>
        {delta !== null && <span className="vv-score-delta" data-direction={delta > 0 ? "up" : delta < 0 ? "down" : "same"}>{delta > 0 ? `+${delta}` : delta === 0 ? t("igual") : delta}</span>}
        <span className="vv-score-bar" aria-hidden="true"><i style={{ "--vv-score": Math.max(0.02, Math.min(1, (value ?? 0) / 100)) } as CSSProperties} /></span>
      </div>;
    })}</div>
    {beforeAccuracy !== null && latest.scores.accuracy !== null && <p className="ds-small">{t("Antes: {before}% · agora: {now}%", { before: Math.round(beforeAccuracy), now: Math.round(latest.scores.accuracy) })}</p>}
    {latest.words.length > 0 && <>
      <p className="vv-attempt-words" lang="en">{latest.words.map((word, index) => <span className={word.errorType && word.errorType !== "None" ? "vv-problem-word" : ""} key={`${word.word}-${index}`}>{word.word}</span>)}</p>
      <p className="ds-small mt-1">{t(flagged ? "Em destaque: palavras que o Azure marcou nesta tentativa." : "Nenhuma palavra marcada nesta tentativa.")}</p>
    </>}
    {previous && sameScores(previous, latest) && <p className="vv-same ds-small">{t("Mesmo resultado da tentativa anterior. Tente outra vez exagerando a palavra destacada ou falando um pouco mais devagar.")}</p>}
    {history.length > 1 && <p className="vv-history ds-small">{t("{metric} nas suas tentativas", { metric: t(metricLabel[focus]) })}: <b>{history.map((value) => Math.round(value)).join(" → ")}</b></p>}
  </div>;
}

type Capture = { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; node: AudioWorkletNode; sink: GainNode; frames: Float32Array[]; timer: number; target: string; text: string };
type SpeechPreview = { blob: Blob; url: string };

function speechPreviewKey(text: string, voice: string | undefined, speed: number) {
  return JSON.stringify([text, voice ?? "", speed]);
}

export function VoiceView({ onStart }: { onStart?: () => void } = {}) {
  const { t } = useLocale();
  const [cached] = useState(() => readDashboardCache("progress") as ProgressRecord[] | undefined);
  const [records, setRecords] = useState<ProgressRecord[]>(() => cached ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selectedSentenceId, setSelectedSentenceId] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<VoiceMetricKey | null>(null);
  const [activeCapture, setActiveCapture] = useState<string | null>(null);
  const [startingCapture, setStartingCapture] = useState<string | null>(null);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [loadingSpeech, setLoadingSpeech] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<"sentence" | "word">("sentence");
  const [attempts, setAttempts] = useState<Record<string, VoicePracticeAttempt[]>>(() => typeof window === "undefined" ? {} : readPracticeAttempts(window.localStorage));
  // Keep the entry history fixed for this visit so saving a result cannot reorder the active queue.
  const [practiceHistoryAtOpen] = useState(attempts);
  const captureRef = useRef<Capture | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const captureWorkletReadyRef = useRef<Promise<AudioContext> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechPreviewCacheRef = useRef(new Map<string, SpeechPreview>());
  const speechPreviewFlightsRef = useRef(new Map<string, Promise<SpeechPreview>>());
  const speechPrewarmsRef = useRef<Array<{ cancel: () => void }>>([]);
  const spokenPlaybackRef = useRef<{ cancel: () => void } | null>(null);
  const isMountedRef = useRef(true);
  const trainingRef = useRef<HTMLElement | null>(null);
  const insights = useMemo(() => buildVoiceInsights(records), [records]);
  const activeMetric = selectedMetric ?? insights.focus ?? "accuracy";
  const plan = useMemo(() => buildVoicePracticePlan(records, { focus: activeMetric, attempts: practiceHistoryAtOpen }), [records, activeMetric, practiceHistoryAtOpen]);
  const trainingPhrases = useMemo(() => buildVoiceTrainingPhrases(records), [records]);
  const lesson = useMemo(() => buildVoiceLesson(records, activeMetric), [records, activeMetric]);
  const selectedIndex = selectedSentenceId ? trainingPhrases.findIndex((item) => item.id === selectedSentenceId) : -1;
  const currentSentenceIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const sentence = trainingPhrases[selectedIndex >= 0 ? selectedIndex : 0] ?? null;

  useEffect(() => {
    let active = true;
    void loadProgressRecords().then((result) => {
      if (!active) return;
      if (result.ok) { setRecords(result.value); setError(false); } else if (!cached) { setRecords([]); setError(true); }
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [cached, reload]);

  useEffect(() => {
    if (isLoading || error) return;
    let active = true;
    const sources: VoicePracticeSource[] = trainingPhrases.map((target) => ({
      id: target.id,
      interviewId: target.interviewId,
      candidateSequenceNumber: target.candidateSequenceNumber,
      sourceKind: target.sourceKind,
      phraseIndex: target.phraseIndex,
      normalizedTarget: target.normalizedTarget,
      targetText: target.referenceText,
    }));
    const run = async () => {
      const local = migrateLegacyPracticeAttempts(window.localStorage, trainingPhrases);
      setAttempts(local);
      try {
        const remote = await loadVoicePracticeAttempts(sources);
        const merged: Record<string, VoicePracticeAttempt[]> = { ...remote };
        for (const source of sources) {
          for (const attempt of local[source.id] ?? []) {
            if (!attempt.id || merged[source.id]?.some((saved) => saved.id === attempt.id)) continue;
            try {
              const saved = await saveVoicePracticeAttempt(source, attempt.id, attempt);
              (merged[source.id] ??= []).push(saved);
            } catch {
              (merged[source.id] ??= []).push(attempt);
            }
          }
        }
        for (const rows of Object.values(merged)) rows.sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt));
        if (active) setAttempts(merged);
      } catch {
        if (active) setMessage(t("Não foi possível sincronizar o histórico. As tentativas novas ficarão salvas neste navegador até a conexão voltar."));
      }
    };
    void run();
    return () => { active = false; };
  }, [error, isLoading, t, trainingPhrases]);

  const speechPreferences = useCallback(() => ({
    voice: readStoredInterviewerVoice(window.localStorage),
    speed: readStoredInterviewerSpeechSpeed(window.localStorage),
  }), []);
  const loadSpeechPreview = useCallback((text: string) => {
    const { voice, speed } = speechPreferences();
    const key = speechPreviewKey(text, voice, speed);
    const cachedPreview = speechPreviewCacheRef.current.get(key);
    if (cachedPreview) return Promise.resolve(cachedPreview);
    const inFlight = speechPreviewFlightsRef.current.get(key);
    if (inFlight) return inFlight;
    const promise = fetchSpeechBlob(text, { endpoint: speechEndpoint, fetcher: authorizedFetch, voice, speed }).then((blob) => {
      const preview = { blob, url: URL.createObjectURL(blob) };
      if (!isMountedRef.current) {
        URL.revokeObjectURL(preview.url);
        throw new DOMException("Voice view unmounted", "AbortError");
      }
      speechPreviewCacheRef.current.set(key, preview);
      return preview;
    }).finally(() => speechPreviewFlightsRef.current.delete(key));
    speechPreviewFlightsRef.current.set(key, promise);
    return promise;
  }, [speechPreferences]);

  useEffect(() => () => { isMountedRef.current = false; }, []);

  const playText = async (text: string) => {
    setMessage(null);
    const { voice, speed } = speechPreferences();
    const key = speechPreviewKey(text, voice, speed);
    setLoadingSpeech(key);
    try {
      const segments = splitInterviewerSpeech(text);
      audioRef.current?.pause();
      spokenPlaybackRef.current?.cancel();
      if (segments.length > 1 || text.length > 120) {
        const playback = playInterviewerSegments(segments, {
          endpoint: speechEndpoint, fetcher: authorizedFetch, voice, speed,
          onPlaybackStarted: () => setLoadingSpeech((current) => current === key ? null : current),
        });
        spokenPlaybackRef.current = playback;
        const result = await playback.promise;
        if (result.status === "unavailable") setMessage(t("Não foi possível reproduzir o áudio agora."));
        return;
      }
      const preview = await loadSpeechPreview(text);
      const audio = new Audio(preview.url);
      audioRef.current = audio;
      audio.onplaying = () => setLoadingSpeech((current) => current === key ? null : current);
      await audio.play();
    } catch { setMessage(t("Não foi possível reproduzir o áudio agora.")); }
    finally { setLoadingSpeech((current) => current === key ? null : current); }
  };

  const isSpeechLoading = (text: string) => {
    const { voice, speed } = speechPreferences();
    return loadingSpeech === speechPreviewKey(text, voice, speed);
  };

  useEffect(() => {
    const speechPrewarms = speechPrewarmsRef.current;
    const nextSentence = trainingPhrases[(currentSentenceIndex + 1) % trainingPhrases.length];
    const texts = [sentence?.referenceText, nextSentence?.referenceText, lesson.example.text].filter((text): text is string => Boolean(text));
    const seen = new Set<string>();
    for (const text of texts) {
      if (seen.has(text)) continue;
      seen.add(text);
      const segments = splitInterviewerSpeech(text);
      if (segments.length > 1 || text.length > 120) {
        const { voice, speed } = speechPreferences();
        const prewarm = prewarmInterviewerSpeech(segments, { endpoint: speechEndpoint, fetcher: authorizedFetch, voice, speed, retainMs: 60_000 });
        speechPrewarms.push(prewarm);
        void prewarm.promise;
      } else void loadSpeechPreview(text).catch(() => undefined);
    }
    return () => {
      for (const prewarm of speechPrewarms.splice(0)) prewarm.cancel();
    };
  }, [currentSentenceIndex, lesson.example.text, loadSpeechPreview, sentence?.referenceText, speechPreferences, trainingPhrases]);

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
      const assessment: VoicePracticeAssessment = { scores: { accuracy: Number.isFinite(body?.scores?.accuracy) ? body.scores.accuracy : null, fluency: Number.isFinite(body?.scores?.fluency) ? body.scores.fluency : null, prosody: Number.isFinite(body?.scores?.prosody) ? body.scores.prosody : null }, words: Array.isArray(body?.words) ? body.words.map((word: { word?: unknown; accuracyScore?: unknown; errorType?: unknown }) => ({ word: typeof word.word === "string" ? word.word : "", accuracyScore: Number.isFinite(word.accuracyScore) ? Number(word.accuracyScore) : null, errorType: typeof word.errorType === "string" ? word.errorType : null })).filter((word: { word: string }) => word.word) : [] };
      const attempt: VoicePracticeAttempt = { id: crypto.randomUUID(), ...assessment, createdAt: new Date().toISOString() };
      setAttempts(savePracticeAttempt(window.localStorage, target, attempt));
      const sourceTarget = trainingPhrases.find((item) => item.id === target);
      if (sourceTarget && attempt.id) {
        try {
          const source: VoicePracticeSource = { id: sourceTarget.id, interviewId: sourceTarget.interviewId, candidateSequenceNumber: sourceTarget.candidateSequenceNumber, sourceKind: sourceTarget.sourceKind, phraseIndex: sourceTarget.phraseIndex, normalizedTarget: sourceTarget.normalizedTarget, targetText: sourceTarget.referenceText };
          const saved = await saveVoicePracticeAttempt(source, attempt.id, assessment);
          setAttempts((current) => ({ ...current, [target]: [...(current[target] ?? []).filter((item) => item.id !== attempt.id), saved].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt)) }));
        } catch {
          setMessage(t("Tentativa avaliada e salva somente neste navegador. Ela será sincronizada quando a conexão voltar."));
        }
      }
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
    setActiveCapture(null);
    if (submit && capture.frames.length) await assess(capture.target, capture.text, capture.frames);
  }

  const startRecording = async (target: string, text: string) => {
    if (captureRef.current) return;
    setMessage(null);
    setMessageTarget(target.startsWith("word:") ? "word" : "sentence");
    setStartingCapture(target);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const context = await (captureWorkletReadyRef.current ??= (async () => {
        const prepared = captureContextRef.current ?? new AudioContext();
        captureContextRef.current = prepared;
        await prepared.audioWorklet.addModule("/pcm-capture-processor.js");
        return prepared;
      })());
      await context.resume();
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
    } finally { setStartingCapture(null); }
  };

  useEffect(() => () => {
    const capture = captureRef.current;
    if (capture) {
      window.clearTimeout(capture.timer);
      try { capture.source.disconnect(); capture.node.disconnect(); capture.sink.disconnect(); } catch { /* Already disconnected. */ }
      stopMediaStreamTracks(capture.stream);
    }
    void captureContextRef.current?.close().catch(() => {});
    audioRef.current?.pause();
    spokenPlaybackRef.current?.cancel();
    for (const prewarm of speechPrewarmsRef.current.splice(0)) prewarm.cancel();
    for (const preview of speechPreviewCacheRef.current.values()) URL.revokeObjectURL(preview.url);
  }, []);
  const retry = () => { setIsLoading(true); setError(false); setReload((value) => value + 1); };
  const nextSentence = () => {
    if (!trainingPhrases.length) return;
    const nextIndex = (currentSentenceIndex + 1) % trainingPhrases.length;
    setSelectedSentenceId(trainingPhrases[nextIndex].id);
  };
  const scrollTrainingIntoView = useCallback(() => {
    const training = trainingRef.current;
    if (!training) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tallCard = training.getBoundingClientRect().height > window.innerHeight - 80;
    training.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: tallCard ? "start" : "center" });
  }, []);
  useEffect(() => {
    if (selectedSentenceId) requestAnimationFrame(scrollTrainingIntoView);
  }, [scrollTrainingIntoView, selectedSentenceId]);
  const practiceNow = scrollTrainingIntoView;

  return <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
    <PageIntro
      kicker={t("Treino de voz")}
      title={t("Sua voz")}
      description={t("Repita frases suas, ouça com calma e acompanhe o que muda a cada tentativa.")}
    />
    {isLoading ? <LoadingRegion label={`${t("Carregando sua voz")}…`} className="mt-8 ld-fade">
      <div className="ld-grid-3">
        <SkCard minHeight="9rem" i={1} lines={1}><Sk h="3rem" w="45%" r="0.6rem" i={2} /></SkCard>
        <SkCard minHeight="9rem" i={3} lines={1}><Sk h="3rem" w="45%" r="0.6rem" i={4} /></SkCard>
        <SkCard minHeight="9rem" i={5} lines={1}><Sk h="3rem" w="45%" r="0.6rem" i={6} /></SkCard>
      </div>
      <SkCard minHeight="20rem" i={7}><SkChart bars={12} h="10rem" i={8} /></SkCard>
    </LoadingRegion> : error ? <section className="mt-8 rounded-[var(--ds-r-card)] bg-[var(--ds-surface)] p-6" role="alert">
      <p className="ds-h2">{t("Não foi possível carregar os dados da sua voz agora.")}</p>
      <button type="button" className="ds-btn ds-btn-soft mt-4" onClick={retry}>{t("Tentar novamente")}</button>
    </section> : !insights.hasVoiceData ? <div className="vv-empty-wrap mt-8">
      <section className="ds-card vv-empty">
        <AudioLines className="size-6 text-[var(--ds-green)]" aria-hidden="true" />
        <p className="ds-body">{t("Sua análise de voz aparece aqui depois da próxima entrevista com respostas faladas.")}</p>
        {onStart && <button type="button" className="ds-btn ds-btn-cta-green vv-cta" onClick={onStart}>
          <Play className="size-4 fill-current" aria-hidden="true" />
          {t("Começar entrevista")}
        </button>}
      </section>
      <figure className="ds-art vv-empty-art" aria-hidden="true" style={{ "--art-ratio": "4 / 3" } as CSSProperties}>
        <img src="/landing/hero-mata-mobile.webp" alt="" width={704} height={552} loading="lazy" decoding="async" />
      </figure>
    </div> : <div className="vv-content mt-8 lg:mt-10">
      <section aria-labelledby="voice-metrics-title">
        <div className="ds-sec-head">
          <div>
            <p className="ds-kicker">{t("Visão geral")}</p>
            <h2 id="voice-metrics-title" className="ds-section-title">{t("Visão geral da sua voz")}</h2>
          </div>
        </div>
        <div className="ds-card vv-metric-grid">{insights.metrics.map((metric) => <article className="vv-metric" data-focus={metric.key === insights.focus} key={metric.key}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="ds-label">{t(metric.label)}</h3>
            {metric.key === insights.focus && <span className="ds-focus-mark">{t("Seu foco agora")}</span>}
          </div>
          <p className="vv-metric-value"><span className="ds-num">{metric.value === null ? "—" : <CountUp value={Math.round(metric.value)} duration={1100} />}</span><span>/ 100</span></p>
          <span className="ds-meter" aria-hidden="true" style={{ "--p": `${metric.value === null ? 0 : Math.round(metric.value)}%` } as CSSProperties} />
          <p className="ds-small mt-3">{t(metric.measure)}</p>
        </article>)}</div>
      </section>
      <section className="vv-lesson vv-section ds-alt" aria-labelledby="how-to-improve">
        <div className="ds-sec-head">
          <div><h2 id="how-to-improve" className="ds-section-title">{t("Como melhorar")}</h2></div>
          <p className="ds-lead">{t("Escolha um aspecto da sua voz e veja o que fazer.")}</p>
        </div>
        <SlidingSegmented
          name="voice-lesson"
          ariaLabel={t("Escolha um aspecto da sua voz para aprender")}
          options={metricKeys.map((key) => ({ value: key, label: t(key === "accuracy" ? "Precisão" : key === "fluency" ? "Ritmo" : "Prosódia") }))}
          value={activeMetric}
          onChange={(value) => { setSelectedMetric(value as VoiceMetricKey); setSelectedSentenceId(null); }}
          className="grid-cols-3 w-full sm:w-[24rem]"
        />
        <div className="vv-lesson-card ds-card">
        <p className="vv-lesson-measure">{t(lesson.measure)}</p>
        <div className="vv-lesson-grid">
        <div className="vv-lesson-detail vv-techniques">
          <h3 className="ds-label">{t("O que fazer")}</h3>
          <ol>{lesson.techniques.map((technique, index) => <li key={technique}><span className="vv-step" aria-hidden="true">{index + 1}</span><span>{t(technique)}</span></li>)}</ol>
        </div>
        {lesson.personalized.length > 0 && <div className="vv-lesson-detail vv-personalized">
          <h3 className="ds-label">{t("Para você")}</h3>
          <ul>{lesson.personalized.map((tip, index) => <li key={typeof tip === "string" ? tip : `${tip.key}-${index}`}>{translateTip(t, tip)}</li>)}</ul>
        </div>}
        </div>
        <div className="vv-lesson-example">
          <div><h3 className="ds-label">{t("Exemplo")}</h3><p lang="en"><LessonExample text={lesson.example.text} emphasis={lesson.example.emphasis} /></p></div>
          <button type="button" className="ds-btn ds-btn-quiet" onClick={() => void playText(lesson.example.text)} disabled={activeCapture !== null || isSpeechLoading(lesson.example.text)}>{isSpeechLoading(lesson.example.text) ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}{t("Ouvir")}</button>
        </div>
        </div>
        <button type="button" className="ds-btn ds-btn-quiet vv-practice-now" onClick={practiceNow}>{t("Praticar agora")}<ArrowRight className="size-4 ds-arrow" aria-hidden="true" /></button>
      </section>
      <section ref={trainingRef} className="vv-section" aria-labelledby="today-training">
        <div className="ds-sec-head" data-layout="split">
          <div>
            <p className="ds-kicker">{t("Prática")}</p>
            <h2 id="today-training" className="ds-section-title">{t("Frases para treinar")}</h2>
          </div>
          <p className="ds-lead">{t("Ouça a forma certa, grave e compare com as tentativas anteriores.")}</p>
        </div>
        {sentence ? <article className="vv-training ds-card">
            <div className="vv-training-top">
              <p className="ds-small">{t(sentence.source === "english" ? "Correção do relatório" : "Trecho com pronúncia para revisar")}</p>
              <p className="ds-small">{t("{current} de {total}", { current: currentSentenceIndex + 1, total: trainingPhrases.length })}</p>
            </div>
            {(() => {
              const sentenceLine = <p className="vv-training-sentence" lang="en" key={sentence.id}><HighlightedText text={sentence.referenceText} words={sentence.attentionWords} /></p>;
              return sentence.source === "english" ? <div className="vv-pair">
                <div className="ds-block vv-pair-block"><p className="vv-pair-label">{t("Você disse")}</p><p className="vv-pair-said" lang="en">{sentence.saidText}</p></div>
                <div className="ds-block vv-pair-block" data-tone="good"><p className="vv-pair-label">{t("Forma para falar")}</p>{sentenceLine}</div>
              </div> : <div className="ds-block vv-pair-block mt-5" data-tone="good">
                <p className="vv-pair-label">{t("Forma para falar")}</p>
                {sentenceLine}
              </div>;
            })()}
            <div className="vv-training-actions">
              <div className="vv-training-primary-actions">
                <button type="button" className="ds-btn ds-btn-soft" onClick={() => void playText(sentence.referenceText)} disabled={activeCapture !== null || isSpeechLoading(sentence.referenceText)}>{isSpeechLoading(sentence.referenceText) ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}{t("Ouvir")}</button>
                {activeCapture === sentence.id ? <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => void stopRecording()}><Square className="size-4 fill-current" aria-hidden="true" />{t("Parar")}</button> : <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => void startRecording(sentence.id, sentence.referenceText)} disabled={startingCapture !== null || activeCapture !== null || assessing !== null}>{startingCapture === sentence.id || assessing === sentence.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}{t("Gravar")}</button>}
              </div>
              <button type="button" className="ds-btn ds-btn-quiet vv-next-sentence" onClick={nextSentence} disabled={activeCapture !== null || trainingPhrases.length < 2}>{t("Próxima frase")}<ArrowRight className="size-4 ds-arrow" aria-hidden="true" /></button>
            </div>
            <div className="vv-status-slot">{startingCapture === sentence.id ? <p key="starting" className="vv-status ds-small" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("Preparando o microfone…")}</p> : activeCapture === sentence.id ? <p key="recording" className="vv-status ds-small" role="status"><span className="vv-rec-dot" aria-hidden="true" />{t("Gravando. Leia a frase e toque em Parar.")}</p> : assessing === sentence.id ? <p key="assessing" className="vv-status ds-small" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("Avaliando sua gravação…")}</p> : null}</div>
            {message && messageTarget !== "word" && <p className="vv-message mt-4" role="alert">{message}</p>}
            <p className="vv-local-note ds-small">{t("Histórico local: mostramos as últimas tentativas desta frase neste navegador.")}</p>
            {attempts[sentence.id]?.length ? <AttemptResult attempts={attempts[sentence.id]} focus={activeMetric} beforeAccuracy={sentence.beforeAccuracy} /> : <p className="ds-body mt-4">{t("Ouça a forma correta e grave uma tentativa para ver as palavras avaliadas.")}</p>}
        </article> : <p className="ds-body mt-3">{t("Quando o relatório encontrar uma correção ou a análise de voz sinalizar uma frase, ela aparecerá aqui.")}</p>}
      </section>
      <section className="vv-section" aria-labelledby="work-words">
        <div className="ds-sec-head"><div><h2 id="work-words" className="ds-section-title">{t("Suas palavras de trabalho")}</h2></div><p className="ds-lead">{t("Palavras que se repetem nas suas entrevistas.")}</p></div>
        {plan.words.length ? <div className="ds-card vv-words ds-rows">{plan.words.map((word) => { const key = `word:${word.word}`; const text = normalizePracticeSpokenText(word.word); const latest = attempts[key]?.at(-1); return <div className="vv-word" key={word.word}><p lang="en" className="vv-word-name">{text}</p>{latest && <p className="vv-word-score">{t("Precisão")}: {formatMetric(latest.scores.accuracy)}</p>}<div className="vv-word-actions"><button type="button" className="ds-btn ds-btn-quiet" onClick={() => void playText(text)} disabled={activeCapture !== null || isSpeechLoading(text)}>{isSpeechLoading(text) ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}{t("Ouvir")}</button>{activeCapture === key ? <button type="button" className="ds-btn ds-btn-soft" onClick={() => void stopRecording()}><Square className="size-4 fill-current" aria-hidden="true" />{t("Parar")}</button> : <button type="button" className="ds-btn ds-btn-soft" onClick={() => void startRecording(key, text)} disabled={startingCapture !== null || activeCapture !== null || assessing !== null}>{startingCapture === key ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}{t("Gravar")}</button>}</div></div>; })}</div> : <p className="ds-body mt-3">{t("Quando uma palavra relevante aparecer em mais entrevistas, ela fica disponível aqui.")}</p>}
      </section>
      <section className="vv-section" aria-labelledby="voice-evolution">
        <div className="ds-sec-head"><div><h2 id="voice-evolution" className="ds-section-title">{t("Evolução")}</h2></div><p className="ds-lead">{t("Cada barra é uma entrevista. A mais recente fica em destaque.")}</p></div>
        <div className="vv-evolution ds-card">{insights.metrics.map((metric) => { const points = plan.evolution[metric.key]; const delta = points.length > 1 ? Math.round(points.at(-1)!.value - points[0].value) : 0; return <div className="vv-evolution-row" key={metric.key}><div className="vv-evolution-label"><span className="ds-label">{t(metric.label)}</span>{delta !== 0 && <span className="vv-evolution-delta">{t("{delta} desde a primeira", { delta: `${delta > 0 ? "+" : ""}${delta}` })}</span>}</div>{points.length ? <div className="vv-evolution-series">{points.map((point, index) => <div className="vv-evolution-point" key={point.id}><span className="vv-evolution-value">{index === points.length - 1 ? Math.round(point.value) : ""}</span><span className="vv-evolution-bar" data-latest={index === points.length - 1} style={{ "--vv-value": `${point.value}%` } as CSSProperties} aria-label={t("{metric}: {value} em {date}", { metric: metric.label, value: Math.round(point.value), date: point.date ? new Date(point.date).toLocaleDateString() : t("data não disponível") })}><span /></span></div>)}</div> : <span className="ds-body">{t("Dados confiáveis ainda não disponíveis.")}</span>}</div>; })}</div>
      </section>
      {message && messageTarget === "word" && <p className="vv-message" role="alert">{message}</p>}
    </div>}
    <div className="ds-band" aria-hidden="true" />
  </main>;
}
