"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
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
import { createPortal } from "react-dom";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { resolveInterviewerVoice } from "@/lib/interview/voices.mjs";
import { interviewerVoiceStorageKey } from "@/lib/interview/voice-picker.mjs";
import { staticPracticeAudioUrl } from "@/lib/practice/practice-audio.mjs";
import {
  practiceLessonByKey,
  practiceLessons,
  practiceRuleById,
} from "@/lib/practice/practice-lessons.mjs";
import { buildRound, gradeLocally, requeueMissed } from "@/lib/practice/practice-rounds.mjs";
import { lessonStats, topLessons } from "@/lib/practice/practice-insights.mjs";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";
import type { PracticeFixedExercise, PracticeLesson, PracticeLessonRule } from "@/lib/practice/practice-lessons.mjs";
import {
  loadPracticeAttempts,
  loadPracticeGroups,
  savePracticeAttempt,
  type PracticeAttempt,
  type PracticeGroup,
} from "@/lib/practice/practice-store";
import { sortPracticeGroups } from "@/lib/practice/practice-sync.mjs";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { getCurrentLocale, t } from "@/lib/locale";
import { VoiceAnswerButton } from "./voice-answer-button";
import { alternativesFor, applyEdits, insertionIndexFromRects, isOrderChanged, mistakeRegion, normalizeEdits, toBlocks } from "@/lib/practice/word-blocks.mjs";
import "./train.css";

let practiceAudioManifestPromise: Promise<typeof import("@/lib/practice/practice-audio-manifest.json")> | null = null;

type Grade = {
  verdict: "correct" | "almost" | "incorrect";
  feedback: string;
  corrected: string;
  why?: string | null;
  assisted?: boolean;
};
type RoundExercise = PracticeFixedExercise;
type PracticeMode = "quick" | "focused" | "mine";
const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const speechEndpoint = `${backendBaseUrl}/api/v1/speech`;
const speechCacheLimit = 30;
const missedStorageKey = "practice-missed";
function readMissedIds(): string[] {
  try { return Object.keys(JSON.parse(localStorage.getItem(missedStorageKey) ?? "{}") as Record<string, unknown>); } catch { return []; }
}
function updateMissed(id: string, correct: boolean) {
  try {
    const current = JSON.parse(localStorage.getItem(missedStorageKey) ?? "{}") as Record<string, { misses: number; lastMissedAt: string }>;
    if (correct) {
      if (current[id]) { current[id].misses -= 1; if (current[id].misses <= 0) delete current[id]; }
    } else current[id] = { misses: (current[id]?.misses ?? 0) + 1, lastMissedAt: new Date().toISOString() };
    const capped = Object.fromEntries(Object.entries(current).sort((a, b) => b[1].lastMissedAt.localeCompare(a[1].lastMissedAt)).slice(0, 300));
    localStorage.setItem(missedStorageKey, JSON.stringify(capped));
  } catch { /* Practice remains usable without local storage. */ }
}

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
  const cachedThemes = readDashboardCache("practice") as PracticeGroup[] | undefined;
  const [themes, setThemes] = useState<PracticeGroup[]>(() => cachedThemes ? sortPracticeGroups(cachedThemes) : []);
  const [themeLoading, setThemeLoading] = useState(!cachedThemes);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PracticeGroup | null>(null);
  // -1 is the lesson overview; 0 and up are the lesson parts.
  const [startRule, setStartRule] = useState(-1);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [exercises, setExercises] = useState<RoundExercise[]>([]);
  const [roundMode, setRoundMode] = useState<PracticeMode>("quick");
  const [roundSize, setRoundSize] = useState(10);
  const [focusedRule, setFocusedRule] = useState<string | undefined>();
  const [hasRequeued, setHasRequeued] = useState(false);
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
      practiceAudioManifestPromise ??= import("@/lib/practice/practice-audio-manifest.json");
      const practiceAudioManifest = await practiceAudioManifestPromise;
      if (requestId !== speechRequestRef.current) return;
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
    const cached = readDashboardCache("practice") as PracticeGroup[] | undefined;
    if (!cached) setThemeLoading(true);
    setLoadError(null);
    const loaded = await loadPracticeGroups();
    if (!loaded.ok) {
      if (!cached) setLoadError(loaded.message);
      setThemeLoading(false);
      return;
    }
    setThemes(sortPracticeGroups(loaded.value));
    setThemeLoading(false);
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
  const begin = (theme: PracticeGroup | null = selected, options: { mode?: PracticeMode; size?: number; ruleId?: string } = {}) => {
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
    const chosenMode = options.mode ?? "quick";
    const weights = chosenMode === "mine" ? Object.assign({}, ...themes.map(ruleWeights)) : ruleWeights(theme);
    const lessonWeights = chosenMode === "mine" ? Object.fromEntries(lessonStats(themes, practiceLessons).map((stat) => [stat.lessonKey, stat.errors])) : {};
    const round = buildRound({ mode: chosenMode, key: theme.theme_key, lessons: practiceLessons, size: options.size, ruleId: options.ruleId, recentIds, missedIds: readMissedIds(), weights, lessonWeights });
    setRoundMode(chosenMode);
    setRoundSize(options.size ?? 10);
    setFocusedRule(options.ruleId);
    setHasRequeued(false);
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

  const submit = async (chosen?: string, assisted = false) => {
    const submittedAnswer = chosen ?? answer;
    if (!selected || !exercises[step] || !submittedAnswer.trim() || grading) return;
    setGrading(true);
    if (chosen) setAnswer(chosen);
    setFormError(null);
    const exercise = exercises[step];
    const cleanAnswer = submittedAnswer.trim();
    const exerciseLessonKey = practiceLessons.find((lesson) => lesson.exercises.some((item) => item.id === exercise.id))?.key;
    const attemptTheme = themes.find((theme) => theme.theme_key === exerciseLessonKey);
    const tracked = Boolean(attemptTheme?.id);
    try {
      const local = gradeLocally(exercise, cleanAnswer);
      const feedback = local.verdict === "correct"
        ? t("Resposta correta.")
        : local.verdict === "almost"
          ? t("A correção principal está certa; confira o restante da frase.")
          : exercise.kind === "choose"
            ? t("A opção correta está destacada acima.")
            : t("Confira a frase corrigida e tente perceber a diferença.");
      const grade: Grade = {
        ...local,
        feedback,
        why: exercise.why,
        assisted,
      };
      updateMissed(exercise.id, grade.verdict === "correct" && !assisted);
      if (tracked && attemptTheme?.id) {
        const saved = await savePracticeAttempt({
          themeId: attemptTheme.id,
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
        if (attemptTheme?.id === selected.id) setAttempts((current) => [saved.value, ...current].slice(0, 5));
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
    if (roundMode === "focused" && !hasRequeued && step === exercises.length - 1) {
      setExercises((current) => requeueMissed(current, results));
      setHasRequeued(true);
    }
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

  const restartMissed = (missed: RoundExercise[]) => {
    setExercises(missed);
    setRoundMode("focused");
    setHasRequeued(false);
    setResults([]);
    setStep(0);
    setResult(null);
    setSessionStarted(true);
  };

  const reviewPart = (ruleId: string) => {
    const lesson = practiceLessons.find((item) => item.rules.some((rule) => rule.id === ruleId));
    if (!lesson) return;
    const group = themes.find((item) => item.theme_key === lesson.key) ?? exploreGroup(lesson);
    void selectTheme(group, lesson.rules.findIndex((rule) => rule.id === ruleId));
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
          {themeLoading ? (
            <div className="tr-grid" aria-busy="true">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="tr-skeleton skeleton h-56 w-full" />
              ))}
            </div>
          ) : (
            <>
      <Recommended
        themes={sorted}
        onOpen={(theme) => void selectTheme(theme)}
        onInterview={onInterview}
        onPractice={(theme) => begin(theme, { mode: "mine" })}
      />
              <Contents
                themes={sorted}
                onOpen={(theme, ruleIndex) => void selectTheme(theme, ruleIndex)}
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
          onBegin={() => begin(selected, { mode: roundMode, size: roundSize, ruleId: focusedRule })}
          mode={roundMode}
          hasRequeued={hasRequeued}
          onAnswer={setAnswer}
          onVoiceAnswer={(value) => {
            setMode("voice");
            setAnswer(value);
            setFormError(null);
          }}
          onVoiceError={setFormError}
          onSubmit={(value, assisted) => void submit(value, assisted)}
          onChoose={(option) => void submit(option)}
          onNext={next}
          onRestartMissed={restartMissed}
          onReviewPart={reviewPart}
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
        onFocused={(size, ruleId) => begin(selected, { mode: "focused", size, ruleId })}
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
        <p className="ds-body mt-2">{t("Pratique inglês para entrevistas, no seu ritmo.")}</p>
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
  onOpen,
  onInterview,
  onPractice,
}: {
  themes: PracticeGroup[];
  onOpen: (theme: PracticeGroup, ruleIndex?: number) => void;
  onInterview: () => void;
  onPractice: (theme: PracticeGroup) => void;
}) {
  const lessons = topLessons(themes, practiceLessons, 3);
  const hasErrors = themes.some((theme) => (theme.error_refs?.length ?? 0) > 0);
  if (!hasErrors) {
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
    <>
    <MineCard themes={themes} onPractice={onPractice} />
    <section className="tr-reco" aria-labelledby="train-reco">
      <h2 id="train-reco" className="tr-mini-label">
        {t("Onde você mais erra")}
      </h2>
      <ul className="tr-reco-list">
        {lessons.slice(0, 3).map((item, index) => {
          const lesson = practiceLessonByKey[item.lessonKey];
          const theme = themes.find((candidate) => candidate.theme_key === item.lessonKey) ?? exploreGroup(lesson);
          return (
            <li key={lesson.key} style={{ "--i": index } as CSSProperties}>
              <button type="button" className="tr-reco-tile" onClick={() => onOpen(theme)}>
                <span><strong>{t(lesson.title)}</strong><small>{t("{count} erros", { count: item.count })}</small></span>
                <ArrowRight className="tr-reco-arrow size-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
    </>
  );
}

function MineCard({ themes, onPractice }: { themes: PracticeGroup[]; onPractice: (theme: PracticeGroup, ruleId?: string) => void }) {
  const theme = themes.find((item) => (item.error_refs?.length ?? 0) > 0);
  if (!theme) return null;
  return (
    <button type="button" className="tr-mine-card" onClick={() => onPractice(theme)}>
      <span className="tr-mine-copy"><strong>{t("Treino com os seus erros")}</strong><small>{t("10 exercícios · cerca de 3 minutos")}</small></span>
      <ArrowRight className="size-4" aria-hidden="true" />
    </button>
  );
}

// A fixed table of contents: every lesson, in order, with the person's own mistakes attached when there are any.
function Contents({
  themes,
  onOpen,
}: {
  themes: PracticeGroup[];
  onOpen: (theme: PracticeGroup, ruleIndex?: number) => void;
}) {
  const [now] = useState(() => new Date());
  const stats = lessonStats(themes, practiceLessons, now);
  const ranked = [...stats.filter((item) => item.errors > 0).sort((a, b) => b.errors - a.errors || a.chapter - b.chapter), ...stats.filter((item) => !item.errors)];
  return (
    <section aria-labelledby="train-topics">
      <div className="tr-section-head">
        <h2 id="train-topics" className="ds-h2">
          {t("Conteúdo")}
        </h2>
        <p className="ds-small">{t("Estude na ordem ou vá direto ao que precisa. Toque numa parte para ir direto a ela.")}</p>
      </div>
      <div className="tr-grid">
        {ranked.map((stat, index) => {
          const lesson = practiceLessonByKey[stat.lessonKey];
          const group = themes.find((theme) => theme.theme_key === lesson.key);
          return (
          <LessonCard
            key={lesson.key}
            lesson={lesson}
            group={group}
            index={index}
            chapter={stat.chapter}
            onOpen={onOpen}
          />
          );
        })}
      </div>
    </section>
  );
}
function LessonCard({
  lesson,
  group,
  index,
  chapter,
  onOpen,
}: {
  lesson: PracticeLesson;
  group?: PracticeGroup;
  index: number;
  chapter: number;
  onOpen: (theme: PracticeGroup, ruleIndex?: number) => void;
}) {
  const theme = group ?? exploreGroup(lesson);
  const errors = group?.error_refs?.length ?? 0;
  return (
    <button type="button" className="tr-card tr-card-link" style={{ "--i": index } as CSSProperties} onClick={() => onOpen(theme, -1)}>
      <div className="min-w-0">
        <p className="tr-chapter">{t("Capítulo {number}", { number: chapter })}</p>
        <h3 className="tr-card-title">{t(lesson.title)}</h3>
        <p className="ds-small">{t(lesson.subtitle)}</p>
      </div>
      {errors > 0 && <span className="tr-error-pill">{t("{count} erros", { count: errors })}</span>}
    </button>
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
  onFocused,
  onPlay,
}: {
  theme: PracticeGroup;
  initialRule: number;
  attempts: PracticeAttempt[];
  attemptsLoading: boolean;
  speechError: boolean;
  onBack: () => void;
  onBegin: () => void;
  onFocused: (size: number, ruleId?: string) => void;
  onPlay: (phrase: string) => void;
}) {
  const lesson = practiceLessonByKey[theme.theme_key];
  const ruleCount = lesson?.rules.length ?? 0;
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [focusedOpen, setFocusedOpen] = useState(false);
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
      {onOverview && lesson && <LessonPracticeBand lesson={lesson} focusedOpen={focusedOpen} setFocusedOpen={setFocusedOpen} onBegin={onBegin} onFocused={onFocused} />}
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
                            <span className="sr-only">{t("Evite:")} </span><q lang="en">{ref.evidence}</q><span aria-hidden="true"> → </span>
                          </p>
                          <p className="tr-own-better">
                            <span className="sr-only">{t("Prefira:")} </span><q lang="en">{ref.rephrased}</q>
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
                            <span className="sr-only">{t("Evite:")} </span><span className="tr-wrong-example">{item.wrong}</span>
                            <span aria-hidden="true">→</span><span className="tr-trap-correct"><span className="sr-only">{t("Prefira:")} </span>{item.right}</span>
                          </p>
                          <div className="tr-trap-right">
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
                <div className="tr-part-practice">
                  <div><strong>{t("Praticar esta parte")}</strong><span>{t(activeRule.label)}</span><small>{t("{count} exercícios · só esta parte", { count: lesson.exercises.filter((exercise) => exercise.ruleId === activeRule.id).length })}</small></div>
                  <button type="button" className="ds-btn ds-btn-cta-green" onClick={() => onFocused(Math.max(4, lesson.exercises.filter((exercise) => exercise.ruleId === activeRule.id).length), activeRule.id)}>
                    {t("Praticar esta parte")}<ArrowRight className="size-4" />
                  </button>
                </div>
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
      {!onOverview && lesson && <LessonPracticeBand lesson={lesson} focusedOpen={focusedOpen} setFocusedOpen={setFocusedOpen} onBegin={onBegin} onFocused={onFocused} />}
    </section>
  );
}

function FocusedPicker({ onStart }: {
  onStart: (size: number, ruleId?: string) => void;
}) {
  const [size, setSize] = useState(10);
  return (
    <div className="tr-focused-picker">
      <span className="tr-mini-label">{t("Quantos exercícios?")}</span>
      <SlidingSegmented name="focused-round-size" ariaLabel={t("Tamanho do treino")} className="tr-size-options" itemClassName="tr-size-option" options={[10, 15, 20].map((option) => ({ value: String(option), label: String(option) }))} value={String(size)} onChange={(value) => setSize(Number(value))} />
      <button type="button" className="ds-btn ds-btn-cta-green tr-focused-start" onClick={() => onStart(size)}>
        {t("Começar · {count} exercícios", { count: size })}
      </button>
    </div>
  );
}

function LessonPracticeBand({ lesson, focusedOpen, setFocusedOpen, onBegin, onFocused }: { lesson: PracticeLesson; focusedOpen: boolean; setFocusedOpen: (update: (open: boolean) => boolean) => void; onBegin: () => void; onFocused: (size: number, ruleId?: string) => void }) {
  return <section className="tr-practice-band" aria-labelledby="lesson-practice-title">
    <div className="tr-practice-band-copy"><p className="tr-mini-label">{t("Treinar a aula inteira")}</p><h2 id="lesson-practice-title">{t(lesson.title)}</h2><p>{t("todas as {count} partes", { count: lesson.rules.length })}</p></div>
    <div className="tr-mode-actions">
      <button className="ds-btn ds-btn-cta-green" onClick={onBegin}>{t("Treino rápido · 5")}<ArrowRight className="size-4" /></button>
      <button className="ds-btn ds-btn-soft" aria-expanded={focusedOpen} onClick={() => setFocusedOpen((open) => !open)}>{t("Treino focado")}</button>
    </div>
    <div className="tr-focused-disclosure" data-open={focusedOpen} aria-hidden={!focusedOpen} inert={!focusedOpen}><FocusedPicker onStart={onFocused} /></div>
  </section>;
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
  mode,
  hasRequeued,
  onBack,
  onLesson,
  onBegin,
  onAnswer,
  onVoiceAnswer,
  onVoiceError,
  onSubmit,
  onChoose,
  onNext,
  onRestartMissed,
  onReviewPart,
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
  mode: PracticeMode;
  hasRequeued: boolean;
  onBack: () => void;
  onLesson: () => void;
  onBegin: () => void;
  onAnswer: (text: string) => void;
  onVoiceAnswer: (text: string) => void;
  onVoiceError: (message: string) => void;
  onSubmit: (value?: string, assisted?: boolean) => void;
  onChoose: (option: string) => void;
  onNext: () => void;
  onRestartMissed: (missed: RoundExercise[]) => void;
  onReviewPart: (ruleId: string) => void;
  onPlay: (phrase: string) => void;
}) {
  const exercise = exercises[step] as RoundExercise | undefined;
  const choose = exercise?.kind === "choose";
  const spot = exercise?.kind === "spot";
  const lessonTitle = t(practiceLessonByKey[theme.theme_key]?.title ?? theme.title);
  const ruleIds = [...new Set(exercises.map((item) => item.ruleId).filter((id): id is string => Boolean(id)))];
  const partRule = mode !== "mine" && ruleIds.length === 1 && exercises.every((item) => item.ruleId === ruleIds[0]) ? practiceRuleById[ruleIds[0]] : undefined;
  const sessionTitle = mode === "mine" ? t("Seus erros · todas as aulas") : partRule
    ? t("Parte: {label}", { label: t(partRule.label) })
    : t("Aula inteira: {lesson}", { lesson: lessonTitle });
  const practiceRef = useRef<HTMLElement | null>(null);
  const lastStep = useRef(step);
  const [hintOpen, setHintOpen] = useState(false);
  const [wordEdits, setWordEdits] = useState<Record<number, string>>({});
  const [wordOrder, setWordOrder] = useState<number[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [assisted, setAssisted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [hasEditedOnce, setHasEditedOnce] = useState(false);
  const alternatives = useMemo(() => {
    if (!spot || !exercise) return [];
    let seed = Array.from(`${exercise.id}:${step}`).reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    return alternativesFor({ ...exercise, ruleId: exercise.ruleId ?? "" }, practiceLessons.map((lesson) => ({ exercises: lesson.exercises.map((item) => ({ ...item, ruleId: item.ruleId ?? "", kind: item.kind ?? "", options: item.options ?? [] })) })), random);
  }, [exercise, step, spot]);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    setHintOpen(false);
    setHasEditedOnce(false);
    setWordEdits({}); setHelpOpen(false); setAssisted(false);
    setWordOrder([]);
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
          sessionTitle={sessionTitle}
        mode={mode}
        exercises={exercises}
        onRestartMissed={onRestartMissed}
        onReviewPart={onReviewPart}
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
  const owningLesson = practiceLessons.find((lesson) => lesson.exercises.some((item) => item.id === exercise.id || (exercise.ruleId && item.ruleId === exercise.ruleId)));
  const blocks = spot ? toBlocks(exercise.sentence) : [];
  const activeOrder = wordOrder.length ? wordOrder : blocks.map(({ id }) => id);
  const region = spot ? mistakeRegion(exercise) : { blockIds: [], correct: "", mistaken: "" };
  const editedSentence = spot ? applyEdits(blocks, wordEdits, activeOrder) : "";
  const normalizedWordEdits = normalizeEdits(blocks, wordEdits);
  const anythingChanged = Object.keys(normalizedWordEdits).length > 0 || isOrderChanged(activeOrder, blocks.map(({ id }) => id));
  const wholeSentenceOptions = Boolean(choose && /___\s*$/u.test(exercise.sentence) && exercise.options?.length && exercise.options.every((option) => /[.!?]\s*$/u.test(option)));
  const topicByLesson: Record<string, string> = {
    prepositions: "preposição", articles: "artigo", "verb-tenses": "tempo verbal", "verb-forms": "forma do verbo",
    "word-choice": "vocabulário", "sentence-structure": "estrutura da frase", "plural-agreement": "plural/concordância", other: "expressão",
  };
  return (
    <section className="tr-panel tr-practice" ref={practiceRef} aria-labelledby="exercise-title">
      <div className="tr-practice-top">
        <button className="ds-btn ds-btn-quiet tr-back" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("Voltar aos temas")}
        </button>
        <div className="tr-practice-heading">
          <p className="tr-practice-lesson">{sessionTitle}</p>
          <p className="tr-practice-theme">
            {t(mode === "quick" ? "Treino rápido" : mode === "mine" ? "Treino com os seus erros" : "Treino focado")} · {step + 1} {t("de")} {exercises.length}
          </p>
        </div>
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
          return <li key={`${item.id}-${index}`} className={`tr-step ${state}`} />;
        })}
      </ol>
      <div className="tr-exercise-card" key={exercise.id}>
        <div className="tr-exercise-meta">
          <span className="tr-exercise-kind">{kindLabel}</span>
          {hintRule && <span className="tr-part-chip">{t("Parte: {label}", { label: t(hintRule.label) })}</span>}
          {mode === "focused" && exercises.slice(0, step).some((item) => item.id === exercise.id) && <span className="tr-review-tag">{t("Revisão")}</span>}
        </div>
        {(exercise.context || exercise.meaning) && <div className="tr-exercise-prompt">{exercise.context && <p className="tr-exercise-context">{exercise.context}</p>}{exercise.meaning && <p className="tr-exercise-meaning"><q lang="pt-BR">{exercise.meaning}</q></p>}</div>}
        <div className="tr-instruction-row">
          <h2 id="exercise-title" className="tr-exercise-title">
            {choose ? t(wholeSentenceOptions ? "Qual destas frases você usaria?" : "Qual opção completa a frase?") : spot ? t("Esta frase tem 1 erro de {topic}.", { topic: t(topicByLesson[owningLesson?.key ?? exercise.ruleId?.split(".")[0] ?? "other"] ?? "expressão") }) : t("Reescreva sua frase corretamente")}
          </h2>
          {hintRule && !result && <button type="button" className="tr-hint-button" aria-expanded={hintOpen} onClick={() => setHintOpen((open) => !open)}>{t("Dica")}</button>}
        </div>
        {hintRule && hintOpen && !result && <div className="tr-hint-content"><p className="tr-mini-label">{t("Fórmula")}</p><p className="tr-pattern">{t(hintRule.pattern)}</p><p className="tr-mini-label">{t("Quando usar")}</p><p>{t(hintRule.when)}</p></div>}
        {spot && !result && <p className="tr-word-instruction">{t("Toque na palavra errada e corrija só ela")}</p>}
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
            : spot && !result ? (
              <span className="tr-word-sentence" aria-label={editedSentence}>
                <SpotSentenceEditor
                  sentence={blocks}
                  edits={wordEdits}
                  order={activeOrder}
                  onOrderChange={(order) => { setWordOrder(isOrderChanged(order, blocks.map(({ id }) => id)) ? order : []); setHasEditedOnce(Object.keys(normalizeEdits(blocks, wordEdits)).length > 0 || isOrderChanged(order, blocks.map(({ id }) => id))); }}
                  onEditsChange={(edits) => { const normalized = normalizeEdits(blocks, edits); setWordEdits(normalized); setHasEditedOnce(Object.keys(normalized).length > 0 || isOrderChanged(activeOrder, blocks.map(({ id }) => id))); }}
                  disabled={grading}
                  highlightIds={helpOpen ? region.blockIds : []}
                  onAnnounce={(edits, order = activeOrder) => setAnnouncement(applyEdits(blocks, edits, order))}
                />
              </span>
            ) : exercise.sentence}
        </blockquote>
        {spot && !result && <>
          <p className="sr-only" aria-live="polite">{announcement}</p>
          <div className="tr-word-actions">
            <button className={`ds-btn ${hasEditedOnce ? "ds-btn-cta-green tr-verify-ready" : "ds-btn-soft"}`} disabled={grading || !anythingChanged} onClick={() => onSubmit(editedSentence, assisted)}>{grading ? t("Avaliando…") : t("Verificar")}</button>
            {anythingChanged && <button type="button" className="tr-text-action" disabled={grading} onClick={() => { setWordEdits({}); setWordOrder([]); setHasEditedOnce(false); setAnnouncement(exercise.sentence); }}>{t("Desfazer tudo")}</button>}
            <button className="tr-text-action" disabled={grading} onClick={() => setHelpOpen((open) => !open)}>{t("Não sei — ver alternativas")}</button>
          </div>
          {helpOpen && <div className="tr-alternatives" role="group" aria-label={t("Alternativas para a parte destacada")}>
            {alternatives.map((option) => <button type="button" key={`${option.value}:${option.label}`} className="tr-alternative" onClick={() => { const ids = region.blockIds; const words = option.value.trim().split(/\s+/u); const replacement = ids.map((_, index) => [ids[index], index === ids.length - 1 ? words.slice(index).join(" ") : (words[index] ?? "")]); const edits = Object.fromEntries([...Object.entries(wordEdits), ...replacement]); setWordEdits(edits); setHasEditedOnce(true); setAssisted(true); setAnnouncement(applyEdits(blocks, edits, activeOrder)); }}>{option.label}</button>)}
          </div>}
        </>}
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
        ) : !spot && !result ? <AnswerForm value={answer} disabled={grading} error={error} onChange={onAnswer} onSubmit={onSubmit} onVoiceAnswer={onVoiceAnswer} onVoiceError={onVoiceError} /> : null}
        {choose && !result && <p className="tr-keys-hint">{t("Atalho: teclas 1 a {count}", { count: exercise.options?.length ?? 0 })}</p>}
      </div>
      {result && (
        <PracticeFeedback
          result={result}
          exercise={exercise}
          error={error}
          speechError={speechError}
          last={step === exercises.length - 1 && !(mode === "focused" && !hasRequeued && results.some((item) => item.verdict !== "correct"))}
          onNext={onNext}
          onPlay={onPlay}
        />
      )}
    </section>
  );
}

type SpotSentenceEditorProps = {
  sentence: ReturnType<typeof toBlocks>;
  edits: Record<number, string>;
  order: number[];
  onOrderChange: (order: number[]) => void;
  onEditsChange: (edits: Record<number, string>) => void;
  disabled: boolean;
  highlightIds: number[];
  onAnnounce: (edits: Record<number, string>, order?: number[]) => void;
};

function SpotSentenceEditor({ sentence, edits, order, onOrderChange, onEditsChange, disabled, highlightIds, onAnnounce }: SpotSentenceEditorProps) {
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; grabX: number; grabY: number; width: number; height: number; text: string; trailing: string; index: number; font: string; padding: string; border: string; radius: string } | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const startRef = useRef<{ id: number; x: number; y: number; node: HTMLButtonElement; pointerId: number; timer?: number; capture: boolean } | null>(null);
  const previousRects = useRef(new Map<number, DOMRect>());
  const captureRects = () => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>("[data-block-id]");
    previousRects.current = new Map(Array.from(nodes ?? [], (node) => [Number(node.dataset.blockId), node.getBoundingClientRect()]));
  };
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>("[data-block-id]");
    if (!nodes || prefersReducedMotion()) return;
    nodes.forEach((node) => {
      const old = previousRects.current.get(Number(node.dataset.blockId));
      if (!old) return;
      const rect = node.getBoundingClientRect();
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (!dx && !dy) return;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 150, easing: getComputedStyle(node).getPropertyValue("--ease-out").trim() || "ease-out" });
    });
    previousRects.current.clear();
  }, [edits, order, placeholderIndex]);
  useEffect(() => { if (editingBlock !== null) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editingBlock]);
  const commit = (blockId: number, value: string) => {
    const normalized = normalizeEdits(sentence, { ...edits, [blockId]: value });
    const next = { ...normalized };
    onEditsChange(next);
    onAnnounce(next);
    setEditingBlock(null);
  };
  const undo = (blockId: number) => {
    const next = { ...edits };
    delete next[blockId];
    onEditsChange(next);
    onAnnounce(next);
  };
  const move = (id: number, delta: number) => {
    const index = order.indexOf(id);
    const target = Math.max(0, Math.min(order.length - 1, index + delta));
    if (target === index) return;
    captureRects();
    const next = [...order]; next.splice(index, 1); next.splice(target, 0, id);
    onOrderChange(next); onAnnounce(edits, next);
  };
  const lift = (start: NonNullable<typeof startRef.current>) => {
    if (dragRef.current || startRef.current !== start) return;
    const block = sentence.find(({ id }) => id === start.id);
    if (!block) return;
    const rect = start.node.getBoundingClientRect();
    const chip = start.node;
    const style = getComputedStyle(chip);
    const next = { id: start.id, x: start.x, y: start.y, grabX: start.x - rect.left, grabY: start.y - rect.top, width: rect.width, height: rect.height, text: edits[start.id] ?? block.text, trailing: block.trailing, index: order.indexOf(start.id), font: style.font, padding: style.padding, border: style.border, radius: style.borderRadius };
    dragRef.current = next; setDrag(next); setPlaceholderIndex(next.index);
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 500);
    try { start.node.setPointerCapture(start.pointerId); start.capture = true; } catch { /* Pointer may have left the element. */ }
  };
  const finish = (cancel: boolean) => {
    const start = startRef.current;
    const current = dragRef.current;
    if (start?.timer) window.clearTimeout(start.timer);
    if (!start) return;
    let committed = false;
    if (current && !cancel && listRef.current) {
      const rect = listRef.current.getBoundingClientRect();
      if (current.x >= rect.left && current.x <= rect.right && current.y >= rect.top && current.y <= rect.bottom) {
        const next = order.filter((id) => id !== current.id);
        next.splice(Math.max(0, Math.min(next.length, placeholderIndex ?? current.index)), 0, current.id);
        captureRects(); onOrderChange(next); onAnnounce(edits, next); committed = true;
      }
    }
    if (current && !committed && !prefersReducedMotion()) {
      const source = listRef.current?.querySelector<HTMLElement>(`[data-block-id="${current.id}"]`)?.getBoundingClientRect();
      if (source) { setDrag({ ...current, x: source.left + source.width / 2, y: source.top + source.height / 2 }); window.setTimeout(() => { dragRef.current = null; setDrag(null); setPlaceholderIndex(null); }, 160); startRef.current = null; return; }
    }
    startRef.current = null; dragRef.current = null; setDrag(null); setPlaceholderIndex(null);
  };
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start || event.pointerId !== start.pointerId) return;
      if (!dragRef.current && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) {
        if (start.timer) window.clearTimeout(start.timer);
        lift(start);
      }
      const current = dragRef.current;
      if (!current) return;
      event.preventDefault();
      const updated = { ...current, x: event.clientX, y: event.clientY };
      dragRef.current = updated;
      if (!rafRef.current) rafRef.current = window.requestAnimationFrame(() => { rafRef.current = 0; setDrag(dragRef.current); });
      const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []);
      const rects = nodes.map((node) => node.getBoundingClientRect());
      const sourceIndex = nodes.findIndex((node) => Number(node.dataset.blockId) === current.id);
      const target = insertionIndexFromRects(rects, event.clientX, event.clientY, sourceIndex);
      if (target !== placeholderIndex) { captureRects(); setPlaceholderIndex(target); }
    };
    const onUp = (event: PointerEvent) => { if (startRef.current?.pointerId === event.pointerId) finish(false); };
    const onCancel = (event: PointerEvent) => { if (startRef.current?.pointerId === event.pointerId) finish(true); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && dragRef.current) { event.preventDefault(); finish(true); } };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onCancel); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("keydown", onKey); };
  });
  const rafRef = useRef(0);
  useEffect(() => () => { if (rafRef.current) window.cancelAnimationFrame(rafRef.current); }, []);
  const orderedBlocks = order.map((id) => sentence.find((entry) => entry.id === id)!).filter(Boolean);
  return (
    <>
    <span ref={listRef} className="tr-word-sentence">
      {orderedBlocks.map((block) => {
        const placeholder = Boolean(drag && block.id === drag.id);
        const visualOrder = drag && placeholderIndex !== null ? (() => { const ids = order.filter((id) => id !== drag.id); ids.splice(Math.max(0, Math.min(ids.length, placeholderIndex)), 0, drag.id); return ids.indexOf(block.id); })() : order.indexOf(block.id);
        const edited = Object.hasOwn(edits, block.id); const value = edited ? edits[block.id] : block.text;
        const active = editingBlock === block.id; const highlighted = highlightIds.includes(block.id);
        return (
          <span key={block.id} data-block-id={block.id} className={`tr-word-wrap${edited ? " is-edited" : ""}${!value ? " is-empty" : ""}${highlighted ? " is-helped" : ""}${placeholder ? " is-drag-placeholder" : ""}`} style={drag ? { order: visualOrder } : undefined}>
            {active ? <span className="tr-word-editor-measure-wrap"><input ref={inputRef} className="tr-word-editor" aria-label={t("Editar palavra: {word}", { word: block.text })} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(block.id, draft)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(block.id, draft); } if (event.key === "Escape") { event.preventDefault(); setEditingBlock(null); } }} /></span> : <button type="button" className={`tr-word-block${drag && placeholder ? " is-dragging-source" : ""}${!value ? " is-placeholder" : ""}`} style={drag && placeholder ? { width: drag.width } : undefined} onPointerDown={(event) => { if (disabled || active || event.button !== 0) return; const start: NonNullable<typeof startRef.current> = { id: block.id, x: event.clientX, y: event.clientY, node: event.currentTarget, pointerId: event.pointerId, capture: false }; startRef.current = start; if (event.pointerType === "touch") start.timer = window.setTimeout(() => lift(start), 150); }} onKeyDown={(event) => { if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); move(block.id, event.key === "ArrowLeft" ? -1 : 1); } }} aria-label={value ? t("Editar palavra: {word}", { word: value }) : t("Reabrir palavra: {word}", { word: block.text })} disabled={disabled} onClick={(event) => { if (suppressClick.current) { event.preventDefault(); suppressClick.current = false; return; } setDraft(value); setEditingBlock(block.id); }}>{value || <span aria-hidden="true">&nbsp;</span>}</button>}
            <span className="tr-word-move" aria-label={t("Mover palavra") }><button type="button" aria-label={t("Mover {word} para a esquerda", { word: value || block.text })} disabled={disabled || order.indexOf(block.id) === 0} onClick={() => move(block.id, -1)}>←</button><button type="button" aria-label={t("Mover {word} para a direita", { word: value || block.text })} disabled={disabled || order.indexOf(block.id) === order.length - 1} onClick={() => move(block.id, 1)}>→</button></span>
            <span className="tr-word-trailing">{block.trailing}</span>
            {edited && <button type="button" className="tr-word-undo" aria-label={t("Desfazer: {word}", { word: block.text })} disabled={disabled} onClick={() => undo(block.id)}><RotateCcw aria-hidden="true" /></button>}
          </span>
        );
      })}
    </span>
    {drag && typeof document !== "undefined" ? createPortal(<button className="tr-word-block tr-word-ghost" style={{ width: drag.width, height: drag.height, font: drag.font, padding: drag.padding, border: drag.border, borderRadius: drag.radius, transformOrigin: `${drag.grabX}px ${drag.grabY}px`, transform: `translate3d(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px, 0) scale(1.04)` }} aria-hidden="true" tabIndex={-1}>{drag.text}</button>, document.body) : null}
    </>
  );
}

function PracticeResults({
  results,
  total,
  sessionTitle,
  mode,
  exercises,
  onRestartMissed,
  onReviewPart,
  error,
  onBack,
  onBegin,
  onLesson,
}: {
  results: Grade[];
  total: number;
  sessionTitle: string;
  mode: PracticeMode;
  exercises: RoundExercise[];
  onRestartMissed: (missed: RoundExercise[]) => void;
  onReviewPart: (ruleId: string) => void;
  error: string | null;
  onBack: () => void;
  onBegin: () => void;
  onLesson: () => void;
}) {
  const correct = results.filter((item) => item.verdict === "correct").length;
  const great = correct / Math.max(1, total) >= 0.8;
  const title = great ? t("Mandou bem!") : t("Rodada concluída");
  const resultsRef = useRef<HTMLElement | null>(null);
  const missed = exercises.filter((_, index) => results[index]?.verdict !== "correct");
  const restartMissed = () => onRestartMissed(missed);
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
          <p className="tr-eyebrow">{t(mode === "quick" ? "Treino rápido" : mode === "mine" ? "Treino com os seus erros" : "Treino focado")} · {sessionTitle}</p>
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
      {results.some((item) => item.verdict !== "correct") && (
        <MissedParts exercises={exercises} results={results} onReviewPart={onReviewPart} />
      )}
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
        {results.some((item) => item.verdict !== "correct") && (
          <button className="ds-btn ds-btn-soft" onClick={restartMissed}>
            {t("Treinar só o que errei")}
          </button>
        )}
        {mode !== "mine" && (
          <button className="ds-btn ds-btn-soft" onClick={onLesson}>
            <BookOpen className="size-4" />
            {t("Rever a aula")}
          </button>
        )}
        <button className="ds-btn ds-btn-quiet" onClick={onBack}>
          {t("Voltar aos temas")}
        </button>
      </div>
    </section>
  );
}

function MissedParts({ exercises, results, onReviewPart }: {
  exercises: RoundExercise[];
  results: Grade[];
  onReviewPart: (ruleId: string) => void;
}) {
  const ruleIds = [...new Set(
    exercises
      .filter((_, index) => results[index]?.verdict !== "correct")
      .map((exercise) => exercise.ruleId)
      .filter((ruleId): ruleId is string => Boolean(ruleId)),
  )];
  return (
    <section className="tr-missed-parts" aria-label={t("Partes para revisar")}>
      <h3 className="tr-mini-label">{t("Partes em que errou")}</h3>
      <div className="tr-missed-actions">
        {ruleIds.map((ruleId) => (
          <button className="ds-btn ds-btn-soft" key={ruleId} onClick={() => onReviewPart(ruleId)}>
            {t(practiceRuleById[ruleId]?.label ?? ruleId)} · {t("Rever a parte")}
          </button>
        ))}
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
  onSubmit: (value?: string, assisted?: boolean) => void;
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
        {result.assisted && <span className="tr-helped-tag">{t("Com ajuda")}</span>}
      </div>
      {(result.why || exercise.why) && <p className="tr-feedback-why">{t(result.why ?? exercise.why ?? "")}</p>}
      {error && (
        <p className="tr-form-error mt-3" role="status">
          {error}
        </p>
      )}
      <div className="tr-corrected" lang="en">
        <span>{(() => {
          if (exercise.kind !== "spot") return result.corrected;
          const correctedRegion = mistakeRegion(exercise).correct;
          const start = correctedRegion ? result.corrected.toLocaleLowerCase().indexOf(correctedRegion.toLocaleLowerCase()) : -1;
          return start < 0 ? result.corrected : <>{result.corrected.slice(0, start)}<mark className="tr-corrected-region">{result.corrected.slice(start, start + correctedRegion.length)}</mark>{result.corrected.slice(start + correctedRegion.length)}</>;
        })()}</span>
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
