"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Camera,
  Clock3,
  Home,
  LineChart,
  Mic,
  MicOff,
  Moon,
  PhoneOff,
  Play,
  Settings2,
  SlidersHorizontal,
  Sun,
  Target,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

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
          expanded ? "w-60 px-4" : "w-[72px] px-3"
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
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
      >
        <ul className="menu menu-horizontal grid grid-cols-4 p-0">
          {navigationItems.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className={`flex min-h-12 flex-col gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${
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
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/92 px-5 backdrop-blur sm:px-8">
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
  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.03em] sm:text-[2.5rem]">
          {title}
        </h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-6 text-muted-foreground sm:text-base">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function TrendChart() {
  return (
    <svg
      aria-label="Communication confidence improved from 48 to 72 across five sessions"
      className="h-36 w-full overflow-visible"
      role="img"
      viewBox="0 0 520 140"
      preserveAspectRatio="none"
    >
      <path d="M0 118H520M0 70H520M0 22H520" className="stroke-border" />
      <path
        d="M8 116 C68 103, 116 91, 166 92 S247 72, 284 68 S362 54, 402 48 S474 27, 512 22"
        className="stroke-primary"
        fill="none"
        strokeLinecap="round"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
      {[
        [8, 116],
        [166, 92],
        [284, 68],
        [402, 48],
        [512, 22],
      ].map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="4"
          className="fill-card stroke-primary"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
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
  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-5 py-10 pb-28 sm:px-8 lg:px-12 lg:py-14">
      <PageIntro
        title="Good evening, Lucas."
        description="Practice the English that helps your experience come through clearly in an interview."
        action={
          <Button size="lg" className="h-11 gap-2 px-5" onClick={onStart}>
            <Play className="size-4 fill-current" /> Start interview
          </Button>
        }
      />

      <section className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-start">
        <Card className="min-w-0 justify-between gap-8 border border-primary/20 bg-card p-6 py-6 ring-0 sm:p-8">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Next practice</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
                Technical interview
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Mid-level, 25 minutes, spoken English
              </p>
            </div>
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              <Target className="size-5" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Focus on structuring technical decisions before adding detail.
            </p>
            <Button variant="secondary" className="gap-2" onClick={onStart}>
              Begin session <ArrowRight className="size-4" />
            </Button>
          </div>
        </Card>

        <div className="border-y py-1">
          <SectionHeading
            title="In this session"
            description="A focused format that keeps you in interview mode."
          />
          <div className="mt-5 space-y-4">
            <div>
              <p className="text-sm font-medium">Answer out loud</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Build clarity while you speak, not after the answer is finished.
              </p>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm font-medium">Handle follow-ups</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Practice staying precise when the interviewer asks for more detail.
              </p>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm font-medium">Review what matters</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Receive feedback after the session, prioritized by impact.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:gap-14">
        <div>
          <SectionHeading
            title="Continue from your last session"
            description="Your feedback carries into the next practice."
          />
          <div className="mt-6 border-y py-5">
            <p className="text-sm font-medium">Keep the decision before the detail</p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Your answers were easier to follow when you started with the choice you made, then explained the trade-offs.
            </p>
            <button
              type="button"
              onClick={onProgress}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Review progress <ArrowRight className="size-4" />
            </button>
          </div>
        </div>

        <div>
          <SectionHeading title="A calmer start" description="You do not need perfect English to begin." />
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            Take a moment to think, answer in complete ideas, and let the interviewer guide the next question.
          </p>
          <Button variant="outline" className="mt-5 gap-2" onClick={onStart}>
            Enter interview room <ArrowRight className="size-4" />
          </Button>
        </div>
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

function ProgressView() {
  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-5 py-10 pb-28 sm:px-8 lg:px-12 lg:py-14">
      <PageIntro
        title="Your progress"
        description="See which communication skills are becoming more reliable under interview pressure."
      />
      <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.55fr)] lg:gap-14">
        <div>
          <SectionHeading title="Confidence trend" description="Last five interviews" />
          <div className="mt-7">
            <TrendChart />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Sep 3</span>
              <span>Today</span>
            </div>
          </div>
        </div>
        <div>
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
      <section className="mt-16 max-w-3xl">
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
    <main className="mx-auto w-full min-w-0 max-w-4xl px-5 py-10 pb-28 sm:px-8 lg:px-12 lg:py-14">
      <PageIntro
        title="Settings"
        description="Adjust the practice environment to make each session comfortable and focused."
      />
      <section className="mt-12">
        <SectionHeading title="Appearance" />
        <div className="mt-4 flex flex-col gap-5 border-y py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{darkMode ? "Dark theme" : "Light theme"}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Light is the default. Choose the theme that feels most comfortable.
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={onToggleTheme}>
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Use {darkMode ? "light" : "dark"} theme
          </Button>
        </div>
      </section>
      <section className="mt-12">
        <SectionHeading title="Interview experience" />
        <div className="mt-4 border-y">
          <div className="flex items-start justify-between gap-6 py-5">
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

function InterviewView({ onLeave }: { onLeave: () => void }) {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [seconds, setSeconds] = useState(134);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] flex-col px-4 py-5 pb-28 sm:px-6 lg:px-8 lg:pb-6">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between pb-5 text-sm">
        <p className="font-medium">Interview in progress</p>
        <p className="flex items-center gap-2 text-muted-foreground tabular-nums">
          <Clock3 className="size-4" aria-hidden="true" /> {elapsed}
        </p>
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-3 md:grid-cols-2">
        <VideoTile label="You" active={micOn} initials="LT" dark cameraOn={cameraOn} />
        <VideoTile label="Interviewer" active={!micOn} initials="AI" cameraOn />
      </div>
      <div className="mx-auto flex w-full max-w-6xl justify-center pt-5">
        <div className="flex items-center gap-2 rounded-xl border bg-card p-2">
          <Button
            variant={micOn ? "secondary" : "destructive"}
            size="icon-lg"
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            onClick={() => setMicOn(!micOn)}
          >
            {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </Button>
          <Button
            variant={cameraOn ? "secondary" : "destructive"}
            size="icon-lg"
            aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
            onClick={() => setCameraOn(!cameraOn)}
          >
            {cameraOn ? <Camera className="size-4" /> : <VideoOff className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-lg" aria-label="Interview options">
            <Settings2 className="size-4" />
          </Button>
          <Button variant="destructive" className="h-9 gap-2 px-4" onClick={onLeave}>
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
      className={`relative flex min-h-72 items-center justify-center overflow-hidden rounded-xl border ${
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
