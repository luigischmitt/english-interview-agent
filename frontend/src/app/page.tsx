"use client";

import AOS from "aos";
import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Clock3,
  Home,
  LineChart,
  Moon,
  PhoneOff,
  Play,
  Shuffle,
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { synthesizeInterviewerQuestion } from "@/lib/interview/speech";
import type { InterviewAnswers, InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";

import "aos/dist/aos.css";

Chart.register(
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

type View = "home" | "interview-setup" | "interview" | "progress" | "settings";

const navigationItems = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "interview-setup" as const, label: "Interview", icon: Video },
  { id: "progress" as const, label: "Progress", icon: LineChart },
  { id: "settings" as const, label: "Settings", icon: SlidersHorizontal },
];

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
          compact ? "w-0 opacity-0" : "w-32 opacity-100"
        }`}
      >
        Interview Agent
      </span>
    </div>
  );
}

function Navigation({
  view,
  expanded,
  onNavigate,
  onExpand,
}: {
  view: View;
  expanded: boolean;
  onNavigate: (view: View) => void;
  onExpand: (expanded: boolean) => void;
}) {
  return (
    <>
      <aside
        className={`sticky top-0 hidden min-h-dvh shrink-0 border-r bg-sidebar py-5 transition-[width,padding] duration-200 lg:flex lg:flex-col ${
          expanded ? "w-60 px-4" : "w-18 px-3"
        }`}
        onMouseEnter={() => onExpand(true)}
        onMouseLeave={() => onExpand(false)}
      >
        <div className="pb-8">
          <Brand compact={!expanded} />
        </div>
        <nav aria-label="Primary navigation">
          <ul className="space-y-1">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <li key={id} className="flex">
                <button
                  type="button"
                  aria-current={view === id ? "page" : undefined}
                  onClick={() => onNavigate(id)}
                  title={expanded ? undefined : label}
                  className={`flex h-10 w-full items-center rounded-lg text-sm font-medium transition-colors ${
                    view === id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                  } ${expanded ? "gap-3 px-3" : "justify-center px-0"}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span
                    className={`overflow-hidden whitespace-nowrap transition-[width,opacity] duration-200 ${
                      expanded ? "w-28 opacity-100" : "w-0 opacity-0"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <p
          className={`mt-auto overflow-hidden text-xs leading-5 text-muted-foreground transition-[height,opacity] duration-200 ${
            expanded ? "h-10 opacity-100" : "h-0 opacity-0"
          }`}
        >
          Clear English. Stronger interviews.
        </p>
      </aside>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
      >
        <ul className="menu menu-horizontal grid w-full grid-cols-4 gap-1 p-0">
          {navigationItems.map(({ id, label, icon: Icon }) => (
            <li key={id} className="min-w-0">
              <button
                type="button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className={`flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium ${
                  view === id
                    ? "bg-accent text-accent-foreground"
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
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/92 px-4 backdrop-blur sm:px-8">
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

function ConfidenceChart({ darkMode }: { darkMode: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const styles = getComputedStyle(document.documentElement);
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: ["Sep 3", "Sep 7", "Sep 10", "Sep 14", "Today"],
        datasets: [
          {
            data: [48, 53, 58, 63, 72],
            borderColor: styles.getPropertyValue("--chart-1").trim(),
            backgroundColor: "transparent",
            borderWidth: 3,
            tension: 0.38,
            pointRadius: 4,
            pointHoverRadius: 5,
            pointBackgroundColor: styles.getPropertyValue("--card").trim(),
            pointBorderColor: styles.getPropertyValue("--chart-1").trim(),
            pointBorderWidth: 2.5,
          },
        ],
      },
      options: {
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? false
          : { duration: 1100, easing: "easeOutQuart" },
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            backgroundColor: styles.getPropertyValue("--card").trim(),
            bodyColor: styles.getPropertyValue("--foreground").trim(),
            borderColor: styles.getPropertyValue("--border").trim(),
            borderWidth: 1,
            callbacks: { label: (context) => `Confidence: ${context.parsed.y}` },
          },
        },
        scales: {
          x: { display: false },
          y: {
            min: 40,
            max: 80,
            display: false,
            grid: { color: styles.getPropertyValue("--border").trim() },
          },
        },
        interaction: { intersect: false, mode: "index" },
      },
    });

    return () => chart.destroy();
  }, [darkMode]);

  return (
    <div
      aria-label="Communication confidence improved from 48 to 72 across five sessions"
      className="relative h-36 w-full"
      role="img"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

function FocusRow({
  label,
  status,
  value,
}: {
  label: string;
  status: string;
  value: number;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
      <Progress value={value} aria-label={`${label}: ${value}%`} />
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

  const chooseAnotherPrompt = () => {
    selectPrompt((promptIndex + 1) % warmUpPrompts.length);
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
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <PageIntro
        title="Find your opening."
        description="Take one focused minute before you step into the interview."
      />

      <section className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,0.55fr)] lg:gap-8" data-aos="fade-up" data-aos-duration="450">
        <Card className="min-w-0 overflow-hidden border-0 bg-primary text-primary-foreground shadow-[0_20px_45px_-30px_color-mix(in_srgb,var(--primary)_72%,transparent)]">
          <div className="card-body gap-8 p-6 sm:p-8 lg:p-10">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
                  Your next answer starts here.
                </h2>
                <p className="mt-2 max-w-[48ch] text-sm leading-6 text-primary-foreground/75">
                  Choose a direction, find the story, then carry that clarity into the room.
                </p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-foreground/12 text-primary-foreground">
                <Target className="size-5" aria-hidden="true" />
              </span>
            </div>

            <div ref={promptRef} aria-live="polite" className="max-w-[60ch]">
              <p className="text-base font-medium leading-7 sm:text-lg">{prompt.question}</p>
              <p className="mt-4 border-t border-primary-foreground/30 pt-4 text-sm leading-6 text-primary-foreground/75">
                {prompt.cue}
              </p>
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Choose a warm-up prompt">
              {warmUpPrompts.map((item, index) => (
                <button
                  key={item.topic}
                  type="button"
                  aria-pressed={promptIndex === index}
                  onClick={() => selectPrompt(index)}
                  className={`btn btn-sm rounded-selector border-primary-foreground/20 px-3 text-primary-foreground hover:border-primary-foreground/55 hover:bg-primary-foreground/14 ${
                    promptIndex === index ? "bg-primary-foreground text-primary!" : "bg-transparent"
                  }`}
                >
                  {item.topic}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-primary-foreground/20 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button className="w-full gap-2 bg-primary-foreground text-primary hover:bg-primary-foreground/90 sm:w-auto" onClick={onStart}>
                <Play className="size-4 fill-current" /> Start interview
              </Button>
              <button type="button" className="btn btn-ghost btn-sm gap-2 text-primary-foreground hover:bg-primary-foreground/12" onClick={chooseAnotherPrompt}>
                <Shuffle className="size-4" aria-hidden="true" /> Another question
              </button>
            </div>
          </div>
        </Card>

        <aside className="flex flex-col border-y border-border py-6 lg:py-8">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">A focused room</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Format</dt>
              <dd className="font-medium">Technical interview</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-medium tabular-nums">25 minutes</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Language</dt>
              <dd className="font-medium">English</dd>
            </div>
          </dl>
          <p className="mt-auto pt-8 text-sm leading-6 text-muted-foreground">
            You do not need a perfect answer. You need one that is clear, specific, and yours.
          </p>
        </aside>
      </section>

      <section className="mt-12 flex flex-col gap-5 border-t pt-6 sm:mt-16 sm:flex-row sm:items-end sm:justify-between" data-aos="fade-up" data-aos-duration="450">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Keep the momentum.</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Your detailed practice history lives in one dedicated place.</p>
        </div>
        <button type="button" className="btn btn-ghost w-fit gap-2 px-0 hover:bg-transparent hover:text-primary" onClick={onProgress}>
          View progress <ArrowUpRight className="size-4" aria-hidden="true" />
        </button>
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

function InterviewSetupView({
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
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong className="text-lg font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </strong>
    </div>
  );
}

function ProgressView({ darkMode }: { darkMode: boolean }) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <PageIntro
        title="Your progress"
        description="See which communication skills are becoming more reliable under interview pressure."
      />
      <section className="mt-12 grid gap-10 lg:grid-cols-10 lg:gap-14" data-aos="fade-up" data-aos-duration="500">
        <div className="lg:col-span-7">
          <SectionHeading title="Confidence trend" description="Last five interviews" />
          <div className="mt-7">
            <ConfidenceChart darkMode={darkMode} />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Sep 3</span>
              <span>Today</span>
            </div>
          </div>
        </div>
        <div className="lg:col-span-3">
          <SectionHeading title="This month" />
          <div className="mt-6 space-y-5 border-y py-5">
            <Metric label="Interviews completed" value="12" />
            <Separator />
            <Metric label="Time practiced" value="4h 28m" />
            <Separator />
            <Metric label="Average readiness" value="68" />
          </div>
        </div>
      </section>
      <section className="mt-12 max-w-3xl sm:mt-16" data-aos="fade-up" data-aos-duration="450">
        <SectionHeading
          title="Skill development"
          description="Prioritized by impact on clarity and professional credibility"
        />
        <div className="mt-8 space-y-7">
          <FocusRow label="Answer structure" status="58%" value={58} />
          <FocusRow label="Verb tense" status="70%" value={70} />
          <FocusRow label="Pacing" status="76%" value={76} />
        </div>
      </section>
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
    <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
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

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

function FixedInterviewView({
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
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const advanceTimerRef = useRef<number | null>(null);
  const question: InterviewQuestion = questions[currentIndex];

  useEffect(() => {
    if (phase === "ending") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    let cancelled = false;

    const playback = synthesizeInterviewerQuestion(question.prompt, {
      endpoint: `${backendBaseUrl}/api/v1/speech`,
    });
    void playback.promise.then((result) => {
      if (cancelled || result.status === "cancelled") return;
      if (result.status === "unavailable") setSpeechMessage(result.message);
      setPhase("answering");
    });

    return () => {
      cancelled = true;
      playback.cancel();
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    };
  }, [currentIndex, question.prompt]);

  const submitAnswer = () => {
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      setAnswerError("Write a short answer before continuing.");
      return;
    }

    setAnswers((current) => ({ ...current, [question.id]: trimmedAnswer }));
    setAnswer("");
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

  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const isSpeaking = phase === "speaking";
  const isAdvancing = phase === "advancing";
  const progress = phase === "ending" ? 100 : ((currentIndex + (isAdvancing ? 1 : 0)) / questions.length) * 100;

  if (phase === "ending") {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col justify-center px-4 py-10 pb-36 sm:px-8 sm:pb-28 lg:pb-10">
        <section className="card card-border bg-card" aria-labelledby="interview-complete-title">
          <div className="card-body gap-6 p-6 sm:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Session complete</p>
            <div>
              <h1 id="interview-complete-title" className="text-3xl font-semibold tracking-[-0.03em]">You made it through the room.</h1>
              <p className="mt-3 max-w-[58ch] leading-7 text-muted-foreground">Your answers stayed local for this prototype. The feedback layer can be connected later without changing this interview flow.</p>
            </div>
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
    <main className="flex min-h-[calc(100dvh-4rem)] flex-col px-3 py-4 pb-36 sm:px-6 sm:py-5 sm:pb-28 lg:px-8 lg:pb-6">
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
            <fieldset className="fieldset w-full gap-2"><legend className="fieldset-legend text-sm font-medium">Your temporary answer</legend><textarea className={`textarea textarea-bordered min-h-32 w-full resize-y bg-base-100 text-base leading-6 ${answerError ? "textarea-error" : ""}`} value={answer} onChange={(event) => { setAnswer(event.target.value); if (answerError) setAnswerError(null); }} placeholder={isSpeaking ? "The answer box will be ready after the question." : "Type your answer in English..."} disabled={isSpeaking || isAdvancing} aria-invalid={Boolean(answerError)} aria-describedby={answerError ? "answer-error" : "answer-note"} />{answerError ? <p id="answer-error" className="label text-error" role="alert">{answerError}</p> : <p id="answer-note" className="label text-muted-foreground">This prototype keeps the answer only in the current session.</p>}</fieldset>
            <div className="card-actions justify-end border-t pt-4"><button type="button" className="btn btn-primary gap-2" onClick={submitAnswer} disabled={isSpeaking || isAdvancing}>{isAdvancing ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{isAdvancing ? "Moving to next" : currentIndex === questions.length - 1 ? "Finish interview" : "Submit answer"}</button></div>
          </div></div>
          <aside className="card card-border bg-base-200"><div className="card-body gap-4 p-5 sm:p-6"><h2 className="card-title text-base">Session progress</h2><progress className="progress progress-primary w-full" value={progress} max="100" aria-label={`Question ${currentIndex + 1} of ${questions.length}`} /><p className="text-sm font-medium">{currentIndex + 1} of {questions.length} questions</p><dl className="mt-2 space-y-3 border-t pt-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Planned time</dt><dd className="font-medium">{config.duration} min</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Elapsed</dt><dd className="font-medium tabular-nums">{elapsed}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Audio</dt><dd className="font-medium">Kokoro route</dd></div></dl><p className="mt-auto border-t pt-4 text-xs leading-5 text-muted-foreground">Audio issues do not block the practice. You can answer and continue while the provider is repaired.</p></div></aside>
        </div>
      </section>
      <div className="mx-auto flex w-full max-w-6xl justify-center pt-5"><div className="flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:w-auto sm:max-w-none sm:gap-2 sm:p-2"><p className="px-2 text-xs text-muted-foreground">Answers stay temporary in this test.</p><Button variant="destructive" className="h-11 gap-2 px-4 sm:h-9" onClick={onLeave}><PhoneOff className="size-4" /> End interview</Button></div></div>
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
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

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
    setSidebarExpanded(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <div className="flex min-h-dvh">
        <Navigation
          view={view}
          expanded={sidebarExpanded}
          onNavigate={navigate}
          onExpand={setSidebarExpanded}
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
            <InterviewSetupView
              onBack={() => navigate("home")}
              onStart={(config) => {
                setInterviewConfig(config);
                navigate("interview");
              }}
            />
          )}
          {view === "interview" && (
            <FixedInterviewView config={interviewConfig} onLeave={() => navigate("home")} />
          )}
          {view === "progress" && <ProgressView darkMode={darkMode} />}
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
