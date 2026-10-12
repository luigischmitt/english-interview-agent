"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleDot, Dumbbell, Loader2, Play, RotateCcw, Volume2, XCircle } from "lucide-react";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { resolveInterviewerVoice } from "@/lib/interview/voices.mjs";
import { interviewerVoiceStorageKey } from "@/lib/interview/voice-picker.mjs";
import { getPracticeExercises, gradePracticeAnswer } from "@/lib/practice/practice-requests";
import {
  loadPracticeAttempts,
  loadPracticeThemes,
  savePracticeAttempt,
  syncPracticeThemes,
  updateThemeProgress,
  type PracticeAttempt,
  type PracticeTheme,
} from "@/lib/practice/practice-store";
import { sortThemes } from "@/lib/practice/practice-sync.mjs";
import { t } from "@/lib/locale";
import { VoiceAnswerButton } from "./voice-answer-button";
import "./train.css";

type Exercise = { kind: "fix" | "build"; instruction: string; source: string | null; target: string };
type Grade = { verdict: "correct" | "almost" | "incorrect"; feedback: string; corrected: string };
const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const speechEndpoint = `${backendBaseUrl}/api/v1/speech`;
const maxSyncBatches = 4;
const occurrenceCopy = (count: number, interviews: number) => count === 1
  ? "Apareceu 1 vez em 1 entrevista."
  : interviews === 1 ? "Apareceu {count} vezes em 1 entrevista." : "Apareceu {count} vezes em {interviews} entrevistas.";
const syncWarning = "Não conseguimos analisar seus erros mais recentes agora; tentaremos de novo na próxima vez.";

export function TrainView({ onInterview }: { onInterview: () => void }) {
  const [themes, setThemes] = useState<PracticeTheme[]>([]);
  const [themeLoading, setThemeLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<PracticeTheme | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [exercisesLoading, setExercisesLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [grading, setGrading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<Grade | null>(null);
  const [completed, setCompleted] = useState(0);
  const [attempts, setAttempts] = useState<PracticeAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [speechError, setSpeechError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechRequestRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);

  const releaseAudio = useCallback(() => {
    speechRequestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  useEffect(() => () => releaseAudio(), [releaseAudio]);

  const playPhrase = async (phrase: string) => {
    releaseAudio();
    const requestId = speechRequestRef.current;
    setSpeechError(false);
    try {
      let voice = resolveInterviewerVoice(null);
      try { voice = resolveInterviewerVoice(localStorage.getItem(interviewerVoiceStorageKey)); } catch { /* Use the default voice. */ }
      const blob = await fetchSpeechBlob(phrase, { endpoint: speechEndpoint, fetcher: authorizedFetch, voice });
      if (requestId !== speechRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const cleanup = () => {
        if (audioRef.current === audio) releaseAudio();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      await audio.play();
    } catch {
      if (requestId !== speechRequestRef.current) return;
      releaseAudio();
      setSpeechError(true);
    }
  };

  const load = useCallback(async () => {
    setThemeLoading(true);
    setLoadError(null);
    const loaded = await loadPracticeThemes();
    if (!loaded.ok) {
      setLoadError(loaded.message);
      setThemeLoading(false);
      return;
    }
    setThemes(sortThemes(loaded.value));
    setThemeLoading(false);
    // New report errors are grouped a few at a time; the list grows after each batch. A few batches per visit bound the wait.
    setSyncing(true);
    let current = loaded.value;
    for (let batch = 0; batch < maxSyncBatches; batch += 1) {
      const synced = await syncPracticeThemes(current);
      if (!synced.ok) { setSyncFailed(true); break; }
      setSyncFailed(false);
      current = synced.value.themes;
      setThemes(sortThemes(current));
      if (!synced.value.remaining) break;
    }
    setSyncing(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectTheme = async (theme: PracticeTheme) => {
    setSelected(theme);
    setAttemptsLoading(true);
    const history = await loadPracticeAttempts(theme.id);
    setAttempts(history.ok ? history.value : []);
    setAttemptsLoading(false);
  };

  const begin = async () => {
    if (!selected) return;
    setSessionStarted(true);
    setExercisesLoading(true);
    setFormError(null);
    setResult(null);
    setAnswer("");
    setMode("text");
    setStep(0);
    setCompleted(0);
    setExercises([]);
    try {
      const response = await getPracticeExercises({
        theme: { title: selected.title, explanation: selected.explanation, examples: selected.examples ?? [] },
        userErrors: (selected.error_refs ?? []).slice(-3).map((ref) => ({ evidence: ref.evidence, rephrasedExample: ref.rephrased })),
      });
      setExercises(response.exercises.slice(0, 3));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível preparar os exercícios.");
    } finally {
      setExercisesLoading(false);
    }
  };

  const submit = async () => {
    if (!selected || !exercises[step] || !answer.trim() || grading) return;
    setGrading(true);
    setFormError(null);
    const exercise = exercises[step];
    const cleanAnswer = answer.trim();
    try {
      const grade = await gradePracticeAnswer({ theme: { title: selected.title, explanation: selected.explanation }, exercise, answer: cleanAnswer, mode });
      const saved = await savePracticeAttempt({ themeId: selected.id, kind: exercise.kind, instruction: exercise.instruction, mode, answer: cleanAnswer, ...grade });
      if (!saved.ok) throw new Error(saved.message);
      setResult(grade);
      setAttempts((current) => [saved.value, ...current].slice(0, 5));
      const updated = await updateThemeProgress(selected, grade.verdict);
      if (updated.ok) {
        setSelected(updated.value);
        setThemes((current) => current.map((theme) => theme.id === updated.value.id ? updated.value : theme));
      } else {
        setFormError(updated.message);
      }
      setCompleted((count) => count + (grade.verdict === "correct" ? 1 : 0));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível avaliar sua resposta.");
    } finally {
      setGrading(false);
    }
  };

  const next = () => {
    setResult(null);
    setAnswer("");
    setMode("text");
    setStep((current) => current + 1);
  };
  const sorted = useMemo(() => sortThemes(themes), [themes]);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-4xl tracking-tight">{t("Treinar")}</h1>
        <p className="ds-body mt-2">{t("Pratique os padrões de inglês que aparecem nas suas entrevistas.")}</p>
      </header>
      {loadError ? (
        <div className="tr-error" role="alert">
          <p>{loadError}</p>
          <button className="ds-btn ds-btn-soft" onClick={() => void load()}>{t("Tentar de novo")}</button>
        </div>
      ) : (
        <>
          {syncFailed && <p className="tr-sync-warning" role="status">{t(syncWarning)}</p>}
          {syncing && sorted.length > 0 && !selected && <p className="ds-hint mb-3" role="status">{t("Analisando erros novos das suas entrevistas…")}</p>}
          {selected ? (
            selectedView()
          ) : themeLoading ? (
            <div className="tr-skeleton skeleton h-48 w-full" aria-busy="true" />
          ) : sorted.length === 0 && syncing ? (
            <section className="shl-dashed flex items-center gap-3 p-6" aria-busy="true">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <p className="ds-body">{t("Analisando os erros das suas entrevistas… isso leva alguns segundos na primeira vez.")}</p>
            </section>
          ) : sorted.length === 0 ? (
            <section className="shl-dashed p-6">
              <p className="ds-body">{t("Faça uma entrevista para descobrirmos o que você precisa treinar")}</p>
              <button className="ds-btn ds-btn-cta mt-5" onClick={onInterview}><Play className="size-4" />{t("Preparar entrevista")}</button>
            </section>
          ) : (
            <ThemeList themes={sorted} onSelect={(theme) => void selectTheme(theme)} />
          )}
        </>
      )}
    </main>
  );

  function selectedView() {
    if (!selected) return null;
    if (sessionStarted) {
      return (
        <PracticeSession
          exercises={exercises}
          loading={exercisesLoading}
          step={step}
          answer={answer}
          grading={grading}
          result={result}
          error={formError}
          speechError={speechError}
          completed={completed}
          onBack={() => { setSelected(null); setExercises([]); setSessionStarted(false); }}
          onBegin={() => void begin()}
          onAnswer={setAnswer}
          onVoiceAnswer={(text) => { setMode("voice"); setAnswer(text); setFormError(null); }}
          onVoiceError={setFormError}
          onSubmit={() => void submit()}
          onNext={next}
          onInterview={onInterview}
          onPlay={(phrase) => void playPhrase(phrase)}
        />
      );
    }
    return (
      <ThemeDetail
        theme={selected}
        attempts={attempts}
        attemptsLoading={attemptsLoading}
        speechError={speechError}
        onBack={() => { setSelected(null); setSessionStarted(false); }}
        onBegin={() => void begin()}
        onPlay={(phrase) => void playPhrase(phrase)}
      />
    );
  }
}

function ThemeList({ themes, onSelect }: { themes: PracticeTheme[]; onSelect: (theme: PracticeTheme) => void }) {
  return (
    <section className="tr-list" aria-labelledby="train-topics">
      <h2 id="train-topics" className="ds-h2">{t("Seus erros mais frequentes")}</h2>
      <div className="mt-4 grid gap-4">
        {themes.map((theme) => <ThemeCard key={theme.id} theme={theme} onSelect={onSelect} />)}
      </div>
    </section>
  );
}

function ThemeCard({ theme, onSelect }: { theme: PracticeTheme; onSelect: (theme: PracticeTheme) => void }) {
  const interviews = new Set(theme.error_refs?.map((ref) => ref.interview_id)).size;
  return (
    <article className="tr-card ds-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="ds-h2">{theme.title}</h3>
          <p className="ds-small mt-1">{t(occurrenceCopy(theme.error_refs?.length ?? 0, interviews), { count: theme.error_refs?.length ?? 0, interviews })}</p>
          {theme.last_error_at && <p className="ds-small mt-1">{t("Última vez: {date}", { date: new Date(theme.last_error_at).toLocaleDateString("pt-BR") })}</p>}
        </div>
        <span className="shl-pill shl-pill-on">{t(theme.status === "mastered" ? "Dominado" : "Treinando")}</span>
      </div>
      <button className="ds-btn ds-btn-cta mt-5" onClick={() => onSelect(theme)}><Dumbbell className="size-4" />{t("Treinar")}</button>
    </article>
  );
}

function ThemeDetail({ theme, attempts, attemptsLoading, speechError, onBack, onBegin, onPlay }: {
  theme: PracticeTheme; attempts: PracticeAttempt[]; attemptsLoading: boolean; speechError: boolean;
  onBack: () => void; onBegin: () => void; onPlay: (phrase: string) => void;
}) {
  return (
    <section className="tr-panel ds-card p-5 sm:p-8">
      <button className="ds-btn ds-btn-quiet mb-4" onClick={onBack}><ArrowLeft className="size-4" />{t("Voltar aos temas")}</button>
      <h2 className="ds-h2">{theme.title}</h2>
      <section className="mt-5"><h3 className="ds-label">{t("O que está acontecendo")}</h3><p className="ds-body mt-1">{theme.explanation}</p></section>
      <section className="mt-5">
        <h3 className="ds-label">{t("Você disse → Soa melhor")}</h3>
        <div className="mt-2 grid gap-3">
          {(theme.error_refs ?? []).slice(-3).reverse().map((ref, index) => (
            <div className="tr-evidence" key={`${ref.interview_id}-${ref.sequence_number}-${index}`}>
              <p className="ds-small">{t("Você disse")}</p><p lang="en">{ref.evidence}</p>
              <p className="ds-small mt-2">{t("Soa melhor")}</p><p lang="en">{ref.rephrased}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-5">
        <h3 className="ds-label">{t("Frases que você vai usar muito")}</h3>
        <ul className="tr-examples mt-2">
          {(theme.examples ?? []).map((example, index) => <li key={index} lang="en"><span>{example}</span><SpeakButton phrase={example} onPlay={onPlay} /></li>)}
        </ul>
        {speechError && <p className="tr-hint">{t("O áudio não está disponível agora. Você pode continuar sem ele.")}</p>}
      </section>
      <section className="mt-5"><h3 className="ds-label">{t("Por quê")}</h3><p className="ds-body mt-1">{theme.why}</p></section>
      <section className="mt-6">
        <h3 className="ds-label">{t("Últimas tentativas")}</h3>
        {attemptsLoading ? <Loader2 className="tr-spinner mt-3 size-5" aria-label={t("Carregando")} /> : attempts.length ? (
          <ol className="tr-history mt-2">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <time>{new Date(attempt.created_at).toLocaleDateString("pt-BR")}</time>
                <p lang="en">{attempt.answer}</p>
                <Verdict verdict={attempt.verdict} />
              </li>
            ))}
          </ol>
        ) : <p className="ds-small mt-2">{t("Suas tentativas aparecerão aqui.")}</p>}
      </section>
      <button className="ds-btn ds-btn-cta mt-6" onClick={onBegin}><Dumbbell className="size-4" />{t("Praticar")}</button>
    </section>
  );
}

function PracticeSession({
  exercises,
  loading,
  step,
  answer,
  grading,
  result,
  error,
  speechError,
  completed,
  onBack,
  onBegin,
  onAnswer,
  onVoiceAnswer,
  onVoiceError,
  onSubmit,
  onNext,
  onInterview,
  onPlay,
}: {
  exercises: Exercise[];
  loading: boolean;
  step: number;
  answer: string;
  grading: boolean;
  result: Grade | null;
  error: string | null;
  speechError: boolean;
  completed: number;
  onBack: () => void;
  onBegin: () => void;
  onAnswer: (text: string) => void;
  onVoiceAnswer: (text: string) => void;
  onVoiceError: (message: string) => void;
  onSubmit: () => void;
  onNext: () => void;
  onInterview: () => void;
  onPlay: (phrase: string) => void;
}) {
  if (loading) {
    return (
      <section className="tr-panel ds-card p-5 sm:p-8" aria-busy="true">
        <Loader2 className="tr-spinner size-6" aria-label={t("Carregando exercícios")} />
        <p className="ds-body mt-3">{t("Preparando seus exercícios…")}</p>
      </section>
    );
  }

  if (!exercises.length) {
    return (
      <section className="tr-panel ds-card p-5 sm:p-8">
        <button className="ds-btn ds-btn-quiet" onClick={onBack}>
          <ArrowLeft className="size-4" />{t("Voltar aos temas")}
        </button>
        {error && <p className="tr-form-error mt-4" role="alert">{error}</p>}
        <button className="ds-btn ds-btn-cta mt-4" onClick={onBegin}>{t("Tentar de novo")}</button>
      </section>
    );
  }

  if (step >= exercises.length) {
    return (
      <section className="tr-panel ds-card p-5 sm:p-8">
        <h2 className="ds-h2">{t("Prática concluída")}</h2>
        <p className="ds-body mt-2">{t("Você acertou {correct} de {total}.", { correct: completed, total: exercises.length })}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="ds-btn ds-btn-cta" onClick={onBegin}>
            <RotateCcw className="size-4" />{t("Treinar de novo")}
          </button>
          <button className="ds-btn ds-btn-soft" onClick={onBack}>{t("Voltar aos temas")}</button>
          <button className="ds-btn ds-btn-soft" onClick={onInterview}>
            <Play className="size-4" />{t("Preparar entrevista")}
          </button>
        </div>
      </section>
    );
  }

  const exercise = exercises[step];
  return (
    <section className="tr-panel ds-card p-5 sm:p-8" aria-live="polite">
      <button className="ds-btn ds-btn-quiet mb-4" onClick={onBack}>
        <ArrowLeft className="size-4" />{t("Voltar aos temas")}
      </button>
      <p className="ds-hint">{t("Exercício {current} de {total}", { current: step + 1, total: exercises.length })}</p>
      <h2 className="ds-h2 mt-2">{exercise.instruction}</h2>
      {exercise.kind === "fix" && exercise.source && (
        <blockquote className="tr-source mt-4" lang="en">{exercise.source}</blockquote>
      )}
      {!result ? (
        <AnswerForm
          value={answer}
          disabled={grading}
          error={error}
          onChange={onAnswer}
          onSubmit={onSubmit}
          onVoiceAnswer={onVoiceAnswer}
          onVoiceError={onVoiceError}
        />
      ) : (
        <PracticeFeedback result={result} error={error} speechError={speechError} onNext={onNext} onPlay={onPlay} />
      )}
    </section>
  );
}

function AnswerForm({ value, disabled, error, onChange, onSubmit, onVoiceAnswer, onVoiceError }: {
  value: string;
  disabled: boolean;
  error: string | null;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onVoiceAnswer: (text: string) => void;
  onVoiceError: (message: string) => void;
}) {
  return (
    <form
      className="tr-answer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="ds-label" htmlFor="practice-answer">{t("Sua resposta em inglês")}</label>
      <textarea
        id="practice-answer"
        className="ds-field"
        value={value}
        maxLength={500}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        lang="en"
        rows={4}
        disabled={disabled}
      />
      {error && <p className="tr-form-error" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <VoiceAnswerButton onTranscript={onVoiceAnswer} onError={onVoiceError} disabled={disabled} />
        <button className="ds-btn ds-btn-cta" type="submit" disabled={disabled || !value.trim()}>{gradingLabel(disabled)}</button>
      </div>
    </form>
  );
}

function gradingLabel(disabled: boolean) {
  return disabled ? <><Loader2 className="tr-spinner size-4" />{t("Avaliando…")}</> : t("Enviar");
}

function PracticeFeedback({ result, error, speechError, onNext, onPlay }: {
  result: Grade;
  error: string | null;
  speechError: boolean;
  onNext: () => void;
  onPlay: (phrase: string) => void;
}) {
  return (
    <div className="mt-5">
      <Verdict verdict={result.verdict} />
      <p className="ds-body mt-2">{result.feedback}</p>
      {error && <p className="tr-form-error mt-3" role="status">{error}</p>}
      <div className="tr-corrected mt-3" lang="en">
        <span>{result.corrected}</span>
        <SpeakButton phrase={result.corrected} onPlay={onPlay} />
      </div>
      {speechError && <p className="tr-hint mt-2">{t("O áudio não está disponível agora. Você pode continuar sem ele.")}</p>}
      <button className="ds-btn ds-btn-cta mt-5" onClick={onNext}>{t("Próximo")}</button>
    </div>
  );
}

function Verdict({ verdict }: { verdict: Grade["verdict"] }) {
  if (verdict === "correct") return <p className="tr-verdict tr-verdict-correct"><CheckCircle2 aria-hidden="true" />{t("Certo")}</p>;
  if (verdict === "almost") return <p className="tr-verdict tr-verdict-almost"><CircleDot aria-hidden="true" />{t("Quase")}</p>;
  return <p className="tr-verdict tr-verdict-incorrect"><XCircle aria-hidden="true" />{t("Ainda não")}</p>;
}

function SpeakButton({ phrase, onPlay }: { phrase: string; onPlay: (phrase: string) => void }) {
  return <button type="button" className="tr-speak" aria-label={t("Ouvir frase")} onClick={() => onPlay(phrase)}><Volume2 className="size-4" /></button>;
}
