"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
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
  RotateCcw,
  Volume2,
  XCircle,
} from "lucide-react";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { resolveInterviewerVoice } from "@/lib/interview/voices.mjs";
import { interviewerVoiceStorageKey } from "@/lib/interview/voice-picker.mjs";
import practiceAudioManifest from "@/lib/practice/practice-audio-manifest.json";
import { staticPracticeAudioUrl } from "@/lib/practice/practice-audio.mjs";
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
const speechCacheLimit = 30;
const syncWarning = "Não conseguimos analisar seus erros mais recentes agora; tentaremos de novo na próxima vez.";

// How many of the person's mistakes belong to each lesson part: practice leans toward the parts they miss most.
// Scroll helpers: one place for how Treinar moves the page. Smooth for short hops, instant for long jumps, never animated under reduced motion.
function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
function scrollBehaviorFor(distance: number): ScrollBehavior {
  // "instant", not "auto": the page sets scroll-behavior: smooth globally, which "auto" would inherit.
  return prefersReducedMotion() || Math.abs(distance) > window.innerHeight * 1.2 ? "instant" : "smooth";
}
function scrollPageTo(top: number) {
  window.scrollTo({ top, behavior: scrollBehaviorFor(top - window.scrollY) });
}
// Brings the top of an element just under the sticky topbar (via its CSS scroll-margin-top), only when it is not already near the top.
function scrollToTopOf(element: HTMLElement | null) {
  if (!element) return;
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop);
  const offset = Number.isFinite(margin) ? margin : 80;
  const delta = element.getBoundingClientRect().top - offset;
  if (delta >= -4 && delta <= window.innerHeight * 0.3) return;
  window.scrollBy({ top: delta, behavior: scrollBehaviorFor(delta) });
}
// Gently reveals an element that just grew, only when part of it is off-screen.
function revealNearest(element: HTMLElement | null) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
  element.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "instant" : "smooth" });
}
// Centres the active tab in a horizontally scrolling tab strip without moving the page vertically.
function centerTabInStrip(tab: HTMLElement | null) {
  const strip = tab?.parentElement;
  if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return;
  const delta = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - tab.offsetWidth) / 2;
  strip.scrollBy({ left: delta, behavior: prefersReducedMotion() ? "instant" : "smooth" });
}

function ruleWeights(theme: PracticeGroup): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const ref of theme.error_refs ?? []) if (ref.ruleId) weights[ref.ruleId] = (weights[ref.ruleId] ?? 0) + 1;
  return weights;
}

// Lessons with no saved group (nothing from the interviews yet): the person can study and practice, but nothing is stored.
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

export function TrainView({ onInterview, initialLesson, initialPart }: { onInterview: () => void; initialLesson?: string; initialPart?: string }) {
  const [themes, setThemes] = useState<PracticeGroup[]>([]);
  const [themeLoading, setThemeLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<PracticeGroup | null>(null);
  // -1 is the lesson overview; 0 and up are the lesson parts.
  const [startRule, setStartRule] = useState(-1);
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
  // Per-session cache of synthesized dynamic phrases (text + voice -> object URL), so replaying one never calls the API twice.
  const speechCacheRef = useRef(new Map<string, string>());

  const releaseAudio = useCallback(() => {
    speechRequestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);
  useEffect(() => {
    const cache = speechCacheRef.current;
    return () => {
      releaseAudio();
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, [releaseAudio]);

  const playPhrase = async (phrase: string) => {
    releaseAudio();
    const requestId = speechRequestRef.current;
    setSpeechError(false);
    try {
      // Fixed lesson phrases are pre-generated files in one fixed lesson voice (not the candidate's chosen interviewer
      // voice) and never reach the speech API. Only dynamic text (the person's own sentences) is synthesized.
      let url = staticPracticeAudioUrl(phrase, practiceAudioManifest.files);
      if (!url) {
        let voice = resolveInterviewerVoice(null);
        try {
          voice = resolveInterviewerVoice(localStorage.getItem(interviewerVoiceStorageKey));
        } catch {
          /* Use the default voice. */
        }
        const cache = speechCacheRef.current;
        const cacheKey = `${voice}\n${phrase}`;
        url = cache.get(cacheKey) ?? null;
        if (url) {
          cache.delete(cacheKey);
          cache.set(cacheKey, url);
        } else {
          const blob = await fetchSpeechBlob(phrase, { endpoint: speechEndpoint, fetcher: authorizedFetch, voice });
          if (requestId !== speechRequestRef.current) return;
          url = URL.createObjectURL(blob);
          cache.set(cacheKey, url);
          while (cache.size > speechCacheLimit) {
            const [oldestKey, oldestUrl] = cache.entries().next().value as [string, string];
            cache.delete(oldestKey);
            URL.revokeObjectURL(oldestUrl);
          }
        }
      }
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

  // Where the list was scrolled before a lesson opened, so "back" lands on the card that was clicked.
  const listScrollRef = useRef<number | null>(null);
  const restoreListRef = useRef(false);
  const scrollToTop = () => scrollPageTo(0);
  const selectTheme = async (theme: PracticeGroup, ruleIndex = -1) => {
    if (!selected) listScrollRef.current = window.scrollY;
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
  // Deep link: open the requested lesson once, after the groups have loaded.
  const deepLinkOpened = useRef(false);
  useEffect(() => {
    if (deepLinkOpened.current || !initialLesson || themeLoading) return;
    deepLinkOpened.current = true;
    const lesson = practiceLessonByKey[initialLesson];
    if (!lesson) return;
    const ruleIndex = lesson.rules.findIndex((rule) => rule.id === initialPart);
    const theme = themes.find((item) => item.theme_key === lesson.key) ?? exploreGroup(lesson);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time open of the lesson requested by the link
    void selectTheme(theme, ruleIndex);
  });
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
      weights: ruleWeights(theme),
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
  useEffect(() => {
    if (selected || !restoreListRef.current) return;
    restoreListRef.current = false;
    scrollPageTo(listScrollRef.current ?? 0);
  }, [selected]);
  const backToList = () => {
    restoreListRef.current = true;
    setSelected(null);
    setExercises([]);
    setSessionStarted(false);
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
          <ListHeader />
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
          ) : (
            <>
              <Recommended themes={sorted} syncing={syncing} onOpen={(theme) => void selectTheme(theme)} onInterview={onInterview} />
              <Contents
                themes={sorted}
                onOpen={(theme, ruleIndex) => void selectTheme(theme, ruleIndex)}
                onPractice={(theme) => begin(theme)}
              />
            </>
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

function ListHeader() {
  return (
    <header className="tr-hero">
      <div className="min-w-0">
        <h1 className="font-display text-4xl tracking-tight">{t("Treinar")}</h1>
        <p className="ds-body mt-2">{t("Escolha um tema, estude a parte que quiser e pratique com exercícios curtos.")}</p>
      </div>
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

// Up to three of the person's own groups with the most mistakes: a shortcut into the table of contents below.
function Recommended({
  themes,
  syncing,
  onOpen,
  onInterview,
}: {
  themes: PracticeGroup[];
  syncing: boolean;
  onOpen: (theme: PracticeGroup) => void;
  onInterview: () => void;
}) {
  const top = themes
    .filter((theme) => practiceLessonByKey[theme.theme_key] && (theme.error_refs?.length ?? 0) > 0)
    .sort((a, b) => b.weighted_frequency - a.weighted_frequency)
    .slice(0, 3);
  if (!top.length) {
    if (syncing)
      return (
        <p className="tr-syncing" role="status" aria-busy="true">
          <Loader2 className="tr-spinner size-4" aria-hidden="true" />
          {t("Analisando os erros das suas entrevistas… isso leva alguns segundos na primeira vez.")}
        </p>
      );
    return (
      <p className="tr-reco-hint">
        {t("Faça uma entrevista para descobrirmos o que você precisa treinar")}
        <button type="button" className="tr-reco-link" onClick={onInterview}>
          {t("Preparar entrevista")}
        </button>
      </p>
    );
  }
  return (
    <section className="tr-reco" aria-labelledby="train-reco">
      <h2 id="train-reco" className="tr-mini-label">
        {t("Recomendado para você")}
      </h2>
      <ul className="tr-reco-list">
        {top.map((theme, index) => (
          <li key={theme.id} style={{ "--i": index } as CSSProperties}>
            <button type="button" className="tr-reco-tile" onClick={() => onOpen(theme)}>
              <span>
                <strong>{t(practiceLessonByKey[theme.theme_key].title)}</strong>
                <small>{t("{count} erros", { count: theme.error_refs?.length ?? 0 })}</small>
              </span>
              <ArrowRight className="tr-reco-arrow size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A fixed table of contents: every lesson, in order, with the person's own mistakes attached when there are any.
function Contents({
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
          {t("Conteúdo")}
        </h2>
        <p className="ds-small">{t("Estude na ordem ou vá direto ao que precisa. Toque numa parte para ir direto a ela.")}</p>
      </div>
      <div className="tr-grid">
        {practiceLessons.map((lesson, index) => (
          <LessonCard
            key={lesson.key}
            lesson={lesson}
            group={themes.find((theme) => theme.theme_key === lesson.key)}
            index={index}
            maxErrors={maxErrors}
            onOpen={onOpen}
            onPractice={onPractice}
          />
        ))}
      </div>
    </section>
  );
}
function LessonCard({
  lesson,
  group,
  index,
  maxErrors,
  onOpen,
  onPractice,
}: {
  lesson: PracticeLesson;
  group?: PracticeGroup;
  index: number;
  maxErrors: number;
  onOpen: (theme: PracticeGroup, ruleIndex?: number) => void;
  onPractice: (theme: PracticeGroup) => void;
}) {
  const theme = group ?? exploreGroup(lesson);
  const errors = group?.error_refs?.length ?? 0;
  const interviews = new Set(group?.error_refs?.map((ref) => ref.interview_id)).size;
  return (
    <article className="tr-card" style={{ "--i": index } as CSSProperties}>
      <div className="min-w-0">
        <p className="tr-chapter">{t("Capítulo {number}", { number: index + 1 })}</p>
        <h3 className="tr-card-title">{t(lesson.title)}</h3>
        <p className="ds-small">{t(lesson.subtitle)}</p>
      </div>
      {errors > 0 && (
        <div className="tr-meter">
          <p className="tr-personal">{t("{count} erros nas suas entrevistas", { count: errors })}</p>
          <div className="tr-meter-track" aria-hidden="true">
            <span style={{ width: `${Math.max(8, (errors / maxErrors) * 100)}%` }} />
          </div>
          <p>{t("{count} entrevistas", { count: interviews })}</p>
        </div>
      )}
      {lesson.rules.length > 0 && (
        <div className="tr-chips">
          <p className="tr-mini-label">{t("Partes da aula")}</p>
          <ul>
            {lesson.rules.map((rule, ruleIndex) => (
              <li key={rule.id}>
                <button type="button" className="tr-chip" onClick={() => onOpen(theme, ruleIndex)}>
                  <span className="tr-chip-num" aria-hidden="true">
                    {ruleIndex + 1}
                  </span>
                  {t(rule.label)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="tr-card-actions">
        <button className="ds-btn ds-btn-cta-green" onClick={() => onOpen(theme, -1)}>
          <BookOpen className="size-4" />
          {t("Estudar")}
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
  // -1 is the overview page; 0..ruleCount-1 are the parts.
  const [activeIndex, setActiveIndex] = useState(() => Math.max(-1, Math.min(initialRule, ruleCount - 1)));
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const tabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const ruleTopRef = useRef<HTMLDivElement | null>(null);
  const partChanged = useRef(false);
  const keepTabFocus = useRef(false);
  const onOverview = activeIndex < 0;
  const activeRule = onOverview ? undefined : lesson?.rules[activeIndex];
  const selectRule = (index: number, focus = false) => {
    if (!lesson) return;
    const span = ruleCount + 1;
    const nextIndex = ((index + 1 + span) % span) - 1;
    setDirection(nextIndex >= activeIndex ? "next" : "prev");
    setActiveIndex(nextIndex);
    partChanged.current = true;
    keepTabFocus.current = focus;
    if (focus) requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };
  // After a part change: show its top under the topbar, keep the tab strip in view and hand focus to the new heading (unless arrow keys are driving the tabs).
  useEffect(() => {
    centerTabInStrip(tabRefs.current[activeIndex]);
    if (!partChanged.current) return;
    partChanged.current = false;
    const layout = ruleTopRef.current;
    // Focus first: focusing during a smooth scroll cancels it.
    if (!keepTabFocus.current) layout?.querySelector<HTMLElement>("#active-lesson-rule h2")?.focus({ preventScroll: true });
    scrollToTopOf(layout);
  }, [activeIndex]);
  const handleRuleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectRule(-1, true);
    if (event.key === "End") return selectRule(ruleCount - 1, true);
    selectRule(index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1), true);
  };
  // The person's own mistakes, newest first, split between this lesson's parts and the leftovers.
  const ruleIds = new Set(lesson?.rules.map((rule) => rule.id));
  const refsNewestFirst = [...(theme.error_refs ?? [])].reverse().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const refsByRule = new Map<string, typeof refsNewestFirst>();
  const looseRefs: typeof refsNewestFirst = [];
  for (const ref of refsNewestFirst) {
    if (ref.ruleId && ruleIds.has(ref.ruleId)) refsByRule.set(ref.ruleId, [...(refsByRule.get(ref.ruleId) ?? []), ref]);
    else looseRefs.push(ref);
  }
  const grouped = [...new Set(looseRefs.map((ref) => ref.point ?? t("Outros pontos")))].map((point) => ({
    point,
    refs: looseRefs.filter((ref) => (ref.point ?? t("Outros pontos")) === point),
  }));
  const isLast = activeIndex === ruleCount - 1;
  const ownHere = activeRule ? (refsByRule.get(activeRule.id) ?? []) : [];
  const traps = activeRule
    ? activeRule.traps.filter((item, index, all) => all.findIndex((other) => other.wrong === item.wrong && other.right === item.right) === index)
    : [];
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
      </header>
      {lesson && (
        <div className="tr-lesson-layout" ref={ruleTopRef}>
          <nav className="tr-rule-nav" aria-label={t("Conteúdo da aula")}>
            <p className="tr-mini-label tr-rule-nav-label">{t("Conteúdo da aula")}</p>
            <div className="tr-rule-tabs" role="tablist" aria-orientation="vertical">
              <button
                ref={(node) => {
                  tabRefs.current[-1] = node;
                }}
                type="button"
                role="tab"
                id="lesson-tab-overview"
                aria-selected={onOverview}
                aria-controls="active-lesson-rule"
                tabIndex={onOverview ? 0 : -1}
                className={`tr-rule-tab ${onOverview ? "is-active" : ""}`}
                onClick={() => selectRule(-1)}
                onKeyDown={(event) => handleRuleKeyDown(event, -1)}
              >
                <span className="tr-rule-num" aria-hidden="true">
                  <BookOpen className="size-3.5" />
                </span>
                <span>{t("Visão geral")}</span>
              </button>
              {lesson.rules.map((rule, index) => {
                const isActive = index === activeIndex;
                const own = refsByRule.get(rule.id)?.length ?? 0;
                return (
                  <button
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`lesson-tab-${rule.id}`}
                    aria-selected={isActive}
                    aria-controls="active-lesson-rule"
                    tabIndex={isActive ? 0 : -1}
                    className={`tr-rule-tab ${isActive ? "is-active" : ""}`}
                    key={rule.id}
                    onClick={() => selectRule(index)}
                    onKeyDown={(event) => handleRuleKeyDown(event, index)}
                  >
                    <span className="tr-rule-num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="tr-rule-tab-label">{t(rule.label)}</span>
                    {own > 0 && (
                      <span className="tr-rule-count" aria-label={t("{count} erros seus nesta parte", { count: own })}>
                        <span aria-hidden="true">{own}×</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
          {onOverview ? (
            <article
              id="active-lesson-rule"
              key="overview"
              className={`tr-rule tr-overview tr-rule-${direction}`}
              role="tabpanel"
              aria-labelledby="lesson-tab-overview"
            >
              <div className="tr-rule-heading">
                <p className="tr-rule-progress">{t("Visão geral")}</p>
                <h2 tabIndex={-1}>{t("Antes de começar")}</h2>
                <p className="tr-rule-goal">{t(lesson.overview.what)}</p>
              </div>
              <section className="tr-rule-section" aria-labelledby="overview-why">
                <p id="overview-why" className="tr-mini-label">
                  {t("Por que o brasileiro tropeça aqui")}
                </p>
                <p className="tr-rule-explain">{t(lesson.overview.why)}</p>
              </section>
              <section className="tr-model" aria-labelledby="overview-model">
                <p id="overview-model" className="tr-mini-label">
                  {t("A ideia central")}
                </p>
                <p>{t(lesson.overview.model)}</p>
              </section>
              <section className="tr-rule-section" aria-labelledby="overview-map">
                <p id="overview-map" className="tr-mini-label">
                  {t("Mapa da aula")}
                </p>
                <ol className="tr-map">
                  {lesson.rules.map((rule, index) => (
                    <li key={rule.id}>
                      <button type="button" className="tr-map-item" onClick={() => selectRule(index)}>
                        <span className="tr-rule-num" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span className="tr-map-text">
                          <strong>{t(rule.label)}</strong>
                          <small>{t(lesson.overview.map[index] ?? rule.goal)}</small>
                        </span>
                        <ArrowRight className="tr-reco-arrow size-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
              <div className="tr-rule-controls">
                <button type="button" className="ds-btn ds-btn-quiet" disabled>
                  <ArrowLeft className="size-4" />
                  {t("Anterior")}
                </button>
                <button type="button" className="ds-btn ds-btn-soft" onClick={() => selectRule(0)}>
                  {t("Começar pela parte 1")}
                  <ArrowRight className="size-4" />
                </button>
              </div>
            </article>
          ) : (
            activeRule && (
              <article
                id="active-lesson-rule"
                key={activeRule.id}
                className={`tr-rule tr-rule-${direction}`}
                role="tabpanel"
                aria-labelledby={`lesson-tab-${activeRule.id}`}
              >
                <div className="tr-rule-heading">
                  <p className="tr-rule-progress">{t("Parte {current} de {total}", { current: activeIndex + 1, total: ruleCount })}</p>
                  <h2 tabIndex={-1}>{t(activeRule.label)}</h2>
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
                {ownHere.length > 0 && (
                  <section className="tr-own" aria-labelledby="rule-own-title">
                    <p id="rule-own-title" className="tr-mini-label">
                      {t("Na sua entrevista")}
                    </p>
                    <ul>
                      {ownHere.slice(0, 2).map((ref) => (
                        <li key={`${ref.interview_id}-${ref.sequence_number}-${ref.evidence}`}>
                          <p className="tr-own-said">
                            <span>{t("Você disse")}</span> <q lang="en">{ref.evidence}</q>
                          </p>
                          <p className="tr-own-better">
                            <span>{t("Soa melhor")}</span> <q lang="en">{ref.rephrased}</q>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {activeRule.why && (
                  <section className="tr-rule-section" aria-labelledby="rule-why-title">
                    <p id="rule-why-title" className="tr-mini-label">
                      {t("Por que é assim")}
                    </p>
                    <p className="tr-rule-explain">{t(activeRule.why)}</p>
                  </section>
                )}
                {!!activeRule.build?.length && (
                  <section className="tr-rule-section" aria-labelledby="rule-build-title">
                    <p id="rule-build-title" className="tr-mini-label">
                      {t("Como montar")}
                    </p>
                    <ol className="tr-build">
                      {activeRule.build.map((step) => (
                        <li key={step}>{t(step)}</li>
                      ))}
                    </ol>
                  </section>
                )}
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
                {traps.length > 0 && (
                  <section className="tr-rule-section" aria-labelledby="rule-traps-title">
                    <p id="rule-traps-title" className="tr-mini-label">
                      {t("Armadilhas comuns")}
                    </p>
                    <ul className="tr-traps">
                      {traps.map((item) => (
                        <li className="tr-trap" key={`${item.wrong}|${item.right}`}>
                          <p className="tr-trap-wrong" lang="en">
                            <XCircle className="size-4 shrink-0" aria-hidden="true" />
                            <span className="sr-only">{t("Evite:")} </span>
                            <s>{item.wrong}</s>
                          </p>
                          <div className="tr-trap-right">
                            <p lang="en">
                              <Check className="size-4 shrink-0" aria-hidden="true" />
                              <span className="sr-only">{t("Prefira:")} </span>
                              <span>{item.right}</span>
                            </p>
                            <SpeakButton phrase={item.right} onPlay={onPlay} />
                          </div>
                          <p className="tr-trap-note">{t(item.note)}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {activeRule.wrong && activeRule.right && <RuleCheck rule={activeRule} onPlay={onPlay} />}
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
                  <button type="button" className="ds-btn ds-btn-quiet" onClick={() => selectRule(activeIndex - 1)}>
                    <ArrowLeft className="size-4" />
                    {t("Anterior")}
                  </button>
                  {isLast ? (
                    <button type="button" className="ds-btn ds-btn-cta-green" onClick={onBegin}>
                      <Dumbbell className="size-4" />
                      {t("Praticar agora")}
                    </button>
                  ) : (
                    <button type="button" className="ds-btn ds-btn-soft" onClick={() => selectRule(activeIndex + 1)}>
                      {t("Próxima parte")}
                      <ArrowRight className="size-4" />
                    </button>
                  )}
                </div>
              </article>
            )
          )}
        </div>
      )}
      {(!!grouped.length || !!theme.id) && (
        <div className="tr-lesson-extras">
          {!!grouped.length && (
            <details className="tr-extra-card" onToggle={revealOnOpen}>
              <summary>
                <span>
                  <strong>{t("Onde você errou")}</strong>
                  <small>{t("{count} trechos das suas entrevistas", { count: looseRefs.length })}</small>
                </span>
                <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
              </summary>
              <div className="tr-extra-body">
                {grouped.slice(0, showAllErrors ? grouped.length : 3).map(({ point, refs }) => {
                  const ref = refs[0];
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
            <details className="tr-extra-card" onToggle={revealOnOpen}>
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
function revealOnOpen(event: SyntheticEvent<HTMLDetailsElement>) {
  const details = event.currentTarget;
  if (details.open) requestAnimationFrame(() => revealNearest(details));
}

function RuleCheck({ rule, onPlay }: { rule: PracticeLessonRule; onPlay: (phrase: string) => void }) {
  const [picked, setPicked] = useState<"right" | "wrong" | null>(null);
  const rightFirst = [...rule.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0;
  const options: Array<"right" | "wrong"> = rightFirst ? ["right", "wrong"] : ["wrong", "right"];
  const checkRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (picked) revealNearest(checkRef.current);
  }, [picked]);
  return (
    <section className="tr-check" ref={checkRef} aria-labelledby={`check-${rule.id}`}>
      <div className="tr-check-head">
        <p id={`check-${rule.id}`} className="tr-mini-label">
          {t("Teste rápido")}
        </p>
        <p className="tr-check-question">{t("Qual destas você usaria?")}</p>
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
              <strong>{picked === "right" ? t("Isso!") : t("Quase — a melhor é a outra.")}</strong> {t(rule.when)}
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
  onPlay: (phrase: string) => void;
}) {
  const exercise = exercises[step] as RoundExercise | undefined;
  const choose = exercise?.kind === "choose";
  const lessonTitle = t(practiceLessonByKey[theme.theme_key]?.title ?? theme.title);
  const practiceRef = useRef<HTMLElement | null>(null);
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    scrollToTopOf(practiceRef.current);
  }, [step]);
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
        lessonTitle={lessonTitle}
        error={error}
        onBack={onBack}
        onBegin={onBegin}
        onLesson={onLesson}
      />
    );
  }
  let streak = 0;
  for (let index = results.length - 1; index >= 0 && results[index].verdict === "correct"; index -= 1) streak += 1;
  const kindLabel = choose ? t("Complete a frase") : t("Encontre e corrija o erro");
  const hintRule = exercise.ruleId ? practiceRuleById[exercise.ruleId] : undefined;
  return (
    <section className="tr-panel tr-practice" ref={practiceRef} aria-labelledby="exercise-title">
      <div className="tr-practice-top">
        <button className="ds-btn ds-btn-quiet tr-back" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("Voltar aos temas")}
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
          <details className="tr-hint-toggle" onToggle={revealOnOpen}>
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
  lessonTitle,
  error,
  onBack,
  onBegin,
  onLesson,
}: {
  results: Grade[];
  total: number;
  lessonTitle: string;
  error: string | null;
  onBack: () => void;
  onBegin: () => void;
  onLesson: () => void;
}) {
  const correct = results.filter((item) => item.verdict === "correct").length;
  const great = correct / Math.max(1, total) >= 0.8;
  const title = great ? t("Mandou bem!") : t("Rodada concluída");
  const resultsRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scrollToTopOf(resultsRef.current);
  }, []);
  return (
    <section className="tr-panel tr-results" ref={resultsRef} aria-live="polite">
      {great && <Confetti />}
      <div className="tr-results-head">
        <ProgressRing value={correct / Math.max(1, total)} size={96}>
          <span className="tr-result-score">
            {correct}
            <small>/{total}</small>
          </span>
        </ProgressRing>
        <div className="min-w-0">
          <p className="tr-eyebrow">{lessonTitle}</p>
          <h2 className="font-display text-3xl sm:text-4xl">{title}</h2>
          <p className="ds-body mt-2">{t("Você acertou {correct} de {total}.", { correct, total })}</p>
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
        <button className="ds-btn ds-btn-cta-green" onClick={onBegin}>
          <RotateCcw className="size-4" />
          {t("Praticar de novo")}
        </button>
        <button className="ds-btn ds-btn-soft" onClick={onLesson}>
          <BookOpen className="size-4" />
          {t("Rever a aula")}
        </button>
        <button className="ds-btn ds-btn-quiet" onClick={onBack}>
          {t("Voltar aos temas")}
        </button>
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
    nextRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "instant" : "smooth" });
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
