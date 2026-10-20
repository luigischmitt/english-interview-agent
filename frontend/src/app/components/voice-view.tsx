"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LoadingRegion, Sk, SkCard, SkChart } from "@/components/ui/loading-state";
import { ArrowLeft, ArrowRight, AudioLines, LoaderCircle, Mic, Play, Square, Volume2 } from "lucide-react";

import { authorizedFetch } from "@/lib/auth/backend-auth";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { readStoredInterviewerSpeechSpeed } from "@/lib/interview/interviewer-speech-speed.mjs";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { fetchSpeechBlob, playInterviewerSegments, prewarmInterviewerSpeech, splitInterviewerSpeech } from "@/lib/interview/speech-playback.mjs";
import { readStoredInterviewerVoice } from "@/lib/interview/voice-picker.mjs";
import { buildVoiceTrainingPhrases, encodeWav16Mono, migrateLegacyPracticeAttempts, readPracticeAttempts, savePracticeAttempt } from "@/lib/interview/voice-insights.mjs";
import { loadVoicePracticeAttempts, saveVoicePracticeAttempt, type VoicePracticeAssessment, type VoicePracticeAttemptRecord, type VoicePracticeSource } from "@/lib/interview/voice-practice-persistence";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { useLocale } from "@/lib/locale";

import { PageIntro } from "./shared";
import "./voice-view.css";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const speechEndpoint = `${backendUrl}/api/v1/speech`;
const practiceEndpoint = `${backendUrl}/api/v1/voice/practice`;
const metricKeys = ["accuracy", "fluency", "prosody"] as const;
const metricLabel = { accuracy: "Precisão", fluency: "Ritmo", prosody: "Prosódia" } as const;

function HighlightedText({ text, words }: { text: string; words: string[] }) {
  const attention = new Set(words.map((word) => word.toLocaleLowerCase()));
  let order = 0;
  return <>{text.split(/(\s+)/u).map((part, index) => {
    if (/^\s*$/u.test(part)) return part;
    const clean = part.replace(/[^\p{L}'’-]/gu, "").toLocaleLowerCase();
    const style = { "--w": Math.min(order++, 10) } as CSSProperties;
    return <span className={attention.has(clean) ? "vv-w vv-problem-word" : "vv-w"} style={style} key={`${part}-${index}`}>{part}</span>;
  })}</>;
}

function sameScores(first: VoicePracticeAttemptRecord, second: VoicePracticeAttemptRecord) {
  return metricKeys.every((key) => (first.scores[key] === null ? null : Math.round(first.scores[key]!)) === (second.scores[key] === null ? null : Math.round(second.scores[key]!)));
}

/** Shows only changes between this candidate's attempts and the words Azure flagged in this recording. */
function AttemptResult({ attempts }: { attempts: VoicePracticeAttemptRecord[] }) {
  const { t } = useLocale();
  const latest = attempts.at(-1)!;
  const previous = attempts.length > 1 ? attempts.at(-2)! : null;
  const flagged = latest.words.filter((word) => word.errorType && word.errorType !== "None");
  const time = new Date(latest.createdAt);
  const when = Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <div className="vv-result ds-item" role="status" aria-live="polite">
    <div className="vv-result-head">
      <p className="ds-label">{attempts.length === 1 ? t("Sua primeira tentativa") : t("O que mudou entre tentativas")}{when && <span> · {when}</span>}</p>
      <p className="ds-small">{t("Sinais experimentais do Azure, calibrados em en-US. Não medem sotaque nem garantem inteligibilidade.")}</p>
    </div>
    {previous && <div className="vv-scores ds-stagger">{metricKeys.map((key) => {
      const value = latest.scores[key];
      const before = previous.scores[key];
      const delta = value !== null && before !== null ? Math.round(value) - Math.round(before) : null;
      return <div className="vv-score" key={key}>
        <span className="vv-score-name">{t(metricLabel[key])}</span>
        <span className="vv-score-delta" data-direction={delta === null ? "same" : delta > 0 ? "up" : delta < 0 ? "down" : "same"}>{delta === null ? t("sem dados comparáveis") : delta > 0 ? `+${delta} ${t("no sinal")}` : delta < 0 ? `${delta} ${t("no sinal")}` : t("sem mudança no sinal")}</span>
      </div>;
    })}</div>}
    {latest.words.length > 0 && <>
      <p className="vv-attempt-words" lang="en">{latest.words.map((word, index) => <span className={word.errorType && word.errorType !== "None" ? "vv-problem-word" : ""} key={`${word.word}-${index}`}>{word.word}</span>)}</p>
      <p className="ds-small mt-1">{t(flagged.length ? "Palavras sinalizadas pelo Azure nesta tentativa; confira se afetaram a compreensão." : "Nenhuma palavra foi sinalizada pelo Azure nesta tentativa.")}</p>
    </>}
    {previous && sameScores(previous, latest) && <p className="vv-same ds-small">{t("Os sinais do Azure não mudaram entre estas tentativas. Use-os como indício e avalie você mesmo se a frase ficou clara.")}</p>}
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
  const [activeCapture, setActiveCapture] = useState<string | null>(null);
  const [startingCapture, setStartingCapture] = useState<string | null>(null);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [loadingSpeech, setLoadingSpeech] = useState<string | null>(null);
  const [phraseLive, setPhraseLive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, VoicePracticeAttemptRecord[]>>(() => typeof window === "undefined" ? {} : readPracticeAttempts(window.localStorage) as Record<string, VoicePracticeAttemptRecord[]>);
  const [attemptHistoryReady, setAttemptHistoryReady] = useState(false);
  const captureRef = useRef<Capture | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const captureWorkletReadyRef = useRef<Promise<AudioContext> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechPreviewCacheRef = useRef(new Map<string, SpeechPreview>());
  const speechPreviewFlightsRef = useRef(new Map<string, Promise<SpeechPreview>>());
  const speechPrewarmsRef = useRef<Array<{ cancel: () => void }>>([]);
  const spokenPlaybackRef = useRef<{ cancel: () => void } | null>(null);
  const isMountedRef = useRef(true);
  const trainingPhrases = useMemo(() => buildVoiceTrainingPhrases(records), [records]);
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
      setAttempts(local as Record<string, VoicePracticeAttemptRecord[]>);
      try {
        const remote = await loadVoicePracticeAttempts(sources);
        const merged: Record<string, VoicePracticeAttemptRecord[]> = { ...remote };
        for (const source of sources) {
          for (const attempt of local[source.id] ?? []) {
            if (!attempt.id) continue;
            if (merged[source.id]?.some((saved) => saved.id === attempt.id)) continue;
            try {
              const saved = await saveVoicePracticeAttempt(source, attempt.id, attempt);
              (merged[source.id] ??= []).push(saved);
            } catch {
              (merged[source.id] ??= []).push(attempt as VoicePracticeAttemptRecord);
            }
          }
        }
        for (const rows of Object.values(merged)) rows.sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt));
        if (active) { setAttempts(merged); setAttemptHistoryReady(true); }
      } catch {
        if (active) {
          setAttemptHistoryReady(true);
          setMessage(t("Não foi possível sincronizar o histórico. As tentativas novas ficarão salvas neste navegador até a conexão voltar."));
        }
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
    const effectPrewarms: Array<{ cancel: () => void }> = [];
    const nextSentence = trainingPhrases[(currentSentenceIndex + 1) % trainingPhrases.length];
    const texts = [sentence?.referenceText, nextSentence?.referenceText].filter((text): text is string => Boolean(text));
    const seen = new Set<string>();
    for (const text of texts) {
      if (seen.has(text)) continue;
      seen.add(text);
      const segments = splitInterviewerSpeech(text);
      if (segments.length > 1 || text.length > 120) {
        const { voice, speed } = speechPreferences();
        const prewarm = prewarmInterviewerSpeech(segments, { endpoint: speechEndpoint, fetcher: authorizedFetch, voice, speed, retainMs: 60_000 });
        effectPrewarms.push(prewarm);
        speechPrewarmsRef.current.push(prewarm);
        void prewarm.promise;
      } else void loadSpeechPreview(text).catch(() => undefined);
    }
    return () => {
      for (const prewarm of effectPrewarms) prewarm.cancel();
      speechPrewarmsRef.current = speechPrewarmsRef.current.filter((prewarm) => !effectPrewarms.includes(prewarm));
    };
  }, [currentSentenceIndex, loadSpeechPreview, sentence?.referenceText, speechPreferences, trainingPhrases]);

  const assess = async (targetId: string, text: string, samples: Float32Array[]) => {
    const sourceTarget = trainingPhrases.find((item) => item.id === targetId);
    if (!sourceTarget) { setMessage(t("Este trecho não está mais disponível. Atualize a tela para continuar.")); return; }
    setAssessing(targetId); setMessage(null);
    try {
      const length = samples.reduce((sum, item) => sum + item.length, 0);
      const merged = new Float32Array(Math.min(length, 320_000));
      let offset = 0;
      for (const frame of samples) { if (offset >= merged.length) break; merged.set(frame.subarray(0, merged.length - offset), offset); offset += frame.length; }
      const response = await authorizedFetch(`${practiceEndpoint}?text=${encodeURIComponent(text)}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: encodeWav16Mono(merged) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.code;
        setMessage(t(code === "PRACTICE_DAILY_LIMIT" ? "Você chegou ao limite de avaliações de hoje." : code === "PRACTICE_UNAVAILABLE" ? "A avaliação de voz está indisponível agora. Tente novamente em instantes." : "Não foi possível avaliar esta gravação. Tente novamente."));
        return;
      }
      const clientAttemptId = crypto.randomUUID();
      const assessment: VoicePracticeAssessment = { scores: { accuracy: Number.isFinite(body?.scores?.accuracy) ? body.scores.accuracy : null, fluency: Number.isFinite(body?.scores?.fluency) ? body.scores.fluency : null, prosody: Number.isFinite(body?.scores?.prosody) ? body.scores.prosody : null }, words: Array.isArray(body?.words) ? body.words.map((word: { word?: unknown; accuracyScore?: unknown; errorType?: unknown }) => ({ word: typeof word.word === "string" ? word.word : "", accuracyScore: Number.isFinite(word.accuracyScore) ? Number(word.accuracyScore) : null, errorType: typeof word.errorType === "string" ? word.errorType : null })).filter((word: { word: string }) => word.word) : [] };
      const localAttempt: VoicePracticeAttemptRecord = { id: clientAttemptId, createdAt: new Date().toISOString(), ...assessment };
      const local = savePracticeAttempt(window.localStorage, targetId, localAttempt) as Record<string, VoicePracticeAttemptRecord[]>;
      setAttempts(local);
      try {
        const source: VoicePracticeSource = { id: sourceTarget.id, interviewId: sourceTarget.interviewId, candidateSequenceNumber: sourceTarget.candidateSequenceNumber, sourceKind: sourceTarget.sourceKind, phraseIndex: sourceTarget.phraseIndex, normalizedTarget: sourceTarget.normalizedTarget, targetText: sourceTarget.referenceText };
        const saved = await saveVoicePracticeAttempt(source, clientAttemptId, assessment);
        setAttempts((current) => ({ ...current, [targetId]: [...(current[targetId] ?? []).filter((item) => item.id !== clientAttemptId), saved].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt)) }));
        setMessage(null);
      } catch {
        setMessage(t("Tentativa avaliada e salva somente neste navegador. Ela será sincronizada quando a conexão voltar."));
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
      setMessage(t(denied ? "Permita o uso do microfone para refazer este trecho." : "Não foi possível abrir o microfone agora. Tente novamente."));
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
    setPhraseLive(true);
    setSelectedSentenceId(trainingPhrases[nextIndex].id);
  };
  const previousSentence = () => {
    if (!trainingPhrases.length) return;
    const previousIndex = (currentSentenceIndex - 1 + trainingPhrases.length) % trainingPhrases.length;
    setPhraseLive(true);
    setSelectedSentenceId(trainingPhrases[previousIndex].id);
  };
  const sourceInterview = sentence ? records.find((record) => record.id === sentence.interviewId) : null;

  return <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
    <PageIntro
      title={t("Sua voz")}
      description={t("Retome trechos reais das suas entrevistas e compare suas próprias tentativas.")}
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
    </section> : !trainingPhrases.length ? <section className="vv-empty ds-card ds-enter mt-8 p-6 sm:p-8">
      <AudioLines className="size-6 text-[var(--ds-green)]" aria-hidden="true" />
      <p className="ds-body">{t("Quando um relatório trouxer uma correção ou um trecho de voz sinalizado, ele aparecerá aqui para você refazer.")}</p>
      {onStart && <button type="button" className="ds-btn ds-btn-cta-green" onClick={onStart}>
        <Play className="size-4 fill-current" aria-hidden="true" />
        {t("Nova entrevista")}
      </button>}
    </section> : <div className="vv-content mt-8 lg:mt-10">
            <section className="vv-section" aria-labelledby="today-training" data-reveal="group">
              <h2 id="today-training" className="ds-h2 ds-item">{t("Trechos das suas entrevistas")}</h2>
              <p className="ds-body mt-2">{t("A fila prioriza trechos reais que aparecem em mais de uma resposta ou foram destacados no relatório. Cada tentativa fica ligada à entrevista de origem.")}</p>
              {sentence ? <article className="vv-training ds-card ds-item">
                <div className="vv-training-top">
                  <p className="ds-small">{t(sentence.source === "english" ? "Correção de inglês em uma resposta" : "Trecho sinalizado na análise de voz")}</p>
                  <p className="ds-small">{t("{current} de {total}", { current: currentSentenceIndex + 1, total: trainingPhrases.length })}</p>
                </div>
                {sourceInterview && <p className="vv-source ds-small">{sourceInterview.targetRole}{sourceInterview.completedAt ? ` · ${new Date(sourceInterview.completedAt).toLocaleDateString()}` : ""} · {t("resposta {n}", { n: Math.ceil(sentence.candidateSequenceNumber / 2) })}</p>}
                {sentence.source === "english" && <><div className="vv-phrase-contrast"><p className="ds-small">{t("Você disse")}</p><p lang="en">{sentence.saidText}</p></div>
                <p className="vv-source ds-small">{t("Forma para falar")}</p></>}
                <p className="vv-training-sentence" lang="en" key={sentence.id} data-live={phraseLive}><HighlightedText text={sentence.referenceText} words={sentence.attentionWords} /></p>
                <div className="vv-training-actions">
                  <div className="vv-training-primary-actions">
                    <button type="button" className="ds-btn ds-btn-soft" onClick={() => void playText(sentence.referenceText)} disabled={activeCapture !== null || isSpeechLoading(sentence.referenceText)}>{isSpeechLoading(sentence.referenceText) ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}{t("Ouvir")}</button>
                    {activeCapture === sentence.id ? <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => void stopRecording()}><Square className="size-4 fill-current" aria-hidden="true" />{t("Parar")}</button> : <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => void startRecording(sentence.id, sentence.referenceText)} disabled={startingCapture !== null || activeCapture !== null || assessing !== null}>{startingCapture === sentence.id || assessing === sentence.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}{t("Gravar")}</button>}
                  </div>
                  <div className="vv-training-primary-actions">
                    <button type="button" className="ds-btn ds-btn-quiet" onClick={previousSentence} disabled={activeCapture !== null || trainingPhrases.length < 2}><ArrowLeft className="size-4" aria-hidden="true" />{t("Anterior")}</button>
                    <button type="button" className="ds-btn ds-btn-quiet vv-next-sentence" onClick={nextSentence} disabled={activeCapture !== null || trainingPhrases.length < 2}>{t("Próximo trecho")}<ArrowRight className="size-4 ds-arrow" aria-hidden="true" /></button>
                  </div>
                </div>
                <div className="vv-status-slot">{startingCapture === sentence.id ? <p key="starting" className="vv-status ds-small ds-fade-in" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("Preparando o microfone…")}</p> : activeCapture === sentence.id ? <p key="recording" className="vv-status ds-small ds-fade-in" role="status"><span className="vv-rec-dot" aria-hidden="true" />{t("Gravando. Leia a frase e toque em Parar.")}</p> : assessing === sentence.id ? <p key="assessing" className="vv-status ds-small ds-fade-in" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("Avaliando sua gravação…")}</p> : null}</div>
                {message && <p className="vv-message mt-4" role="alert">{message}</p>}
                {!attemptHistoryReady ? <p className="ds-small mt-4" role="status">{t("Carregando tentativas salvas…")}</p> : attempts[sentence.id]?.length ? <AttemptResult attempts={attempts[sentence.id]} /> : <p className="ds-body mt-4">{t("Ouça a referência e grave uma tentativa. O histórico ficará ligado a este trecho e a esta entrevista.")}</p>}
              </article> : <p className="ds-body mt-3">{t("Quando o relatório encontrar uma correção ou a análise de voz sinalizar uma frase, ela aparecerá aqui.")}</p>}
            </section>
            <section className="vv-section" aria-labelledby="next-interview" data-reveal="group">
              <h2 id="next-interview" className="ds-h2">{t("Leve este aprendizado para a próxima entrevista")}</h2>
              <p className="ds-body mt-2">{t("Use uma nova entrevista para praticar a resposta em contexto.")}</p>
              {onStart && <button type="button" className="ds-btn ds-btn-cta-green mt-4" onClick={onStart}><Play className="size-4 fill-current" aria-hidden="true" />{t("Nova entrevista")}</button>}
            </section>
          </div>}
  </main>;
}
