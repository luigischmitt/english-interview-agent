"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Dumbbell,
  Flame,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  XCircle,
} from "lucide-react";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { resolveInterviewerVoice } from "@/lib/interview/voices.mjs";
import { interviewerVoiceStorageKey } from "@/lib/interview/voice-picker.mjs";
import { gradePracticeAnswer } from "@/lib/practice/practice-requests";
import {
  checkFixedAnswer,
  pickPracticeRound,
  practiceLessonByKey,
  practiceLessons,
  practiceRuleById,
  ruleTextForRequest,
} from "@/lib/practice/practice-lessons.mjs";
import type { PracticeFixedExercise, PracticeLesson, PracticeLessonRule } from "@/lib/practice/practice-lessons.mjs";
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

type Grade = { verdict: "correct" | "almost" | "incorrect"; feedback: string; corrected: string; why?: string | null };
type RoundExercise = PracticeFixedExercise;
const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const speechEndpoint = `${backendBaseUrl}/api/v1/speech`;
const syncWarning = "Não conseguimos analisar seus erros mais recentes agora; tentaremos de novo na próxima vez.";

// Lessons opened from "Explorar" have no saved group: the person can study and practice, but nothing is stored.
function exploreGroup(lesson: PracticeLesson): PracticeGroup {
  return {
    id: "",
    user_id: "",
    theme_key: lesson.key,
    title: lesson.title,
    explanation: lesson.subtitle,
    why: lesson.intro,
    examples: [],
    error_refs: [],
    status: "active",
    correct_streak: 0,
    last_error_at: null,
    weighted_frequency: 0,
  };
}

// Which lesson parts this browser already opened: a per-viewer convenience, so storage failures are ignored.
function readSeenRules(key: string): string[] {
  try {
    const saved = localStorage.getItem(`practice-seen:${key}`);
    const parsed = saved ? (JSON.parse(saved) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function markSeenRule(key: string, ruleId: string): string[] {
  const seen = readSeenRules(key);
  if (seen.includes(ruleId)) return seen;
  const next = [...seen, ruleId];
  try {
    localStorage.setItem(`practice-seen:${key}`, JSON.stringify(next));
  } catch {
    // Continua sem lembrar as partes vistas.
  }
  return next;
}

export function TrainView({ onInterview }: { onInterview: () => void }) {
  const [themes, setThemes] = useState<PracticeGroup[]>([]);
  const [themeLoading, setThemeLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<PracticeGroup | null>(null);
  const [startRule, setStartRule] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [exercises, setExercises] = useState<RoundExercise[]>([]);
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

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selectTheme = async (theme: PracticeGroup, ruleIndex = 0) => {
    setSelected(theme);
    setStartRule(ruleIndex);
    setSessionStarted(false);
    setExercises([]);
    scrollToTop();
    if (!theme.id) {
      setAttempts([]);
      return;
    }
    setAttemptsLoading(true);
    const history = await loadPracticeAttempts(theme.id);
    setAttempts(history.ok ? history.value : []);
    setAttemptsLoading(false);
  };
  const begin = (theme: PracticeGroup | null = selected) => {
    if (!theme) return;
    setSelected(theme);
    setSessionStarted(true);
    setFormError(null);
    setResult(null);
    setAnswer("");
    setMode("text");
    setStep(0);
    setResults([]);
    scrollToTop();
    let recentIds: string[] = [];
    try {
      const saved = localStorage.getItem(`practice-recent:${theme.theme_key}`);
      recentIds = saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      recentIds = [];
    }
    const round = pickPracticeRound({
      key: theme.theme_key,
      // Only fixed exercises: the person's own interview sentences lack context and were too vague to practice with.
      recentIds,
    });
    setExercises(round);
    try {
      localStorage.setItem(
        `practice-recent:${theme.theme_key}`,
        JSON.stringify([...recentIds, ...round.map((exercise) => exercise.id)].slice(-10)),
      );
    } catch {
      // A rodada continua normalmente quando o armazenamento local não está disponível.
    }
  };

  const submit = async (chosen?: string) => {
    const submittedAnswer = chosen ?? answer;
    if (!selected || !exercises[step] || !submittedAnswer.trim() || grading) return;
    setGrading(true);
    if (chosen) setAnswer(chosen);
    setFormError(null);
    const exercise = exercises[step];
    const cleanAnswer = submittedAnswer.trim();
    const tracked = Boolean(selected.id);
    try {
      const correctLocally = checkFixedAnswer(exercise, cleanAnswer);
      const grade =
        exercise.kind === "choose"
          ? {
              verdict: correctLocally ? ("correct" as const) : ("incorrect" as const),
              feedback: correctLocally ? t("Resposta correta.") : t("A opção correta está destacada acima."),
              corrected: exercise.sentence.replace("___", exercise.answer),
              why: exercise.why,
            }
          : correctLocally
            ? {
                verdict: "correct" as const,
                feedback: t("Resposta correta."),
                corrected: cleanAnswer,
                why: exercise.why,
              }
            : await gradePracticeAnswer({
                theme: { title: selected.title, explanation: selected.explanation },
                exercise: {
                  kind: "fix",
                  instruction: exercise.kind === "spot" ? "Encontre e corrija o erro" : "Sua frase: reescreva certo",
                  source: exercise.sentence,
                  target: cleanAnswer,
                  ruleId: exercise.ruleId,
                  rule: exercise.ruleId ? (ruleTextForRequest(exercise.ruleId) ?? undefined) : undefined,
                },
                answer: cleanAnswer,
                mode,
              });
      if (tracked) {
        const saved = await savePracticeAttempt({
          themeId: selected.id,
          kind: exercise.kind === "choose" ? "build" : "fix",
          instruction:
            exercise.kind === "choose"
              ? t("Escolha a opção correta")
              : exercise.kind === "spot"
                ? t("Encontre e corrija o erro")
                : t("Reescreva sua frase corretamente"),
          mode,
          answer: cleanAnswer,
          ...grade,
        });
        if (!saved.ok) throw new Error(saved.message);
        setAttempts((current) => [saved.value, ...current].slice(0, 5));
      }
      setResult(grade);
      setResults((current) => [...current, grade]);
      if (tracked && step === exercises.length - 1) {
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
  const explore = practiceLessons.filter((lesson) => !themes.some((theme) => theme.theme_key === lesson.key));
  const backToList = () => {
    setSelected(null);
    setExercises([]);
    setSessionStarted(false);
    scrollToTop();
  };

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      {loadError ? (
        <>
          <ListHeader />
          <div className="tr-error" role="alert">
            <p>{loadError}</p>
            <button className="ds-btn ds-btn-soft" onClick={() => void load()}>
              {t("Tentar de novo")}
            </button>
          </div>
        </>
      ) : selected ? (
        selectedView()
      ) : (
        <>
          <ListHeader done={mastered.length} total={sorted.length} />
          {syncFailed && (
            <p className="tr-sync-warning" role="status">
              {t(syncWarning)}
            </p>
          )}
          {syncing && sorted.length > 0 && (
            <p className="tr-syncing" role="status">
              <Loader2 className="tr-spinner size-4" aria-hidden="true" />
              {t("Analisando erros novos das suas entrevistas…")}
            </p>
          )}
          {themeLoading ? (
            <div className="tr-grid" aria-busy="true">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="tr-skeleton skeleton h-56 w-full" />
              ))}
            </div>
          ) : sorted.length === 0 && syncing ? (
            <section className="shl-dashed flex items-center gap-3 p-6" aria-busy="true">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <p className="ds-body">{t("Analisando os erros das suas entrevistas… isso leva alguns segundos na primeira vez.")}</p>
            </section>
          ) : (
            <>
              {sorted.length === 0 ? (
                <section className="shl-dashed p-6">
                  <p className="ds-body">{t("Faça uma entrevista para descobrirmos o que você precisa treinar")}</p>
                  <button className="ds-btn ds-btn-cta mt-5" onClick={onInterview}>
                    <Play className="size-4" />
                    {t("Preparar entrevista")}
                  </button>
                </section>
              ) : active.length ? (
                <ThemeList
                  themes={active}
                  onOpen={(theme, ruleIndex) => void selectTheme(theme, ruleIndex)}
                  onPractice={(theme) => begin(theme)}
                />
              ) : (
                <section className="tr-all-done ds-card p-6 sm:p-8">
                  <div className="tr-celebration-mark">
                    <Check aria-hidden="true" />
                  </div>
                  <h2 className="ds-h2">{t("Você concluiu todos os grupos!")}</h2>
                  <p className="ds-body mt-2">{t("Faça uma nova entrevista para descobrir o próximo ponto.")}</p>
                  <button className="ds-btn ds-btn-cta-green mt-5" onClick={onInterview}>
                    {t("Preparar entrevista")}
                  </button>
                </section>
              )}
              {!!explore.length && (
                <section className="tr-explore" aria-labelledby="train-explore">
                  <div className="tr-section-head">
                    <h2 id="train-explore" className="ds-h2">
                      {t("Explorar outros conteúdos")}
                    </h2>
                    <p className="ds-small">{t("Temas que ainda não apareceram nas suas entrevistas. Estude quando quiser.")}</p>
                  </div>
                  <div className="tr-explore-grid">
                    {explore.map((lesson, index) => (
                      <button
                        type="button"
                        key={lesson.key}
                        className="tr-explore-tile"
                        style={{ "--i": index } as CSSProperties}
                        onClick={() => void selectTheme(exploreGroup(lesson))}
                      >
                        <BookOpen className="size-4 shrink-0" aria-hidden="true" />
                        <span>
                          <strong>{t(lesson.title)}</strong>
                          <small>{t(lesson.subtitle)}</small>
                        </span>
                        <ArrowRight className="tr-explore-arrow size-4" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {!!mastered.length && (
                <details className="tr-completed">
                  <summary>
                    <ChevronDown className="size-4" aria-hidden="true" />
                    {t("Concluídos ({count})", { count: mastered.length })}
                  </summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {mastered.map((theme) => {
                      const date = theme.updated_at ?? theme.last_error_at;
                      const locale = getCurrentLocale() === "en" ? "en-US" : "pt-BR";
                      return (
                        <article className="tr-completed-card" key={theme.id}>
                          <CheckCircle2 className="tr-verdict-correct size-5 shrink-0" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
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
          step={step}
          answer={answer}
          grading={grading}
          result={result}
          results={results}
          error={formError}
          speechError={speechError}
          theme={selected}
          onBack={backToList}
          onLesson={() => void selectTheme(selected)}
          onBegin={() => begin()}
          onAnswer={setAnswer}
          onVoiceAnswer={(value) => {
            setMode("voice");
            setAnswer(value);
            setFormError(null);
          }}
          onVoiceError={setFormError}
          onSubmit={() => void submit()}
          onChoose={(option) => void submit(option)}
          onNext={next}
          onInterview={onInterview}
          onNextGroup={nextTheme ? () => void selectTheme(nextTheme) : undefined}
          onPlay={(phrase) => void playPhrase(phrase)}
        />
      );
    }
    return (
      <ThemeDetail
        key={`${selected.theme_key}-${startRule}`}
        theme={selected}
        initialRule={startRule}
        attempts={attempts}
        attemptsLoading={attemptsLoading}
        speechError={speechError}
        onBack={backToList}
        onBegin={() => begin()}
        onPlay={(phrase) => void playPhrase(phrase)}
      />
    );
  }
}

function ListHeader({ done, total }: { done?: number; total?: number }) {
  return (
    <header className="tr-hero">
      <div className="min-w-0">
        <h1 className="font-display text-4xl tracking-tight">{t("Treinar")}</h1>
        <p className="ds-body mt-2">{t("Escolha um tema, estude a parte que quiser e pratique com exercícios curtos.")}</p>
      </div>
      {!!total && (
        <div className="tr-hero-progress">
          <ProgressRing value={(done ?? 0) / total} size={52}>
            <span className="tr-ring-text">
              {done}/{total}
            </span>
          </ProgressRing>
          <p>
            <strong>{t("{done} de {total} grupos", { done: done ?? 0, total })}</strong>
            <span>{t("concluídos")}</span>
          </p>
        </div>
      )}
    </header>
  );
}

function ProgressRing({ value, size, children }: { value: number; size: number; children?: ReactNode }) {
  const stroke = size > 44 ? 5 : 3.5;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="tr-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="tr-ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          className="tr-ring-value"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - clamped)}
          style={{ "--tr-ring-length": `${length}` } as CSSProperties}
        />
      </svg>
      {children && <div className="tr-ring-label">{children}</div>}
    </div>
  );
}

function ThemeList({
  themes,
  onOpen,
  onPractice,
}: {
  themes: PracticeGroup[];
  onOpen: (theme: PracticeGroup, ruleIndex?: number) => void;
  onPractice: (theme: PracticeGroup) => void;
}) {
  const maxErrors = Math.max(1, ...themes.map((theme) => theme.error_refs?.length ?? 0));
  return (
    <section aria-labelledby="train-topics">
      <div className="tr-section-head">
        <h2 id="train-topics" className="ds-h2">
          {t("Seus pontos de atenção")}
        </h2>
        <p className="ds-small">{t("Ordenados pelo que mais aparece nas suas entrevistas. Toque numa parte para ir direto a ela.")}</p>
      </div>
      <div className="tr-grid">
        {themes.map((theme, index) => (
          <ThemeCard key={theme.id} theme={theme} index={index} maxErrors={maxErrors} onOpen={onOpen} onPractice={onPractice} />
        ))}
      </div>
    </section>
  );
}
function ThemeCard({
  theme,
  index,
  maxErrors,
  onOpen,
  onPractice,
}: {
  theme: PracticeGroup;
  index: number;
  maxErrors: number;
  onOpen: (theme: PracticeGroup, ruleIndex?: number) => void;
  onPractice: (theme: PracticeGroup) => void;
}) {
  const lesson = practiceLessonByKey[theme.theme_key];
  const errors = theme.error_refs?.length ?? 0;
  const interviews = new Set(theme.error_refs?.map((ref) => ref.interview_id)).size;
  const [seen] = useState(() => readSeenRules(theme.theme_key));
  const rules = lesson?.rules ?? [];
  const seenCount = rules.filter((rule) => seen.includes(rule.id)).length;
  const firstUnseen = Math.max(
    0,
    rules.findIndex((rule) => !seen.includes(rule.id)),
  );
  return (
    <article className="tr-card" style={{ "--i": index } as CSSProperties}>
      <div className="tr-card-top">
        <div className="min-w-0">
          {index === 0 && <span className="tr-badge-hot">{t("Mais frequente")}</span>}
          <h3 className="tr-card-title">{t(lesson?.title ?? theme.title)}</h3>
          <p className="ds-small">{t(lesson?.subtitle ?? theme.explanation)}</p>
        </div>
        {rules.length > 0 && (
          <ProgressRing value={seenCount / rules.length} size={42}>
            <span className="tr-ring-text tr-ring-text-sm">
              {seenCount}/{rules.length}
            </span>
          </ProgressRing>
        )}
      </div>
      <div className="tr-meter">
        <div className="tr-meter-track" aria-hidden="true">
          <span style={{ width: `${Math.max(8, (errors / maxErrors) * 100)}%` }} />
        </div>
        <p>
          {t("{count} erros", { count: errors })} <span aria-hidden="true">·</span> {t("{count} entrevistas", { count: interviews })}
        </p>
      </div>
      {rules.length > 0 && (
        <div className="tr-chips">
          <p className="tr-mini-label">{t("Partes da aula")}</p>
          <ul>
            {rules.map((rule, ruleIndex) => {
              const done = seen.includes(rule.id);
              return (
                <li key={rule.id}>
                  <button type="button" className={`tr-chip ${done ? "is-seen" : ""}`} onClick={() => onOpen(theme, ruleIndex)}>
                    {done && <Check className="size-3" aria-label={t("Vista")} />}
                    {t(rule.label)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="tr-card-actions">
        <button className="ds-btn ds-btn-cta-green" onClick={() => onOpen(theme, firstUnseen)}>
          <BookOpen className="size-4" />
          {seenCount === 0 ? t("Estudar") : seenCount === rules.length ? t("Rever aula") : t("Continuar")}
        </button>
        <button className="ds-btn ds-btn-soft" onClick={() => onPractice(theme)}>
          <Dumbbell className="size-4" />
          {t("Praticar")}
        </button>
      </div>
    </article>
  );
}

function ThemeDetail({
  theme,
  initialRule,
  attempts,
  attemptsLoading,
  speechError,
  onBack,
  onBegin,
  onPlay,
}: {
  theme: PracticeGroup;
  initialRule: number;
  attempts: PracticeAttempt[];
  attemptsLoading: boolean;
  speechError: boolean;
  onBack: () => void;
  onBegin: () => void;
  onPlay: (phrase: string) => void;
}) {
  const lesson = practiceLessonByKey[theme.theme_key];
  const ruleCount = lesson?.rules.length ?? 0;
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [activeRuleIndex, setActiveRuleIndex] = useState(() => Math.min(initialRule, Math.max(0, ruleCount - 1)));
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [seen, setSeen] = useState<string[]>(() => readSeenRules(theme.theme_key));
  const ruleButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ruleTopRef = useRef<HTMLDivElement | null>(null);
  const activeRule = lesson?.rules[activeRuleIndex] ?? lesson?.rules[0];
  useEffect(() => {
    if (!activeRule) return;
    const timer = window.setTimeout(() => setSeen(markSeenRule(theme.theme_key, activeRule.id)), 0);
    return () => window.clearTimeout(timer);
  }, [activeRule, theme.theme_key]);
  const selectRule = (index: number, focus = false, scroll = false) => {
    if (!lesson) return;
    const nextIndex = (index + lesson.rules.length) % lesson.rules.length;
    setDirection(nextIndex >= activeRuleIndex ? "next" : "prev");
    setActiveRuleIndex(nextIndex);
    if (focus) requestAnimationFrame(() => ruleButtonRefs.current[nextIndex]?.focus());
    if (scroll) {
      const top = ruleTopRef.current;
      if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };
  const handleRuleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectRule(0, true);
    if (event.key === "End") return selectRule(ruleCount - 1, true);
    selectRule(index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1), true);
  };
  const grouped = [...new Set((theme.error_refs ?? []).map((ref) => ref.point ?? t("Outros pontos")))].map((point) => ({
    point,
    refs: (theme.error_refs ?? []).filter((ref) => (ref.point ?? t("Outros pontos")) === point),
  }));
  const seenCount = lesson ? lesson.rules.filter((rule) => seen.includes(rule.id)).length : 0;
  const isLast = activeRuleIndex === ruleCount - 1;
  return (
    <section className="tr-panel tr-enter" aria-labelledby="lesson-title">
      <button className="ds-btn ds-btn-quiet tr-back" onClick={onBack}>
        <ArrowLeft className="size-4" />
        {t("Voltar aos temas")}
      </button>
      <header className="tr-lesson-hero">
        <div className="min-w-0">
          <p className="tr-eyebrow">{t(lesson?.subtitle ?? theme.explanation)}</p>
          <h1 id="lesson-title" className="font-display text-4xl tracking-tight sm:text-5xl">
            {t(lesson?.title ?? theme.title)}
          </h1>
          <p className="ds-body mt-3">{t(lesson?.intro ?? theme.why)}</p>
        </div>
        {lesson?.outcome && (
          <aside className="tr-outcome">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="tr-mini-label">{t("Você vai aprender")}</p>
              <p>{t(lesson.outcome)}</p>
            </div>
          </aside>
        )}
      </header>
      {lesson && activeRule && (
        <div className="tr-lesson-layout" ref={ruleTopRef}>
          <nav className="tr-rule-nav" aria-label={t("Conteúdo da aula")}>
            <div className="tr-rule-nav-head">
              <p className="tr-mini-label">{t("Conteúdo da aula")}</p>
              <span>
                {seenCount}/{ruleCount}
              </span>
            </div>
            <div className="tr-rule-nav-track" aria-hidden="true">
              <span style={{ width: `${(seenCount / Math.max(1, ruleCount)) * 100}%` }} />
            </div>
            <div className="tr-rule-tabs" role="tablist" aria-orientation="vertical">
              {lesson.rules.map((rule, index) => {
                const isActive = index === activeRuleIndex;
                const done = seen.includes(rule.id);
                return (
                  <button
                    ref={(node) => {
                      ruleButtonRefs.current[index] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`lesson-tab-${rule.id}`}
                    aria-selected={isActive}
                    aria-controls="active-lesson-rule"
                    tabIndex={isActive ? 0 : -1}
                    className={`tr-rule-tab ${isActive ? "is-active" : ""} ${done ? "is-seen" : ""}`}
                    key={rule.id}
                    onClick={() => selectRule(index)}
                    onKeyDown={(event) => handleRuleKeyDown(event, index)}
                  >
                    <span className="tr-rule-num" aria-hidden="true">
                      {done && !isActive ? <Check className="size-3" /> : index + 1}
                    </span>
                    <span>{t(rule.label)}</span>
                  </button>
                );
              })}
            </div>
          </nav>
          <article
            id="active-lesson-rule"
            key={activeRule.id}
            className={`tr-rule tr-rule-${direction}`}
            role="tabpanel"
            aria-labelledby={`lesson-tab-${activeRule.id}`}
          >
            <div className="tr-rule-heading">
              <p className="tr-rule-progress">{t("Parte {current} de {total}", { current: activeRuleIndex + 1, total: ruleCount })}</p>
              <h2>{t(activeRule.label)}</h2>
              <p className="tr-rule-goal">{t(activeRule.goal)}</p>
            </div>
            <div className="tr-formula">
              <div>
                <p className="tr-mini-label">{t("A fórmula")}</p>
                <p className="tr-pattern">{t(activeRule.pattern)}</p>
              </div>
              <div>
                <p className="tr-mini-label">{t("Quando usar")}</p>
                <p className="tr-rule-when">{t(activeRule.when)}</p>
              </div>
            </div>
            <section className="tr-rule-section" aria-label={t("Como usar")}>
              <p className="tr-rule-explain">{t(activeRule.explain)}</p>
              <ul className="tr-rule-points">
                {activeRule.points.map((point) => (
                  <li key={point}>{t(point)}</li>
                ))}
              </ul>
            </section>
            {activeRule.wrong && activeRule.right && <RuleCheck rule={activeRule} onPlay={onPlay} />}
            <section className="tr-rule-section" aria-labelledby="rule-examples-title">
              <p id="rule-examples-title" className="tr-mini-label">
                {t("Ouça e repita")}
              </p>
              <ul className="tr-examples">
                {activeRule.examples.map((example, index) => (
                  <li className="tr-example" key={example.en} style={{ "--i": index } as CSSProperties}>
                    <SpeakButton phrase={example.en} onPlay={onPlay} />
                    <div className="min-w-0">
                      <p lang="en">{example.en}</p>
                      <p className="tr-example-pt">{t(example.pt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            {activeRule.tip && (
              <p className="tr-rule-tip">
                <strong>{t("Lembrete:")}</strong> {t(activeRule.tip)}
              </p>
            )}
            {speechError && (
              <p className="tr-hint" role="status">
                {t("O áudio não está disponível agora. Você pode continuar sem ele.")}
              </p>
            )}
            <div className="tr-rule-controls">
              <button
                type="button"
                className="ds-btn ds-btn-quiet"
                disabled={activeRuleIndex === 0}
                onClick={() => selectRule(activeRuleIndex - 1, false, true)}
              >
                <ArrowLeft className="size-4" />
                {t("Anterior")}
              </button>
              {isLast ? (
                <button type="button" className="ds-btn ds-btn-cta-green" onClick={onBegin}>
                  <Dumbbell className="size-4" />
                  {t("Praticar agora")}
                </button>
              ) : (
                <button type="button" className="ds-btn ds-btn-soft" onClick={() => selectRule(activeRuleIndex + 1, false, true)}>
                  {t("Próxima parte")}
                  <ArrowRight className="size-4" />
                </button>
              )}
            </div>
          </article>
        </div>
      )}
      {(!!grouped.length || !!theme.id) && (
        <div className="tr-lesson-extras">
          {!!grouped.length && (
            <details className="tr-extra-card">
              <summary>
                <span>
                  <strong>{t("Onde você errou")}</strong>
                  <small>{t("{count} trechos das suas entrevistas", { count: theme.error_refs?.length ?? 0 })}</small>
                </span>
                <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
              </summary>
              <div className="tr-extra-body">
                {grouped.slice(0, showAllErrors ? grouped.length : 3).map(({ point, refs }) => {
                  const ref = refs[refs.length - 1];
                  return (
                    <article className="tr-evidence" key={point}>
                      <h3>{point}</h3>
                      <p className="tr-evidence-said">
                        <span>{t("Você disse")}</span> <q lang="en">{ref.evidence}</q>
                      </p>
                      <p className="tr-evidence-better">
                        <span>{t("Soa melhor")}</span> <q lang="en">{ref.rephrased}</q>
                      </p>
                    </article>
                  );
                })}
                {grouped.length > 3 && (
                  <button className="ds-btn ds-btn-quiet" onClick={() => setShowAllErrors((value) => !value)}>
                    {t(showAllErrors ? "Mostrar menos" : "Ver todos")}
                  </button>
                )}
              </div>
            </details>
          )}
          {!!theme.id && (
            <details className="tr-extra-card">
              <summary>
                <span>
                  <strong>{t("Últimas tentativas")}</strong>
                  <small>{attemptsLoading ? t("Carregando") : t("{count} respostas recentes", { count: attempts.length })}</small>
                </span>
                <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
              </summary>
              <div className="tr-extra-body">
                {attemptsLoading ? (
                  <Loader2 className="tr-spinner size-5" aria-label={t("Carregando")} />
                ) : attempts.length ? (
                  <ol className="tr-history">
                    {attempts.map((attempt) => (
                      <li key={attempt.id}>
                        <VerdictIcon verdict={attempt.verdict} />
                        <p lang="en">{attempt.answer}</p>
                        <time>{new Date(attempt.created_at).toLocaleDateString(getCurrentLocale() === "en" ? "en-US" : "pt-BR")}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="ds-small">{t("Suas tentativas aparecerão aqui.")}</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="tr-practice-cta">
        <div className="tr-practice-cta-copy">
          <span className="tr-practice-cta-icon" aria-hidden="true">
            <Dumbbell className="size-5" />
          </span>
          <div>
            <strong>{t("Pronto para praticar?")}</strong>
            <span>{t("5 exercícios rápidos · escolha e correção")}</span>
          </div>
        </div>
        <button className="ds-btn ds-btn-cta-green" onClick={onBegin}>
          {t("Praticar")}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </section>
  );
}

// A one-tap check inside each lesson part: the person picks the correct sentence before seeing the answer.
function RuleCheck({ rule, onPlay }: { rule: PracticeLessonRule; onPlay: (phrase: string) => void }) {
  const [picked, setPicked] = useState<"right" | "wrong" | null>(null);
  const rightFirst = [...rule.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0;
  const options: Array<"right" | "wrong"> = rightFirst ? ["right", "wrong"] : ["wrong", "right"];
  return (
    <section className="tr-check" aria-labelledby={`check-${rule.id}`}>
      <div className="tr-check-head">
        <p id={`check-${rule.id}`} className="tr-mini-label">
          {t("Teste rápido")}
        </p>
        <p className="tr-check-question">{t("Qual destas frases está certa?")}</p>
      </div>
      <div className="tr-check-options">
        {options.map((option) => {
          const text = option === "right" ? rule.right : rule.wrong;
          const reveal = picked !== null;
          const state = !reveal ? "" : option === "right" ? "is-correct" : picked === "wrong" ? "is-wrong" : "is-dim";
          return (
            <button
              type="button"
              key={option}
              className={`tr-check-option ${state}`}
              disabled={reveal}
              onClick={() => setPicked(option)}
            >
              <span className="tr-check-mark" aria-hidden="true">
                {reveal ? option === "right" ? <Check className="size-3.5" /> : <XCircle className="size-3.5" /> : null}
              </span>
              <span lang="en">{text}</span>
            </button>
          );
        })}
      </div>
      <div aria-live="polite">
        {picked && (
          <div className={`tr-check-result ${picked === "right" ? "is-correct" : "is-wrong"}`}>
            <p>
              <strong>{picked === "right" ? t("Isso!") : t("Quase — a certa é a outra.")}</strong> {t(rule.when)}
            </p>
            {rule.right && <SpeakButton phrase={rule.right} onPlay={onPlay} />}
          </div>
        )}
      </div>
    </section>
  );
}

function PracticeSession({
  exercises,
  step,
  answer,
  grading,
  result,
  results,
  error,
  speechError,
  theme,
  onBack,
  onLesson,
  onBegin,
  onAnswer,
  onVoiceAnswer,
  onVoiceError,
  onSubmit,
  onChoose,
  onNext,
  onInterview,
  onNextGroup,
  onPlay,
}: {
  exercises: RoundExercise[];
  step: number;
  answer: string;
  grading: boolean;
  result: Grade | null;
  results: Grade[];
  error: string | null;
  speechError: boolean;
  theme: PracticeGroup;
  onBack: () => void;
  onLesson: () => void;
  onBegin: () => void;
  onAnswer: (text: string) => void;
  onVoiceAnswer: (text: string) => void;
  onVoiceError: (message: string) => void;
  onSubmit: () => void;
  onChoose: (option: string) => void;
  onNext: () => void;
  onInterview: () => void;
  onNextGroup?: () => void;
  onPlay: (phrase: string) => void;
}) {
  const exercise = exercises[step] as RoundExercise | undefined;
  const choose = exercise?.kind === "choose";
  const lessonTitle = t(practiceLessonByKey[theme.theme_key]?.title ?? theme.title);
  useEffect(() => {
    if (!exercise || !choose || result || grading) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const option = exercise.options?.[Number(event.key) - 1];
      if (!option) return;
      event.preventDefault();
      onAnswer(option);
      onChoose(option);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exercise, choose, result, grading, onAnswer, onChoose]);

  if (!exercises.length)
    return (
      <section className="tr-panel ds-card p-5 sm:p-8">
        <button className="ds-btn ds-btn-quiet" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("Voltar aos temas")}
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
  if (step >= exercises.length || !exercise) {
    return (
      <PracticeResults
        results={results}
        total={exercises.length}
        theme={theme}
        lessonTitle={lessonTitle}
        error={error}
        onBack={onBack}
        onBegin={onBegin}
        onLesson={onLesson}
        onInterview={onInterview}
        onNextGroup={onNextGroup}
      />
    );
  }
  let streak = 0;
  for (let index = results.length - 1; index >= 0 && results[index].verdict === "correct"; index -= 1) streak += 1;
  const kindLabel = choose ? t("Complete a frase") : t("Encontre e corrija o erro");
  const hintRule = exercise.ruleId ? practiceRuleById[exercise.ruleId] : undefined;
  return (
    <section className="tr-panel tr-practice" aria-labelledby="exercise-title">
      <div className="tr-practice-top">
        <button className="ds-btn ds-btn-quiet tr-back" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("Sair")}
        </button>
        <p className="tr-practice-theme">{lessonTitle}</p>
        {streak >= 2 ? (
          <span className="tr-streak" key={streak}>
            <Flame className="size-4" aria-hidden="true" />
            {t("{count} seguidas", { count: streak })}
          </span>
        ) : (
          <span className="tr-streak-placeholder" aria-hidden="true" />
        )}
      </div>
      <ol className="tr-steps" aria-label={t("Exercício {current} de {total}", { current: step + 1, total: exercises.length })}>
        {exercises.map((item, index) => {
          const done = results[index];
          const state = done ? (done.verdict === "correct" ? "is-correct" : "is-wrong") : index === step ? "is-current" : "";
          return <li key={item.id} className={`tr-step ${state}`} />;
        })}
      </ol>
      <div className="tr-exercise-card" key={exercise.id}>
        <div className="tr-exercise-meta">
          <span className="tr-exercise-kind">{kindLabel}</span>
          <span className="tr-exercise-count">
            {step + 1}/{exercises.length}
          </span>
        </div>
        <h2 id="exercise-title" className="tr-exercise-title">
          {choose ? t("Qual opção completa a frase?") : t("Esta frase tem um erro. Reescreva-a corrigida.")}
        </h2>
        <blockquote className="tr-source" lang="en">
          {choose
            ? exercise.sentence.split("___").map((part, index, parts) => (
                <span key={`${part}-${index}`}>
                  {part}
                  {index < parts.length - 1 && (
                    <mark className={`tr-blank ${result ? (result.verdict === "correct" ? "is-correct" : "is-wrong") : ""}`}>
                      {result ? exercise.answer : "___"}
                    </mark>
                  )}
                </span>
              ))
            : exercise.sentence}
        </blockquote>
        {!choose && hintRule && !result && (
          <details className="tr-hint-toggle">
            <summary>{t("Preciso de uma dica")}</summary>
            <p>{t("Dica: {label} — {when}", { label: t(hintRule.label), when: t(hintRule.when) })}</p>
          </details>
        )}
        {choose ? (
          <div className="tr-choice-list" role="group" aria-label={t("Escolha a opção correta")}>
            {exercise.options?.map((option, index) => (
              <button
                className={choiceClass(option, exercise, answer, Boolean(result))}
                key={option}
                style={{ "--i": index } as CSSProperties}
                disabled={grading || Boolean(result)}
                onClick={() => {
                  onAnswer(option);
                  onChoose(option);
                }}
              >
                <kbd aria-hidden="true">{index + 1}</kbd>
                <span lang="en">{option}</span>
              </button>
            ))}
          </div>
        ) : (
          !result && (
            <AnswerForm
              value={answer}
              disabled={grading}
              error={error}
              onChange={onAnswer}
              onSubmit={onSubmit}
              onVoiceAnswer={onVoiceAnswer}
              onVoiceError={onVoiceError}
            />
          )
        )}
        {choose && !result && <p className="tr-keys-hint">{t("Atalho: teclas 1 a {count}", { count: exercise.options?.length ?? 0 })}</p>}
      </div>
      {result && (
        <PracticeFeedback
          result={result}
          exercise={exercise}
          error={error}
          speechError={speechError}
          last={step === exercises.length - 1}
          onNext={onNext}
          onPlay={onPlay}
        />
      )}
    </section>
  );
}

function PracticeResults({
  results,
  total,
  theme,
  lessonTitle,
  error,
  onBack,
  onBegin,
  onLesson,
  onInterview,
  onNextGroup,
}: {
  results: Grade[];
  total: number;
  theme: PracticeGroup;
  lessonTitle: string;
  error: string | null;
  onBack: () => void;
  onBegin: () => void;
  onLesson: () => void;
  onInterview: () => void;
  onNextGroup?: () => void;
}) {
  const correct = results.filter((item) => item.verdict === "correct").length;
  const tracked = Boolean(theme.id);
  const mastered = tracked && theme.status === "mastered";
  const great = correct / Math.max(1, total) >= 0.8;
  const title = mastered
    ? t("Grupo concluído!")
    : great
      ? t("Mandou bem!")
      : tracked
        ? t("Faltou pouco: faça de novo para concluir")
        : t("Rodada concluída");
  return (
    <section className={`tr-panel tr-results ${mastered ? "is-mastered" : ""}`} aria-live="polite">
      {(mastered || great) && <Confetti />}
      <div className="tr-results-head">
        <ProgressRing value={correct / Math.max(1, total)} size={96}>
          {mastered ? (
            <Check className="tr-results-check" aria-hidden="true" />
          ) : (
            <span className="tr-result-score">
              {correct}
              <small>/{total}</small>
            </span>
          )}
        </ProgressRing>
        <div className="min-w-0">
          <p className="tr-eyebrow">{lessonTitle}</p>
          <h2 className="font-display text-3xl sm:text-4xl">{title}</h2>
          <p className="ds-body mt-2">{t("Você acertou {correct} de {total}.", { correct, total })}</p>
          {mastered && <p className="ds-small mt-1">{t("Ele saiu da sua lista e volta se o erro aparecer de novo numa entrevista")}</p>}
        </div>
      </div>
      <ol className="tr-result-list">
        {results.map((item, index) => (
          <li key={`${index}-${item.verdict}`} style={{ "--i": index } as CSSProperties}>
            <VerdictIcon verdict={item.verdict} />
            <span lang="en">{item.corrected}</span>
          </li>
        ))}
      </ol>
      {error && (
        <p className="tr-form-error mt-3" role="status">
          {error}
        </p>
      )}
      <div className="tr-results-actions">
        {mastered && onNextGroup ? (
          <button className="ds-btn ds-btn-cta-green" onClick={onNextGroup}>
            {t("Próximo grupo")}
            <ArrowRight className="size-4" />
          </button>
        ) : (
          <button className="ds-btn ds-btn-cta-green" onClick={onBegin}>
            <RotateCcw className="size-4" />
            {t("Praticar de novo")}
          </button>
        )}
        {!mastered && (
          <button className="ds-btn ds-btn-soft" onClick={onLesson}>
            <BookOpen className="size-4" />
            {t("Rever a aula")}
          </button>
        )}
        <button className="ds-btn ds-btn-quiet" onClick={onBack}>
          {t("Voltar aos temas")}
        </button>
        {mastered && (
          <button className="ds-btn ds-btn-quiet" onClick={onInterview}>
            {t("Preparar entrevista")}
          </button>
        )}
      </div>
    </section>
  );
}

function Confetti() {
  return (
    <div className="tr-confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
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
      <label className="tr-mini-label" htmlFor="practice-answer">
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
        rows={3}
        disabled={disabled}
        placeholder={t("Escreva a frase corrigida ou use o microfone")}
      />
      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="tr-answer-actions">
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
  last,
  onNext,
  onPlay,
}: {
  result: Grade;
  exercise: RoundExercise;
  error: string | null;
  speechError: boolean;
  last: boolean;
  onNext: () => void;
  onPlay: (phrase: string) => void;
}) {
  const rule = exercise.ruleId ? practiceRuleById[exercise.ruleId] : undefined;
  const nextRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
    nextRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div className={`tr-feedback is-${result.verdict}`}>
      <div className="tr-feedback-head">
        <Verdict verdict={result.verdict} />
        <p className="ds-body">{result.feedback}</p>
      </div>
      {(result.why || exercise.why) && <p className="tr-feedback-why">{t(result.why ?? exercise.why ?? "")}</p>}
      {error && (
        <p className="tr-form-error mt-3" role="status">
          {error}
        </p>
      )}
      <div className="tr-corrected" lang="en">
        <span>{result.corrected}</span>
        <SpeakButton phrase={result.corrected} onPlay={onPlay} />
      </div>
      {rule && result.verdict !== "correct" && (
        <aside className="tr-rule-mini">
          <strong>{t(rule.label)}</strong>
          <p>{t(rule.when)}</p>
          {rule.tip && <small>{t(rule.tip)}</small>}
        </aside>
      )}
      {speechError && <p className="tr-hint mt-2">{t("O áudio não está disponível agora. Você pode continuar sem ele.")}</p>}
      <button ref={nextRef} className="ds-btn ds-btn-cta-green tr-next" onClick={onNext}>
        {last ? t("Ver resultado") : t("Próximo")}
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
function VerdictIcon({ verdict }: { verdict: Grade["verdict"] }) {
  if (verdict === "correct") return <CheckCircle2 className="tr-verdict-correct size-5 shrink-0" aria-label={t("Certo")} />;
  if (verdict === "almost") return <CircleDot className="tr-verdict-almost size-5 shrink-0" aria-label={t("Quase")} />;
  return <XCircle className="tr-verdict-incorrect size-5 shrink-0" aria-label={t("Ainda não")} />;
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

function choiceClass(option: string, exercise: RoundExercise, answer: string, reveal: boolean) {
  const correct = reveal && option === exercise.answer;
  const wrong = reveal && answer === option && option !== exercise.answer;
  const dim = reveal && !correct && !wrong;
  return `tr-choice ${correct ? "is-correct" : ""} ${wrong ? "is-wrong" : ""} ${dim ? "is-dim" : ""}`;
}
