"use client";

import AOS from "aos";
import gsap from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Clock3,
  Home,
  LineChart,
  Moon,
  PhoneOff,
  Play,
  SlidersHorizontal,
  Sun,
  Target,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MicrophoneCapture } from "@/components/interview/microphone-capture";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import {
  appendInterviewTurn,
  createInterviewSession,
  loadInterviewSession,
  listInterviewSessions,
  updateInterviewStatus,
  type InterviewTurnInput,
} from "@/lib/interview/persistence";
import { useSpeechPlayback } from "./hooks/use-speech-playback";
import { useInterviewSession } from "./hooks/use-interview-session";
import type {
  InterviewAnswers,
  InterviewConfig,
  InterviewPhase,
  InterviewQuestion,
  InterviewSession,
} from "@/lib/interview/types";

import "aos/dist/aos.css";

type View = "home" | "interview-setup" | "interview" | "progress" | "settings";

const navigationItems = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "interview-setup" as const, label: "Interview", icon: Video },
  { id: "progress" as const, label: "Progress", icon: LineChart },
  { id: "settings" as const, label: "Settings", icon: SlidersHorizontal },
];

function isNavigationItemActive(view: View, item: View) {
  return view === item || (item === "interview-setup" && view === "interview");
}

const viewLabels: Record<View, string> = {
  home: "Practice overview",
  "interview-setup": "Prepare interview",
  interview: "Interview room",
  progress: "Your progress",
  settings: "Settings",
};

const warmUpPrompts = [
  {
    topic: "Technical decision",
    question: "Tell me about a technical decision you made with incomplete information.",
    cue: "Start with the constraint, then name the trade-off you chose.",
  },
  {
    topic: "Collaboration",
    question: "Describe a time you helped a team move through a difficult disagreement.",
    cue: "Give the context first. Then show what changed because of your contribution.",
  },
  {
    topic: "Impact",
    question: "What is a project where your work made a meaningful difference?",
    cue: "Pick one concrete result and connect it to the decision behind it.",
  },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? "justify-center" : "gap-3"}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Volume2 className="size-4" aria-hidden="true" />
      </span>
      <span
        className={`overflow-hidden whitespace-nowrap text-sm font-semibold tracking-[-0.01em] transition-[width,opacity] duration-200 ${
          compact ? "w-0 opacity-0" : "w-40 opacity-100"
        }`}
      >
        English Interview Agent
      </span>
    </div>
  );
}

function Navigation({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <>
      <aside
        className="sticky top-0 hidden min-h-dvh w-60 shrink-0 border-r bg-sidebar px-4 py-5 lg:flex lg:flex-col"
      >
        <div className="pb-8">
          <Brand />
        </div>
        <nav aria-label="Primary navigation">
          <ul className="space-y-1">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <li key={id} className="flex">
                <button
                  type="button"
                  aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
                  onClick={() => onNavigate(id)}
                  className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isNavigationItemActive(view, id)
                      ? "border-l-2 border-primary bg-sidebar-accent/70 text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <p
          className="mt-auto text-xs leading-5 text-muted-foreground"
        >
          Clear English. Stronger interviews.
        </p>
      </aside>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        <ul className="menu menu-horizontal grid w-full grid-cols-4 gap-1 p-0">
          {navigationItems.map(({ id, label, icon: Icon }) => (
            <li key={id} className="min-w-0">
              <button
                type="button"
                aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className={`flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isNavigationItemActive(view, id)
                    ? "bg-accent text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Topbar({
  view,
  darkMode,
  onToggleTheme,
}: {
  view: View;
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background px-4 sm:px-8">
      <div className="lg:hidden">
        <Brand />
      </div>
      <p className="hidden text-sm font-medium text-muted-foreground lg:block">
        {viewLabels[view]}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={darkMode ? "Use light theme" : "Use dark theme"}
          onClick={onToggleTheme}
        >
          {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <SignOutButton />
      </div>
    </header>
  );
}

function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const introRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-page-intro-word]",
        { yPercent: 115, opacity: 0, filter: "blur(5px)" },
        {
          yPercent: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.56,
          stagger: 0.055,
          ease: "power3.out",
        },
      );
      gsap.fromTo(
        "[data-page-intro-support]",
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.35, delay: 0.2, ease: "power2.out" },
      );
    }, introRef);

    return () => context.revert();
  }, [title]);

  return (
    <div ref={introRef} className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-balance text-[clamp(1.875rem,calc(1.25rem+3.125vw),2.5rem)] font-semibold leading-[1.12] tracking-[-0.03em]">
          {title.split(" ").map((word, index) => (
            <span key={`${word}-${index}`} className="mr-[0.24em] inline-block overflow-hidden align-bottom last:mr-0">
              <span className="inline-block" data-page-intro-word>
                {word}
              </span>
            </span>
          ))}
        </h1>
        <p data-page-intro-support className="mt-3 max-w-[60ch] text-[15px] leading-6 text-muted-foreground sm:text-base">
          {description}
        </p>
      </div>
      {action && <div data-page-intro-support>{action}</div>}
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
      {description && (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

function HomeView({
  onStart,
  onProgress,
}: {
  onStart: () => void;
  onProgress: () => void;
}) {
  const [promptIndex, setPromptIndex] = useState(0);
  const promptRef = useRef<HTMLDivElement>(null);
  const prompt = warmUpPrompts[promptIndex];

  const selectPrompt = (index: number) => {
    if (index === promptIndex) return;
    setPromptIndex(index);
  };

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.fromTo(
      promptRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" },
    );
  }, [promptIndex]);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-10 pb-36 sm:px-8 sm:py-14 sm:pb-28 lg:px-12 lg:py-20">
      <PageIntro
        title="Make your next answer clearer."
        description="A short English interview practice session for the role you are preparing for."
      />

      <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(17rem,0.7fr)] lg:gap-16" data-aos="fade-up" data-aos-duration="220">
        <div className="border-t border-border pt-6">
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">Start with one useful answer.</h2>
          <p className="mt-3 max-w-[52ch] text-base leading-7 text-muted-foreground">Choose your role and focus in the next step, then enter a room where questions are spoken and your written answer stays available.</p>
          <Button className="mt-7 min-h-12 gap-2 px-5" onClick={onStart}><Play className="size-4 fill-current" /> Start practice</Button>
        </div>
        <aside className="border-y border-border py-6" aria-labelledby="warm-up-title">
          <div className="flex items-start justify-between gap-4"><div><h2 id="warm-up-title" className="text-lg font-semibold">Optional warm-up</h2><p className="mt-1 text-sm text-muted-foreground">Find your opening before the room.</p></div><Target className="mt-1 size-5 text-primary" aria-hidden="true" /></div>
          <div ref={promptRef} aria-live="polite" className="mt-5"><p className="text-sm font-medium leading-6">{prompt.question}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{prompt.cue}</p></div>
          <button type="button" onClick={() => selectPrompt((promptIndex + 1) % warmUpPrompts.length)} className="btn btn-ghost mt-5 min-h-11 px-0 hover:bg-transparent hover:text-primary">Another prompt <ArrowUpRight className="size-4" aria-hidden="true" /></button>
          <dl className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
            <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">Mode</dt><dd className="text-right font-medium">English, spoken answers</dd></div>
            <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">Focus</dt><dd className="font-medium">Choose in setup</dd></div>
            <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">Room</dt><dd className="max-w-[18rem] text-right font-medium">Questions are spoken aloud; you answer at your pace.</dd></div>
          </dl>
        </aside>
      </section>

      <section className="mt-16 flex flex-col gap-5 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between" data-aos="fade-up" data-aos-duration="220">
        <div><h2 className="text-lg font-semibold tracking-[-0.02em]">Your practice history has its own place.</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Keep this page focused on what you can do next.</p></div>
        <button type="button" className="btn btn-ghost min-h-11 w-fit gap-2 px-0 hover:bg-transparent hover:text-primary" onClick={onProgress}>View progress <ArrowUpRight className="size-4" aria-hidden="true" /></button>
      </section>
    </main>
  );
}

const defaultInterviewConfig: InterviewConfig = {
  role: "",
  seniority: "mid-level",
  focus: "technical-depth",
  duration: "25",
  questionCount: "5",
};

function InterviewSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (config: InterviewConfig) => void;
}) {
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [showErrors, setShowErrors] = useState(false);

  const updateConfig = (field: keyof InterviewConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }));
    if (showErrors && field === "role" && value.trim()) {
      setShowErrors(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config.role.trim()) {
      setShowErrors(true);
      return;
    }
    onStart({ ...config, role: config.role.trim() });
  };

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <button
        type="button"
        className="btn btn-ghost -ml-3 mb-7 gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to overview
      </button>

      <PageIntro
        title="Set the room up for you."
        description="Choose a few details so the practice feels close to the interview you are preparing for."
      />

      <form onSubmit={handleSubmit} className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]" noValidate>
        <section className="card card-border bg-card" aria-labelledby="interview-details-title" data-aos="fade-up" data-aos-duration="450">
          <div className="card-body gap-7 p-5 sm:p-8">
            <div>
              <h2 id="interview-details-title" className="card-title text-xl tracking-[-0.02em]">
                Interview details
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                You can change these choices whenever you start a new session.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="fieldset gap-2 sm:col-span-2">
                <span className="fieldset-legend text-sm font-medium">Target role <span className="text-error" aria-hidden="true">*</span></span>
                <input
                  className={`input input-bordered h-11 w-full bg-base-100 ${showErrors ? "input-error" : ""}`}
                  value={config.role}
                  onChange={(event) => updateConfig("role", event.target.value)}
                  placeholder="e.g. Software Engineer"
                  aria-invalid={showErrors && !config.role.trim()}
                  aria-describedby={showErrors ? "role-error" : undefined}
                  required
                />
                {showErrors && !config.role.trim() && (
                  <span id="role-error" className="label text-error">Add the role you want to practice for.</span>
                )}
              </label>

              <label className="fieldset gap-2">
                <span className="fieldset-legend text-sm font-medium">Seniority</span>
                <select
                  className="select select-bordered h-11 w-full bg-base-100"
                  value={config.seniority}
                  onChange={(event) => updateConfig("seniority", event.target.value)}
                >
                  <option value="junior">Junior</option>
                  <option value="mid-level">Mid-level</option>
                  <option value="senior">Senior</option>
                  <option value="staff">Staff / Lead</option>
                </select>
              </label>

              <label className="fieldset gap-2">
                <span className="fieldset-legend text-sm font-medium">Practice focus</span>
                <select
                  className="select select-bordered h-11 w-full bg-base-100"
                  value={config.focus}
                  onChange={(event) => updateConfig("focus", event.target.value)}
                >
                  <option value="technical-depth">Technical depth</option>
                  <option value="communication">Communication and clarity</option>
                  <option value="behavioral">Behavioral answers</option>
                  <option value="mixed">Balanced practice</option>
                </select>
              </label>

              <fieldset className="fieldset gap-2">
                <legend className="fieldset-legend text-sm font-medium">Session length</legend>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Session length">
                  {["15", "25", "40"].map((minutes) => (
                    <label key={minutes} className={`btn btn-sm h-11 border ${config.duration === minutes ? "btn-primary" : "btn-ghost border-base-300"} focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2`}>
                      <input
                        type="radio"
                        name="duration"
                        value={minutes}
                        className="sr-only"
                        checked={config.duration === minutes}
                        onChange={(event) => updateConfig("duration", event.target.value)}
                      />
                      {minutes} min
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="fieldset gap-2">
                <legend className="fieldset-legend text-sm font-medium">Questions</legend>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Number of questions">
                  {["3", "5", "8"].map((count) => (
                    <label key={count} className={`btn btn-sm h-11 border ${config.questionCount === count ? "btn-primary" : "btn-ghost border-base-300"} focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2`}>
                      <input
                        type="radio"
                        name="questionCount"
                        value={count}
                        className="sr-only"
                        checked={config.questionCount === count}
                        onChange={(event) => updateConfig("questionCount", event.target.value)}
                      />
                      {count}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" className="btn btn-ghost order-2 sm:order-1" onClick={onBack}>Cancel</button>
              <button type="submit" className="btn btn-primary order-1 gap-2 sm:order-2">Start interview <ArrowUpRight className="size-4" aria-hidden="true" /></button>
            </div>
          </div>
        </section>

        <aside className="border-y border-border py-6 lg:py-8" aria-labelledby="session-preview-title" data-aos="fade-up" data-aos-delay="80" data-aos-duration="450">
          <h2 id="session-preview-title" className="text-lg font-semibold tracking-[-0.02em]">Your session</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="max-w-[14rem] truncate text-right font-medium">{config.role || "Not selected"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Level</dt>
              <dd className="font-medium capitalize">{config.seniority.replace("-", " ")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Focus</dt>
              <dd className="max-w-[14rem] text-right font-medium">{config.focus.replaceAll("-", " ")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Format</dt>
              <dd className="font-medium">{config.questionCount} questions · {config.duration} min</dd>
            </div>
          </dl>
          <p className="mt-8 text-sm leading-6 text-muted-foreground">
            The interviewer will keep the conversation in English and use your choices to frame the session.
          </p>
        </aside>
      </form>
    </main>
  );
}

function formatPracticeDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Unavailable";
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (totalMinutes < 1) return "<1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function sessionDuration(session: InterviewSession) {
  if (!session.startedAt || !session.completedAt) return null;
  const startedAt = Date.parse(session.startedAt);
  const completedAt = Date.parse(session.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return null;
  return completedAt - startedAt;
}

function formatSessionDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function ProgressView() {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [answerCounts, setAnswerCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadProgressData = useCallback(async () => {
    const result = await listInterviewSessions();
    if (!result.ok) return result;

    const completedSessions = result.value.filter((session) => session.status === "completed");
    const turnsBySession = await Promise.all(
      completedSessions.map(async (session) => {
        const sessionResult = await loadInterviewSession(session.id);
        if (!sessionResult.ok) return sessionResult;
        return { ok: true as const, value: { sessionId: session.id, session: sessionResult.value } };
      }),
    );
    const failedTurns = turnsBySession.find((sessionResult) => !sessionResult.ok);
    if (failedTurns && !failedTurns.ok) return failedTurns;

    const nextAnswerCounts: Record<string, number> = {};
    for (const sessionResult of turnsBySession) {
      if (!sessionResult.ok) continue;
      const turns = sessionResult.value.session?.turns ?? [];
      nextAnswerCounts[sessionResult.value.sessionId] = turns.filter(
        (turn) => turn.speaker === "candidate" && Boolean(turn.content?.trim()),
      ).length;
    }

    return { ok: true as const, value: { sessions: result.value, answerCounts: nextAnswerCounts } };
  }, []);

  const loadProgress = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await loadProgressData();
    if (!mountedRef.current) return;
    if (!result.ok) {
      setError(result.message);
      setSessions([]);
      setAnswerCounts({});
    } else {
      setSessions(result.value.sessions);
      setAnswerCounts(result.value.answerCounts);
    }
    setIsLoading(false);
  }, [loadProgressData]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    const loadInitialProgress = async () => {
      const result = await loadProgressData();
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        setSessions([]);
      } else {
        setSessions(result.value.sessions);
        setAnswerCounts(result.value.answerCounts);
      }
      setIsLoading(false);
    };

    void loadInitialProgress();
    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, [loadProgressData]);

  const completedSessions = sessions.filter((session) => session.status === "completed");
  const practicedMilliseconds = completedSessions.reduce(
    (total, session) => {
      const duration = sessionDuration(session);
      return duration === null ? total : total + duration;
    },
    0,
  );
  const hasKnownDuration = completedSessions.some((session) => sessionDuration(session) !== null);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <PageIntro
        title="Your progress"
        description="A record of the interview practice you have completed so far."
      />
      {isLoading ? (
        <section className="mt-12 space-y-8" aria-busy="true" aria-label="Loading progress">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="skeleton h-28 w-full rounded-box" />
            <div className="skeleton h-28 w-full rounded-box" />
          </div>
          <div className="skeleton h-56 w-full rounded-box" />
        </section>
      ) : error ? (
        <section className="mt-12" role="alert">
          <div className="alert alert-error items-start">
            <div>
              <h2 className="font-semibold">We could not load your progress.</h2>
              <p className="mt-1 text-sm">Check your connection and try again.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadProgress()}>
              Try again
            </Button>
          </div>
        </section>
      ) : completedSessions.length === 0 ? (
        <section className="mt-12" data-aos="fade-up" data-aos-duration="500">
          <Card className="border-dashed">
            <div className="card-body items-start gap-4 p-6 sm:p-8">
              <span className="badge badge-ghost">No completed sessions yet</span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">Your practice history starts here.</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  Complete an interview to see real practice time and session history. In-progress or abandoned sessions are not counted.
                </p>
              </div>
            </div>
          </Card>
        </section>
      ) : (
        <>
          <section className="mt-12 grid gap-4 sm:grid-cols-2" data-aos="fade-up" data-aos-duration="500">
            <Card>
              <div className="card-body gap-2 p-5 sm:p-6">
                <p className="text-sm text-muted-foreground">Completed sessions</p>
                <p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{completedSessions.length}</p>
              </div>
            </Card>
            <Card>
              <div className="card-body gap-2 p-5 sm:p-6">
                <p className="text-sm text-muted-foreground">Time practiced</p>
                <p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{hasKnownDuration ? formatPracticeDuration(practicedMilliseconds) : "Unavailable"}</p>
                <p className="text-xs text-muted-foreground">Based on available completed session timestamps</p>
              </div>
            </Card>
          </section>
          <section className="mt-12" data-aos="fade-up" data-aos-duration="450">
            <SectionHeading title="Completed sessions" description="Your most recent interview practice first." />
            <div className="mt-6 overflow-x-auto rounded-box border border-base-300">
              <table className="table">
                <caption className="sr-only">Completed interview sessions</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="text-right">Text answers</th>
                    <th scope="col" className="text-right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {completedSessions.map((session) => (
                    <tr key={session.id}>
                      <td>{formatSessionDate(session.completedAt ?? session.startedAt)}</td>
                      <td className="font-medium">{session.targetRole || "Interview practice"}</td>
                      <td className="text-right tabular-nums">{answerCounts[session.id] ?? 0}</td>
                      <td className="text-right tabular-nums">{formatPracticeDuration(sessionDuration(session))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function SettingsView({
  darkMode,
  onToggleTheme,
}: {
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <PageIntro
        title="Settings"
        description="Adjust the practice environment to make each session comfortable and focused."
      />
      <section className="mt-12" data-aos="fade-up" data-aos-duration="450">
        <SectionHeading title="Appearance" />
        <div className="mt-4 flex flex-col gap-5 border-y py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{darkMode ? "Dark theme" : "Light theme"}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Light is the default. Choose the theme that feels most comfortable.
            </p>
          </div>
          <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={onToggleTheme}>
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Use {darkMode ? "light" : "dark"} theme
          </Button>
        </div>
      </section>
      <section className="mt-12" data-aos="fade-up" data-aos-duration="450">
        <SectionHeading title="Interview experience" />
        <div className="mt-4 border-y">
          <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div>
              <p className="text-sm font-medium">Voice-first interview</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                The interview is designed around spoken answers and natural follow-ups.
              </p>
            </div>
            <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              Enabled
            </span>
          </div>
          <div className="border-t py-5">
            <p className="text-sm font-medium">Camera and interviewer avatar</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              More controls will be available when these features are connected.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function InterviewRoom({
  config,
  onLeave,
}: {
  config: InterviewConfig;
  onLeave: () => void;
}) {
  const questions = getFixedInterviewQuestions(config);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<InterviewPhase>("speaking");
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<"saving" | "saved" | "local">("saving");
  const [hasVoiceAnswer, setHasVoiceAnswer] = useState(false);
  const advanceTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreationRef = useRef<ReturnType<typeof createInterviewSession> | null>(null);
  const sessionStartRequestedRef = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const pendingTurnsRef = useRef<InterviewTurnInput[]>([]);
  const persistedQuestionIndexesRef = useRef<Set<number>>(new Set());
  const finalizedRef = useRef(false);
  const completionRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const flushingTurnsRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const turnWritesRef = useRef<Set<Promise<unknown>>>(new Set());
  const persistenceDegradedRef = useRef(false);
  const question: InterviewQuestion = questions[currentIndex];

  const reportPersistenceFailure = useCallback((message: string) => {
    persistenceDegradedRef.current = true;
    if (!mountedRef.current) return;
    setPersistenceState("local");
    setPersistenceMessage(message);
  }, []);

  const enqueueTurn = useCallback((turn: InterviewTurnInput) => {
    if (!sessionIdRef.current || flushingTurnsRef.current) {
      pendingTurnsRef.current.push(turn);
      return;
    }
    const write = appendInterviewTurn({ ...turn, interviewId: sessionIdRef.current });
    turnWritesRef.current.add(write);
    void write.finally(() => turnWritesRef.current.delete(write)).then((result) => {
      if (!result.ok) reportPersistenceFailure(result.message);
    });
  }, [reportPersistenceFailure]);

  const abandonSession = useCallback(() => {
    if (finalizedRef.current || completionRequestedRef.current) return;
    finalizedRef.current = true;
    const finishAsAbandoned = (id: string) => {
      void updateInterviewStatus(id, "abandoned").then((result) => {
        if (!result.ok) reportPersistenceFailure("Interview ended locally. Its status could not be saved.");
      });
    };
    if (sessionIdRef.current) finishAsAbandoned(sessionIdRef.current);
    else void sessionCreationRef.current?.then((result) => {
      if (result.ok && !completionRequestedRef.current) finishAsAbandoned(result.value.id);
    });
  }, [reportPersistenceFailure]);

  const waitForTurnPersistence = useCallback(async () => {
    if (flushPromiseRef.current) await flushPromiseRef.current;
    while (flushingTurnsRef.current || pendingTurnsRef.current.length > 0 || turnWritesRef.current.size > 0) {
      if (flushPromiseRef.current) await flushPromiseRef.current;
      await Promise.all([...turnWritesRef.current]);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // pagehide is best effort only: browsers may terminate async requests during unload.
    const handlePagehide = () => abandonSession();
    window.addEventListener("pagehide", handlePagehide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", handlePagehide);
      queueMicrotask(() => {
        if (!mountedRef.current) abandonSession();
      });
    };
  }, [abandonSession]);

  useEffect(() => {
    if (sessionStartRequestedRef.current) return;
    sessionStartRequestedRef.current = true;
    const creation = createInterviewSession(config);
    sessionCreationRef.current = creation;
    void creation.then((result) => {
      if (!result.ok) {
        reportPersistenceFailure("This interview is running locally. We could not create its account session.");
        return;
      }
      sessionIdRef.current = result.value.id;
      if (mountedRef.current) setSessionId(result.value.id);
      flushingTurnsRef.current = true;
      const flush = (async () => {
        let hasFailure = false;
        while (pendingTurnsRef.current.length > 0) {
          const pendingTurn = pendingTurnsRef.current.shift();
          if (!pendingTurn) continue;
          const write = appendInterviewTurn({ ...pendingTurn, interviewId: result.value.id });
          turnWritesRef.current.add(write);
          const pendingResult = await write.finally(() => turnWritesRef.current.delete(write));
          if (!pendingResult.ok) hasFailure = true;
        }
        flushingTurnsRef.current = false;
        if (hasFailure) reportPersistenceFailure("Some answers are local because saving to your account failed.");
      })();
      flushPromiseRef.current = flush;
      void flush;
    });
  }, [config, reportPersistenceFailure]);

  useEffect(() => {
    if (persistedQuestionIndexesRef.current.has(currentIndex)) return;
    persistedQuestionIndexesRef.current.add(currentIndex);
    enqueueTurn({
      interviewId: sessionId ?? "",
      sequenceNumber: currentIndex * 2 + 1,
      speaker: "interviewer",
      content: question.prompt,
    });
  }, [currentIndex, enqueueTurn, question.prompt, sessionId]);

  useEffect(() => {
    if (phase !== "ending") return;
    completionRequestedRef.current = true;
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    void (async () => {
      let completedSessionId = sessionIdRef.current;
      if (!completedSessionId && sessionCreationRef.current) {
        const creation = await sessionCreationRef.current;
        if (!creation.ok) {
          reportPersistenceFailure("Interview complete locally. We could not create its account session.");
          return;
        }
        completedSessionId = creation.value.id;
        sessionIdRef.current = completedSessionId;
        if (mountedRef.current) setSessionId(completedSessionId);
      }
      if (!completedSessionId) return;
      await waitForTurnPersistence();
      const result = await updateInterviewStatus(completedSessionId, "completed");
      if (!result.ok) reportPersistenceFailure("Interview complete locally. We could not update its status in your account.");
      else if (!persistenceDegradedRef.current && mountedRef.current) setPersistenceState("saved");
    })();
  }, [phase, reportPersistenceFailure, sessionId, waitForTurnPersistence]);

  const { elapsed } = useInterviewSession(phase);

  const { speechMessage, setSpeechMessage } = useSpeechPlayback(
    question.prompt,
    useCallback(() => setPhase("answering"), []),
  );

  useEffect(() => () => {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
  }, [currentIndex]);

  const submitAnswer = () => {
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer && !hasVoiceAnswer) {
      setAnswerError("Type a short answer or finish a voice answer before continuing.");
      return;
    }

    setAnswers((current) => ({ ...current, [question.id]: trimmedAnswer }));
    const candidateTurn: InterviewTurnInput = {
      interviewId: sessionIdRef.current ?? "",
      sequenceNumber: currentIndex * 2 + 2,
      speaker: "candidate",
      content: trimmedAnswer || null,
    };
    enqueueTurn(candidateTurn);
    setAnswer("");
    setHasVoiceAnswer(false);
    setAnswerError(null);
    setSpeechMessage(null);
    setPhase("advancing");
    advanceTimerRef.current = window.setTimeout(() => {
      if (currentIndex >= questions.length - 1) setPhase("ending");
      else {
        setPhase("speaking");
        setCurrentIndex((value) => value + 1);
      }
    }, 450);
  };

  const leaveInterview = () => {
    abandonSession();
    onLeave();
  };

  const isSpeaking = phase === "speaking";
  const isAdvancing = phase === "advancing";
  const progress = phase === "ending" ? 100 : ((currentIndex + (isAdvancing ? 1 : 0)) / questions.length) * 100;
  const persistenceLabel = persistenceState === "saved" ? "Saved to your private session." : persistenceState === "local" ? "Saved locally for this session; account sync needs attention." : "Saving to your private session…";

  if (phase === "ending") {
    return (
      <main id="main-content" className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col justify-center px-4 py-10 pb-36 sm:px-8 sm:pb-28 lg:pb-10">
        <section className="card card-border bg-card" aria-labelledby="interview-complete-title">
          <div className="card-body gap-6 p-6 sm:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Session complete</p>
            <div>
              <h1 id="interview-complete-title" className="text-3xl font-semibold tracking-[-0.03em]">You made it through the room.</h1>
              <p className="mt-3 max-w-[58ch] leading-7 text-muted-foreground">{persistenceLabel} Voice recordings remain local and are not uploaded or transcribed yet.</p>
            </div>
            {persistenceMessage && <div role="status" className="alert alert-warning alert-soft text-sm"><span>{persistenceMessage}</span></div>}
            <dl className="grid gap-3 border-y py-5 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Questions</dt><dd className="mt-1 font-semibold">{questions.length}</dd></div>
              <div><dt className="text-muted-foreground">Answers registered</dt><dd className="mt-1 font-semibold">{Object.keys(answers).length}</dd></div>
              <div><dt className="text-muted-foreground">Target role</dt><dd className="mt-1 truncate font-semibold">{config.role}</dd></div>
              <div><dt className="text-muted-foreground">Planned time</dt><dd className="mt-1 font-semibold">{config.duration} min</dd></div>
            </dl>
            <button type="button" className="btn btn-primary w-fit gap-2" onClick={onLeave}>Back to overview <ArrowUpRight className="size-4" aria-hidden="true" /></button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main id="main-content" className="flex min-h-[calc(100dvh-4rem)] flex-col px-3 py-4 pb-36 sm:px-6 sm:py-5 sm:pb-28 lg:px-8 lg:pb-6">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 pb-5 text-sm">
        <div><p className="font-medium">Interview in progress</p><p className="mt-0.5 text-xs text-muted-foreground">{config.role} · {config.seniority.replace("-", " ")} · {config.focus.replaceAll("-", " ")}</p></div>
        <p className="flex items-center gap-2 text-muted-foreground tabular-nums"><Clock3 className="size-4" aria-hidden="true" /> {elapsed}</p>
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-3 md:grid-cols-2">
        <VideoTile label="You" active={false} initials="LT" cameraOn dark />
        <VideoTile label="Interviewer" active={isSpeaking} initials="AI" cameraOn />
      </div>
      <section aria-labelledby="interview-question-title" className="mx-auto mt-5 w-full max-w-6xl border-t pt-5" data-aos="fade-up" data-aos-duration="450">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div className="card card-border bg-card"><div className="card-body gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Question {currentIndex + 1} of {questions.length}</p><h2 id="interview-question-title" className="mt-2 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{question.prompt}</h2><p className="mt-1 max-w-[58ch] text-sm leading-6 text-muted-foreground">{question.cue}</p></div>
              <span className={`badge badge-outline shrink-0 gap-2 py-3 text-xs font-medium ${isSpeaking ? "badge-info" : isAdvancing ? "badge-warning" : "badge-success"}`}><span className={`status ${isSpeaking ? "status-info animate-pulse" : isAdvancing ? "status-warning" : "status-success"}`} aria-hidden="true" />{isSpeaking ? "Interviewer speaking" : isAdvancing ? "Moving forward" : "Your turn"}</span>
            </div>
            {speechMessage && <div role="status" className="alert alert-warning alert-soft text-sm"><Volume2 className="size-4 shrink-0" aria-hidden="true" /><span>{speechMessage}</span></div>}
            {persistenceMessage && <div role="status" className="alert alert-info alert-soft text-sm"><span>{persistenceMessage}</span></div>}
            <fieldset className="fieldset w-full gap-2"><legend className="fieldset-legend text-sm font-medium">Your answer</legend><textarea className={`textarea textarea-bordered min-h-32 w-full resize-y bg-base-100 text-base leading-6 ${answerError ? "textarea-error" : ""}`} value={answer} onChange={(event) => { setAnswer(event.target.value); if (answerError) setAnswerError(null); }} placeholder={isSpeaking ? "The answer box will be ready after the question." : "Type your answer in English..."} disabled={isSpeaking || isAdvancing} aria-invalid={Boolean(answerError)} aria-describedby={answerError ? "answer-error" : "answer-note"} />{answerError ? <p id="answer-error" className="label text-error" role="alert">{answerError}</p> : <p id="answer-note" className="label text-muted-foreground">Written answers are saved to this private session. Voice recordings stay local until transcription is supported.</p>}</fieldset>
            <MicrophoneCapture key={question.id} disabled={isSpeaking || isAdvancing} onAvailabilityChange={setHasVoiceAnswer} />
            <div className="card-actions justify-end border-t pt-4"><button type="button" className="btn btn-primary gap-2" onClick={submitAnswer} disabled={isSpeaking || isAdvancing}>{isAdvancing ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{isAdvancing ? "Moving to next" : currentIndex === questions.length - 1 ? "Finish interview" : "Submit answer"}</button></div>
          </div></div>
          <aside className="card card-border bg-base-200"><div className="card-body gap-4 p-5 sm:p-6"><h2 className="card-title text-base">Session progress</h2><progress className="progress progress-primary w-full" value={progress} max="100" aria-label={`Question ${currentIndex + 1} of ${questions.length}`} /><p className="text-sm font-medium">{currentIndex + 1} of {questions.length} questions</p><dl className="mt-2 space-y-3 border-t pt-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Planned time</dt><dd className="font-medium">{config.duration} min</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Elapsed</dt><dd className="font-medium tabular-nums">{elapsed}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Audio</dt><dd className="font-medium">Kokoro route</dd></div></dl><p className="mt-auto border-t pt-4 text-xs leading-5 text-muted-foreground">Audio issues do not block the practice. You can answer and continue while the provider is repaired.</p></div></aside>
        </div>
      </section>
      <div className="mx-auto flex w-full max-w-6xl justify-center pt-5"><div className="flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:w-auto sm:max-w-none sm:gap-2 sm:p-2"><p className="px-2 text-xs text-muted-foreground">{persistenceLabel}</p><Button variant="destructive" className="h-11 gap-2 px-4 sm:h-9" onClick={leaveInterview}><PhoneOff className="size-4" /> End interview</Button></div></div>
    </main>
  );
}

function VideoTile({
  label,
  active,
  initials,
  cameraOn,
  dark = false,
}: {
  label: string;
  active: boolean;
  initials: string;
  cameraOn: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-56 items-center justify-center overflow-hidden rounded-xl border sm:min-h-72 ${
        dark ? "bg-[#2a2d2e] text-[#f4f5ef]" : "bg-secondary"
      } ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
    >
      {cameraOn ? (
        <Avatar className="size-24 border-4 border-background/60 text-xl">
          <AvatarFallback
            className={dark ? "bg-[#414a49] text-[#f4f5ef]" : "bg-primary text-primary-foreground"}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="text-center">
          <VideoOff className="mx-auto size-6 opacity-60" />
          <p className="mt-3 text-sm opacity-70">Camera is off</p>
        </div>
      )}
      {active && (
        <span className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Volume2 className="size-4" aria-hidden="true" />
          <span className="sr-only">Speaking</span>
        </span>
      )}
      <span className="absolute bottom-4 left-4 rounded-md bg-[#1f2021]/80 px-2.5 py-1.5 text-sm text-[#f4f5ef]">
        {label}
      </span>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [interviewConfig, setInterviewConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    AOS.init({
      duration: 500,
      easing: "ease-out-cubic",
      once: true,
      offset: 48,
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => AOS.refreshHard(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [view]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.dataset.theme = darkMode ? "interview-dark" : "interview-light";
  }, [darkMode]);

  const navigate = (nextView: View) => {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="flex min-h-dvh">
        <Navigation
          view={view}
          onNavigate={navigate}
        />
        <div className="min-w-0 flex-1">
          <Topbar
            view={view}
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode((value) => !value)}
          />
          {view === "home" && (
            <HomeView
              onStart={() => navigate("interview-setup")}
              onProgress={() => navigate("progress")}
            />
          )}
          {view === "interview-setup" && (
            <InterviewSetup
              onBack={() => navigate("home")}
              onStart={(config) => {
                setInterviewConfig(config);
                navigate("interview");
              }}
            />
          )}
          {view === "interview" && (
            <InterviewRoom config={interviewConfig} onLeave={() => navigate("home")} />
          )}
          {view === "progress" && <ProgressView />}
          {view === "settings" && (
            <SettingsView
              darkMode={darkMode}
              onToggleTheme={() => setDarkMode((value) => !value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
