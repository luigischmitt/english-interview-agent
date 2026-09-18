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
  Camera,
  Clock3,
  Container,
  Home,
  LineChart,
  Mic,
  MicOff,
  Moon,
  PhoneOff,
  Play,
  RefreshCw,
  Settings2,
  Shuffle,
  Square,
  SlidersHorizontal,
  Sun,
  Target,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

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

type View = "home" | "interview" | "progress" | "settings";

const navigationItems = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "interview" as const, label: "Interview", icon: Video },
  { id: "progress" as const, label: "Progress", icon: LineChart },
  { id: "settings" as const, label: "Settings", icon: SlidersHorizontal },
];

const viewLabels: Record<View, string> = {
  home: "Practice overview",
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
      <Button
        variant="ghost"
        size="icon"
        aria-label={darkMode ? "Use light theme" : "Use dark theme"}
        onClick={onToggleTheme}
      >
        {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
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

type SpeechStatus = "checking" | "ready" | "fake" | "unavailable";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

function InterviewView({ onLeave }: { onLeave: () => void }) {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [seconds, setSeconds] = useState(134);
  const [text, setText] = useState("Hello. Thank you for joining this interview today.");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("checking");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const checkSpeechStatus = async () => {
    setSpeechStatus("checking");

    try {
      const response = await fetch(`${backendBaseUrl}/api/v1/speech/health`);
      const data = (await response.json()) as { provider?: string; status?: string };

      if (response.ok && data.provider === "kokoro" && data.status === "ready") {
        setSpeechStatus("ready");
        return;
      }

      setSpeechStatus(data.provider === "fake" ? "fake" : "unavailable");
    } catch {
      setSpeechStatus("unavailable");
    }
  };

  useEffect(() => {
    const statusTimer = window.setTimeout(() => {
      void checkSpeechStatus();
    }, 0);

    return () => {
      window.clearTimeout(statusTimer);
      audioRef.current?.pause();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const stopAudio = () => {
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  };

  const generateSpeech = async () => {
    const phrase = text.trim();
    if (!phrase) {
      setSpeechError("Type an English sentence before generating audio.");
      return;
    }

    stopAudio();
    setIsGenerating(true);
    setSpeechError(null);

    try {
      const response = await fetch(`${backendBaseUrl}/api/v1/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: phrase }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? "The backend could not generate audio.");
      }

      const audioBlob = await response.blob();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.addEventListener("ended", () => setIsPlaying(false), { once: true });
      await audio.play();
      setIsPlaying(true);
      setSpeechStatus("ready");
    } catch (error) {
      setSpeechStatus("unavailable");
      setSpeechError(error instanceof Error ? error.message : "Could not reach the local speech service.");
    } finally {
      setIsGenerating(false);
    }
  };

  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] flex-col px-3 py-4 pb-36 sm:px-6 sm:py-5 sm:pb-28 lg:px-8 lg:pb-6">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 pb-5 text-sm">
        <p className="font-medium">Interview in progress</p>
        <p className="flex items-center gap-2 text-muted-foreground tabular-nums">
          <Clock3 className="size-4" aria-hidden="true" /> {elapsed}
        </p>
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-3 md:grid-cols-2">
        <VideoTile label="You" active={micOn} initials="LT" dark cameraOn={cameraOn} />
        <VideoTile label="Interviewer" active={isPlaying} initials="AI" cameraOn />
      </div>
      <section
        aria-labelledby="voice-lab-title"
        className="mx-auto mt-5 w-full max-w-6xl border-t pt-5"
        data-aos="fade-up"
        data-aos-duration="450"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div className="card card-border bg-card">
            <div className="card-body gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="voice-lab-title" className="card-title text-xl tracking-[-0.02em]">
                    Voice test room
                  </h2>
                  <p className="mt-1 max-w-[58ch] text-sm leading-6 text-muted-foreground">
                    Type a short interviewer line and the local stack turns it into audio with the
                    <span className="font-medium text-foreground"> af_bella + af_heart </span> voice mix.
                  </p>
                </div>
                <div
                  className={`badge badge-outline shrink-0 gap-2 py-3 text-xs font-medium ${
                    speechStatus === "ready"
                      ? "badge-success"
                      : speechStatus === "checking"
                        ? "badge-info"
                        : "badge-warning"
                  }`}
                >
                  <span
                    className={`status ${speechStatus === "checking" ? "status-info animate-pulse" : ""} ${
                      speechStatus === "ready" ? "status-success" : speechStatus === "unavailable" ? "status-warning" : ""
                    }`}
                    aria-hidden="true"
                  />
                  {speechStatus === "ready"
                    ? "Kokoro ready"
                    : speechStatus === "checking"
                      ? "Checking service"
                      : speechStatus === "fake"
                        ? "Fake provider active"
                        : "Service unavailable"}
                </div>
              </div>

              <fieldset className="fieldset w-full gap-2">
                <legend className="fieldset-legend text-sm font-medium">English line to speak</legend>
                <textarea
                  className="textarea textarea-bordered min-h-28 w-full resize-y bg-base-100 text-base leading-6"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Type what the interviewer should say in English..."
                  maxLength={2000}
                />
                <p className="label text-muted-foreground">{text.length} / 2,000 characters</p>
              </fieldset>

              {speechError && (
                <div role="alert" className="alert alert-error alert-soft text-sm">
                  <VolumeX className="size-4" aria-hidden="true" />
                  <span>{speechError}</span>
                </div>
              )}

              <div className="card-actions items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs leading-5 text-muted-foreground">
                  Audio stays on this device during this local test.
                </p>
                <div className="flex w-full gap-2 sm:w-auto">
                  {isPlaying && (
                    <button type="button" className="btn btn-ghost" onClick={stopAudio}>
                      <Square className="size-4" aria-hidden="true" /> Stop
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary flex-1 sm:flex-none"
                    onClick={() => void generateSpeech()}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                    ) : (
                      <Play className="size-4" aria-hidden="true" />
                    )}
                    {isGenerating ? "Generating…" : "Speak with Kokoro"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="card card-border bg-base-200">
            <div className="card-body gap-4 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-content">
                  <Container className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="card-title text-base">One-command local stack</h2>
                  <p className="text-xs text-muted-foreground">Frontend, backend and Kokoro start together</p>
                </div>
              </div>
              <div className="rounded-field border border-base-300 bg-base-100 px-3 py-2 font-mono text-xs text-base-content">
                docker compose up -d
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Run it from the project root with Docker Desktop open, then use this page at <strong className="text-base-content">localhost:3000</strong>.
              </p>
              <ul className="steps steps-vertical w-full text-xs">
                <li className="step step-primary text-left">
                  <span><strong>Frontend</strong> opens this test room on <code>localhost:3000</code>.</span>
                </li>
                <li className="step step-primary text-left">
                  <span><strong>Backend</strong> receives the sentence on <code>localhost:3001</code>.</span>
                </li>
                <li className="step step-primary text-left">
                  <span><strong>Kokoro</strong> generates the MP3 on port <code>8880</code>; the backend returns it here.</span>
                </li>
              </ul>
              {speechStatus === "unavailable" && (
                <div role="alert" className="alert alert-warning alert-soft text-xs leading-5">
                  <Container className="size-4 shrink-0" aria-hidden="true" />
                  <span>Service not ready. Check Docker Desktop, run the command above from the project root, then refresh this status.</span>
                </div>
              )}
              <div className="mt-auto flex items-center justify-between border-t pt-4">
                <span className="text-xs text-muted-foreground">Browser → backend → Kokoro</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void checkSpeechStatus()}
                  aria-label="Check local speech service again"
                >
                  <RefreshCw className="size-4" aria-hidden="true" /> Refresh
                </button>
              </div>
            </div>
          </aside>
        </div>
      </section>
      <div className="mx-auto flex w-full max-w-6xl justify-center pt-5">
        <div className="grid w-full max-w-sm grid-cols-3 items-center gap-3 rounded-xl border bg-card p-3 sm:flex sm:w-auto sm:max-w-none sm:gap-2 sm:p-2">
          <Button
            variant={micOn ? "secondary" : "destructive"}
            size="icon-lg"
            className="justify-self-center"
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            onClick={() => setMicOn(!micOn)}
          >
            {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </Button>
          <Button
            variant={cameraOn ? "secondary" : "destructive"}
            size="icon-lg"
            className="justify-self-center"
            aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
            onClick={() => setCameraOn(!cameraOn)}
          >
            {cameraOn ? <Camera className="size-4" /> : <VideoOff className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            className="justify-self-center"
            aria-label="Interview options"
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            variant="destructive"
            className="col-span-3 h-11 w-full gap-2 px-4 sm:col-auto sm:h-9 sm:w-auto"
            onClick={onLeave}
          >
            <PhoneOff className="size-4" /> End call
          </Button>
        </div>
      </div>
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
              onStart={() => navigate("interview")}
              onProgress={() => navigate("progress")}
            />
          )}
          {view === "interview" && <InterviewView onLeave={() => navigate("home")} />}
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
