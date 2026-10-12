"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleDot, Dumbbell, Loader2, Play, RotateCcw, Volume2, XCircle } from "lucide-react";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { resolveInterviewerVoice } from "@/lib/interview/voices.mjs";
import { interviewerVoiceStorageKey } from "@/lib/interview/voice-picker.mjs";
import { getPracticeExercises, gradePracticeAnswer, type PracticeExercise } from "@/lib/practice/practice-requests";
import { normalizePracticeAnswer } from "@/lib/practice/practice-categories.mjs";
import { practiceLessonByKey, practiceRuleById, lessonRulesForRequest } from "@/lib/practice/practice-lessons.mjs";
import {
  loadPracticeAttempts,
  loadPracticeGroups,
  savePracticeAttempt,
  syncPracticeGroups,
  practiceSyncMaxBatches,
  updateGroupProgress,
  type PracticeAttempt,
  type PracticeGroup,
} from "@/lib/practice/practice-store";
import { sortPracticeGroups } from "@/lib/practice/practice-sync.mjs";
import { getCurrentLocale, t } from "@/lib/locale";
import { VoiceAnswerButton } from "./voice-answer-button";
import "./train.css";

type Grade = { verdict: "correct" | "almost" | "incorrect"; feedback: string; corrected: string };
const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const speechEndpoint = `${backendBaseUrl}/api/v1/speech`;
const syncWarning = "Não conseguimos analisar seus erros mais recentes agora; tentaremos de novo na próxima vez.";

export function TrainView({ onInterview }: { onInterview: () => void }) {
  const [themes, setThemes] = useState<PracticeGroup[]>([]);
  const [themeLoading, setThemeLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<PracticeGroup | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [exercises, setExercises] = useState<PracticeExercise[]>([]);
  const [exercisesLoading, setExercisesLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [grading, setGrading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<Grade | null>(null);
  const [results, setResults] = useState<Grade[]>([]);
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
      try {
        voice = resolveInterviewerVoice(localStorage.getItem(interviewerVoiceStorageKey));
      } catch {
        /* Use the default voice. */
      }
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
    const loaded = await loadPracticeGroups();
    if (!loaded.ok) {
      setLoadError(loaded.message);
      setThemeLoading(false);
      return;
    }
    setThemes(sortPracticeGroups(loaded.value));
    setThemeLoading(false);
    setSyncing(true);
    let current = loaded.value;
    for (let batch = 0; batch < practiceSyncMaxBatches; batch += 1) {
      const synced = await syncPracticeGroups(current);
      if (!synced.ok) {
        setSyncFailed(true);
        break;
      }
      setSyncFailed(false);
      current = synced.value.themes;
      setThemes(sortPracticeGroups(current));
      if (!synced.value.remaining) break;
    }
    setSyncing(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectTheme = async (theme: PracticeGroup) => {
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
    setResults([]);
    setExercises([]);
    try {
      const lesson = practiceLessonByKey[selected.theme_key];
      const response = await getPracticeExercises({
        theme: {
          title: lesson?.title ?? selected.title,
          explanation: lesson?.intro ?? selected.explanation,
          examples: selected.examples ?? [],
        },
        userErrors: [...new Map([...(selected.error_refs ?? [])].reverse().map((ref) => [ref.point, ref])).values()]
          .slice(0, 3)
          .map((ref) => ({ evidence: ref.evidence, rephrasedExample: ref.rephrased })),
        rules: lessonRulesForRequest(selected.theme_key),
      });
      setExercises(response.exercises.slice(0, 5));
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
      const rule = exercise.ruleId ? practiceRuleById[exercise.ruleId] : undefined;
      const grade =
        normalizePracticeAnswer(cleanAnswer) === normalizePracticeAnswer(exercise.target)
          ? { verdict: "correct" as const, feedback: t("Certo! Sua frase está correta."), corrected: exercise.target }
          : await gradePracticeAnswer({
              theme: { title: selected.title, explanation: selected.explanation },
              exercise: { ...exercise, ...(rule ? { rule: `${rule.label}: ${rule.when}` } : {}) },
              answer: cleanAnswer,
              mode,
            });
      const saved = await savePracticeAttempt({
        themeId: selected.id,
        kind: exercise.kind,
        instruction: exercise.instruction,
        mode,
        answer: cleanAnswer,
        ...grade,
      });
      if (!saved.ok) throw new Error(saved.message);
      setResult(grade);
      setResults((current) => [...current, grade]);
      setAttempts((current) => [saved.value, ...current].slice(0, 5));
      if (step === exercises.length - 1) {
        const finalResults = [...results, grade];
        const correct = finalResults.filter((item) => item.verdict === "correct").length;
        const updated = await updateGroupProgress(selected, correct, exercises.length);
        if (updated.ok) {
          setSelected(updated.value);
          setThemes((current) => current.map((theme) => (theme.id === updated.value.id ? updated.value : theme)));
        } else setFormError(updated.message);
      }
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
  const sorted = useMemo(() => sortPracticeGroups(themes), [themes]);
  const active = sorted.filter((theme) => theme.status !== "mastered");
  const mastered = sorted.filter((theme) => theme.status === "mastered");

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-4xl tracking-tight">{t("Treinar")}</h1>
        <p className="ds-body mt-2">{t("Aprenda um padrão por vez e pratique com frases das suas entrevistas.")}</p>
      </header>
      {loadError ? (
        <div className="tr-error" role="alert">
          <p>{loadError}</p>
          <button className="ds-btn ds-btn-soft" onClick={() => void load()}>
            {t("Tentar de novo")}
          </button>
        </div>
      ) : (
        <>
          {syncFailed && (
            <p className="tr-sync-warning" role="status">
              {t(syncWarning)}
            </p>
          )}
          {syncing && sorted.length > 0 && !selected && (
            <p className="ds-hint mb-3" role="status">
              {t("Analisando erros novos das suas entrevistas…")}
            </p>
          )}
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
              <button className="ds-btn ds-btn-cta mt-5" onClick={onInterview}>
                <Play className="size-4" />
                {t("Preparar entrevista")}
              </button>
            </section>
          ) : (
            <>
              {active.length ? (
                <ThemeList themes={active} onSelect={(theme) => void selectTheme(theme)} />
              ) : (
                <section className="tr-all-done ds-card p-6 sm:p-8">
                  <CheckCircle2 aria-hidden="true" />
                  <h2 className="ds-h2 mt-3">{t("Você concluiu todos os grupos!")}</h2>
                  <p className="ds-body mt-2">{t("Faça uma nova entrevista para descobrir o próximo ponto.")}</p>
                  <button className="ds-btn ds-btn-cta-green mt-5" onClick={onInterview}>
                    {t("Preparar entrevista")}
                  </button>
                </section>
              )}
              {!!mastered.length && (
                <details className="tr-completed">
                  <summary>{t("Concluídos ({count})", { count: mastered.length })}</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {mastered.map((theme) => {
                      const date = theme.updated_at ?? theme.last_error_at;
                      const locale = getCurrentLocale() === "en" ? "en-US" : "pt-BR";
                      return (
                        <article className="tr-completed-card" key={theme.id}>
                          <div>
                            <h3>{t(practiceLessonByKey[theme.theme_key]?.title ?? theme.title)}</h3>
                            <p>
                              {t("Concluído em {date}", {
                                date: date ? new Date(date).toLocaleDateString(locale) : t("Data não disponível"),
                              })}
                            </p>
                          </div>
                          <button className="ds-btn ds-btn-quiet" onClick={() => void selectTheme(theme)}>
                            {t("Revisar")}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
    </main>
  );

  function selectedView() {
    if (!selected) return null;
    if (sessionStarted) {
      const nextTheme = sorted.find((theme) => theme.id !== selected.id && theme.status !== "mastered");
      return (
        <PracticeSession
          exercises={exercises}
          loading={exercisesLoading}
          step={step}
          answer={answer}
          grading={grading}
          result={result}
          results={results}
          error={formError}
          speechError={speechError}
          theme={selected}
          onBack={() => {
            setSelected(null);
            setExercises([]);
            setSessionStarted(false);
          }}
          onBegin={() => void begin()}
          onAnswer={setAnswer}
          onVoiceAnswer={(value) => {
            setMode("voice");
            setAnswer(value);
            setFormError(null);
          }}
          onVoiceError={setFormError}
          onSubmit={() => void submit()}
          onNext={next}
          onInterview={onInterview}
          onNextGroup={nextTheme ? () => void selectTheme(nextTheme) : undefined}
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
        onBack={() => setSelected(null)}
        onBegin={() => void begin()}
        onPlay={(phrase) => void playPhrase(phrase)}
      />
    );
  }
}

function ThemeList({ themes, onSelect }: { themes: PracticeGroup[]; onSelect: (theme: PracticeGroup) => void }) {
  return (
    <section className="tr-list" aria-labelledby="train-topics">
      <h2 id="train-topics" className="ds-h2">
        {t("Seus grupos para treinar")}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {themes.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}
function ThemeCard({ theme, onSelect }: { theme: PracticeGroup; onSelect: (theme: PracticeGroup) => void }) {
  const lesson = practiceLessonByKey[theme.theme_key];
  const interviews = new Set(theme.error_refs?.map((ref) => ref.interview_id)).size;
  const points = [...new Set((theme.error_refs ?? []).map((ref) => ref.point).filter((point): point is string => Boolean(point)))];
  return (
    <article className="tr-card ds-card p-5 sm:p-6">
      <div>
        <h3 className="ds-h2">{t(lesson?.title ?? theme.title)}</h3>
        <p className="ds-small mt-1">{t(lesson?.subtitle ?? theme.explanation)}</p>
        <p className="ds-small mt-2">
          {t("{count} erros nas suas entrevistas", { count: theme.error_refs?.length ?? 0 })} <span aria-hidden="true">·</span>{" "}
          {t("{count} entrevistas", { count: interviews })}
        </p>
      </div>
      {points.length > 0 && (
        <ul className="tr-points mt-4" aria-label={t("Pontos específicos")}>
          {points.slice(0, 2).map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      <button className="ds-btn ds-btn-cta-green tr-card-action mt-5" onClick={() => onSelect(theme)}>
        <Dumbbell className="size-4" />
        {t("Começar")}
      </button>
    </article>
  );
}

function ThemeDetail({
  theme,
  attempts,
  attemptsLoading,
  speechError,
  onBack,
  onBegin,
  onPlay,
}: {
  theme: PracticeGroup;
  attempts: PracticeAttempt[];
  attemptsLoading: boolean;
  speechError: boolean;
  onBack: () => void;
  onBegin: () => void;
  onPlay: (phrase: string) => void;
}) {
  const [showAllErrors, setShowAllErrors] = useState(false);
  const lesson = practiceLessonByKey[theme.theme_key];
  const grouped = [...new Set((theme.error_refs ?? []).map((ref) => ref.point ?? t("Outros pontos")))].map((point) => ({
    point,
    refs: (theme.error_refs ?? []).filter((ref) => (ref.point ?? t("Outros pontos")) === point),
  }));
  return (
    <section className="tr-panel" aria-labelledby="lesson-title">
      <button className="ds-btn ds-btn-quiet mb-4" onClick={onBack}>
        <ArrowLeft className="size-4" />
        {t("Voltar aos grupos")}
      </button>
      <header className="tr-lesson-head">
        <h2 id="lesson-title" className="font-display text-3xl sm:text-4xl">
          {t(lesson?.title ?? theme.title)}
        </h2>
        <p className="ds-label mt-2">{t(lesson?.subtitle ?? theme.explanation)}</p>
        <p className="ds-body mt-3">{t(lesson?.intro ?? theme.why)}</p>
      </header>
      {lesson && (
        <div className="tr-rules mt-6">
          {lesson.rules.map((rule) => (
            <article className="tr-rule ds-card" key={rule.id}>
              <h3>{t(rule.label)}</h3>
              <p className="tr-rule-when">{t(rule.when)}</p>
              <ul className="tr-examples">
                {rule.examples.map((example) => (
                  <li key={example} lang="en">
                    <span>{example}</span>
                    <SpeakButton phrase={example} onPlay={onPlay} />
                  </li>
                ))}
              </ul>
              {rule.tip && <p className="tr-rule-tip">{t(rule.tip)}</p>}
            </article>
          ))}
        </div>
      )}
      {!!grouped.length && (
        <details className="tr-user-errors mt-6">
          <summary>{t("Onde você errou ({count})", { count: theme.error_refs?.length ?? 0 })}</summary>
          <div className="mt-3 grid gap-3">
            {grouped.slice(0, showAllErrors ? grouped.length : 3).map(({ point, refs }) => {
              const ref = refs[refs.length - 1];
              return (
                <article className="tr-evidence" key={point}>
                  <h3 className="ds-label">{point}</h3>
                  <p className="ds-small mt-2">
                    {t("Você disse")} <span lang="en">{ref.evidence}</span>
                  </p>
                  <p className="ds-small mt-1">
                    {t("Soa melhor")} <span lang="en">{ref.rephrased}</span>
                  </p>
                </article>
              );
            })}
          </div>
          {grouped.length > 3 && (
            <button
              className="ds-btn ds-btn-quiet mt-2"
              onClick={(event) => {
                event.preventDefault();
                setShowAllErrors((value) => !value);
              }}
            >
              {t(showAllErrors ? "Mostrar menos" : "Ver todos")}
            </button>
          )}
        </details>
      )}
      {speechError && (
        <p className="tr-hint mt-3" role="status">
          {t("O áudio não está disponível agora. Você pode continuar sem ele.")}
        </p>
      )}
      <section className="mt-6">
        <h3 className="ds-label">{t("Últimas tentativas")}</h3>
        {attemptsLoading ? (
          <Loader2 className="tr-spinner mt-3 size-5" aria-label={t("Carregando")} />
        ) : attempts.length ? (
          <ol className="tr-history mt-2">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <time>{new Date(attempt.created_at).toLocaleDateString("pt-BR")}</time>
                <p lang="en">{attempt.answer}</p>
                <Verdict verdict={attempt.verdict} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="ds-small mt-2">{t("Suas tentativas aparecerão aqui.")}</p>
        )}
      </section>
      <div className="tr-sticky-action">
        <button className="ds-btn ds-btn-cta-green" onClick={onBegin}>
          <Dumbbell className="size-4" />
          {t("Praticar · 5 exercícios")}
        </button>
      </div>
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
  results,
  error,
  speechError,
  theme,
  onBack,
  onBegin,
  onAnswer,
  onVoiceAnswer,
  onVoiceError,
  onSubmit,
  onNext,
  onInterview,
  onNextGroup,
  onPlay,
}: {
  exercises: PracticeExercise[];
  loading: boolean;
  step: number;
  answer: string;
  grading: boolean;
  result: Grade | null;
  results: Grade[];
  error: string | null;
  speechError: boolean;
  theme: PracticeGroup;
  onBack: () => void;
  onBegin: () => void;
  onAnswer: (text: string) => void;
  onVoiceAnswer: (text: string) => void;
  onVoiceError: (message: string) => void;
  onSubmit: () => void;
  onNext: () => void;
  onInterview: () => void;
  onNextGroup?: () => void;
  onPlay: (phrase: string) => void;
}) {
  if (loading)
    return (
      <section className="tr-panel ds-card p-5 sm:p-8" aria-busy="true">
        <Loader2 className="tr-spinner size-6" aria-label={t("Carregando exercícios")} />
        <p className="ds-body mt-3">{t("Preparando seus exercícios…")}</p>
      </section>
    );
  if (!exercises.length)
    return (
      <section className="tr-panel ds-card p-5 sm:p-8">
        <button className="ds-btn ds-btn-quiet" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("Voltar aos grupos")}
        </button>
        {error && (
          <p className="tr-form-error mt-4" role="alert">
            {error}
          </p>
        )}
        <button className="ds-btn ds-btn-cta-green mt-4" onClick={onBegin}>
          {t("Tentar de novo")}
        </button>
      </section>
    );
  if (step >= exercises.length) {
    const correct = results.filter((item) => item.verdict === "correct").length;
    const mastered = theme.status === "mastered";
    return (
      <section className={`tr-panel tr-results ${mastered ? "is-mastered" : ""}`} aria-live="polite">
        {mastered ? (
          <div className="tr-celebration-mark">
            <Check aria-hidden="true" />
          </div>
        ) : (
          <div className="tr-result-score">
            {correct}
            <span> / {exercises.length}</span>
          </div>
        )}
        <h2 className="font-display text-3xl sm:text-4xl">
          {t(mastered ? "Grupo concluído!" : "Faltou pouco: faça de novo para concluir")}
        </h2>
        <p className="ds-body mt-2">{t("Você acertou {correct} de {total}.", { correct, total: exercises.length })}</p>
        {mastered && <p className="ds-body mt-2">{t("Ele saiu da sua lista e volta se o erro aparecer de novo numa entrevista")}</p>}
        <ol className="tr-result-list mt-5">
          {results.map((item, index) => (
            <li key={`${index}-${item.verdict}`}>
              <span>{t("Exercício {current}", { current: index + 1 })}</span>
              {item.verdict === "correct" ? (
                <CheckCircle2 className="tr-verdict-correct" aria-label={t("Certo")} />
              ) : (
                <XCircle className="tr-verdict-incorrect" aria-label={t("Ainda não")} />
              )}
            </li>
          ))}
        </ol>
        {error && (
          <p className="tr-form-error mt-3" role="status">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {mastered ? (
            <>
              {onNextGroup && (
                <button className="ds-btn ds-btn-cta-green" onClick={onNextGroup}>
                  {t("Próximo grupo")}
                </button>
              )}
              <button className="ds-btn ds-btn-soft" onClick={onBack}>
                {t("Voltar aos grupos")}
              </button>
              <button className="ds-btn ds-btn-quiet" onClick={onInterview}>
                {t("Preparar entrevista")}
              </button>
            </>
          ) : (
            <>
              <button className="ds-btn ds-btn-cta-green" onClick={onBegin}>
                <RotateCcw className="size-4" />
                {t("Praticar de novo")}
              </button>
              <button className="ds-btn ds-btn-soft" onClick={onBack}>
                {t("Voltar aos grupos")}
              </button>
            </>
          )}
        </div>
      </section>
    );
  }
  const exercise = exercises[step];
  const kindLabel = exercise.kind === "fix" ? t("Sua frase") : exercise.kind === "spot" ? t("Encontre o erro") : t("Crie uma frase");
  return (
    <section className="tr-panel tr-practice" aria-live="polite">
      <button className="ds-btn ds-btn-quiet mb-4" onClick={onBack}>
        <ArrowLeft className="size-4" />
        {t("Voltar aos grupos")}
      </button>
      <div className="tr-progress-head">
        <p className="ds-label">{t("Exercício {current} de {total}", { current: step + 1, total: exercises.length })}</p>
        <div className="tr-progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={exercises.length} aria-valuenow={step + 1}>
          <span style={{ width: `${((step + 1) / exercises.length) * 100}%` }} />
        </div>
      </div>
      <div className="tr-exercise-card">
        <span className="tr-exercise-kind">{kindLabel}</span>
        <h2 className="ds-h2 mt-3">{exercise.instruction}</h2>
        {exercise.source && (
          <blockquote className="tr-source mt-4" lang="en">
            {exercise.source}
          </blockquote>
        )}
      </div>
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
        <PracticeFeedback result={result} exercise={exercise} error={error} speechError={speechError} onNext={onNext} onPlay={onPlay} />
      )}
    </section>
  );
}
function AnswerForm({
  value,
  disabled,
  error,
  onChange,
  onSubmit,
  onVoiceAnswer,
  onVoiceError,
}: {
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
      <label className="ds-label" htmlFor="practice-answer">
        {t("Sua resposta em inglês")}
      </label>
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
      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <VoiceAnswerButton onTranscript={onVoiceAnswer} onError={onVoiceError} disabled={disabled} />
        <button className="ds-btn ds-btn-cta-green" type="submit" disabled={disabled || !value.trim()}>
          {disabled ? (
            <>
              <Loader2 className="tr-spinner size-4" />
              {t("Avaliando…")}
            </>
          ) : (
            t("Enviar")
          )}
        </button>
      </div>
    </form>
  );
}
function PracticeFeedback({
  result,
  exercise,
  error,
  speechError,
  onNext,
  onPlay,
}: {
  result: Grade;
  exercise: PracticeExercise;
  error: string | null;
  speechError: boolean;
  onNext: () => void;
  onPlay: (phrase: string) => void;
}) {
  const rule = exercise.ruleId ? practiceRuleById[exercise.ruleId] : undefined;
  return (
    <div className="tr-feedback mt-5">
      <Verdict verdict={result.verdict} />
      <p className="ds-body mt-2">{result.feedback}</p>
      {error && (
        <p className="tr-form-error mt-3" role="status">
          {error}
        </p>
      )}
      <div className="tr-corrected mt-3" lang="en">
        <span>{result.corrected}</span>
        <SpeakButton phrase={result.corrected} onPlay={onPlay} />
      </div>
      {rule && (
        <aside className="tr-rule-mini mt-3">
          <strong>{rule.label}</strong>
          <p>{rule.when}</p>
          {rule.tip && <small>{rule.tip}</small>}
        </aside>
      )}
      {speechError && <p className="tr-hint mt-2">{t("O áudio não está disponível agora. Você pode continuar sem ele.")}</p>}
      <button className="ds-btn ds-btn-cta-green mt-5" onClick={onNext}>
        {t("Próximo")}
      </button>
    </div>
  );
}
function Verdict({ verdict }: { verdict: Grade["verdict"] }) {
  if (verdict === "correct")
    return (
      <p className="tr-verdict tr-verdict-correct">
        <CheckCircle2 aria-hidden="true" />
        {t("Certo")}
      </p>
    );
  if (verdict === "almost")
    return (
      <p className="tr-verdict tr-verdict-almost">
        <CircleDot aria-hidden="true" />
        {t("Quase")}
      </p>
    );
  return (
    <p className="tr-verdict tr-verdict-incorrect">
      <XCircle aria-hidden="true" />
      {t("Ainda não")}
    </p>
  );
}
function SpeakButton({ phrase, onPlay }: { phrase: string; onPlay: (phrase: string) => void }) {
  return (
    <button type="button" className="tr-speak" aria-label={t("Ouvir frase")} onClick={() => onPlay(phrase)}>
      <Volume2 className="size-4" />
    </button>
  );
}
