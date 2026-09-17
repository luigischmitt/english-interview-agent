"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Camera,
  ChevronRight,
  Clock3,
  Home,
  LineChart,
  Menu,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type View = "home" | "interview" | "progress" | "settings";

const sessions = [
  { name: "Technical interview", date: "Today", score: 72 },
  { name: "Behavioral interview", date: "Sep 27", score: 68 },
  { name: "General conversation", date: "Sep 24", score: 64 },
];

function TrendChart() {
  return (
    <svg
      aria-label="Communication confidence improved from 48 to 72 across five sessions"
      className="h-24 w-full"
      role="img"
      viewBox="0 0 420 96"
    >
      <path
        d="M0 80H420M0 48H420M0 16H420"
        className="stroke-border"
        strokeWidth="1"
      />
      <path
        d="M10 74 C53 66, 85 58, 128 59 S195 46, 226 43 S284 35, 321 31 S376 20, 408 16"
        className="stroke-primary"
        fill="none"
        strokeLinecap="round"
        strokeWidth="3"
      />
      {[
        [10, 74],
        [128, 59],
        [226, 43],
        [321, 31],
        [408, 16],
      ].map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="4"
          className="fill-card stroke-primary"
          strokeWidth="2.5"
        />
      ))}
    </svg>
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
  const items = [
    { id: "home" as const, label: "Home", icon: Home },
    { id: "interview" as const, label: "Interview", icon: Video },
    { id: "progress" as const, label: "Progress", icon: LineChart },
    { id: "settings" as const, label: "Settings", icon: SlidersHorizontal },
  ];

  return (
    <aside
      className={`group/sidebar sticky top-0 hidden h-screen shrink-0 border-r bg-sidebar transition-[width] duration-200 lg:flex lg:flex-col ${expanded ? "w-60" : "w-[72px]"}`}
      onMouseEnter={() => onExpand(true)}
      onMouseLeave={() => onExpand(false)}
    >
      <div className="flex h-[72px] items-center px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Expand navigation"
          onClick={() => onExpand(!expanded)}
        >
          <Menu className="size-4" />
        </Button>
        <div
          className={`ml-3 flex items-center gap-2 overflow-hidden whitespace-nowrap transition-all ${expanded ? "w-40 opacity-100" : "w-0 opacity-0"}`}
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Volume2 className="size-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Interview Agent
          </span>
        </div>
      </div>
      <nav className="space-y-2 px-3">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            title={expanded ? undefined : label}
            onClick={() => onNavigate(id)}
            className={`flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm transition-colors ${view === id ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
          >
            <Icon className="size-4 shrink-0" />
            <span
              className={`overflow-hidden whitespace-nowrap transition-all ${expanded ? "w-32 opacity-100" : "w-0 opacity-0"}`}
            >
              {label}
            </span>
          </button>
        ))}
      </nav>
      <p
        className={`mt-auto overflow-hidden px-5 pb-7 text-xs leading-5 text-muted-foreground transition-all ${expanded ? "h-12 opacity-100" : "h-0 opacity-0"}`}
      >
        Speak with the confidence your experience deserves.
      </p>
    </aside>
  );
}

function Topbar({
  darkMode,
  onToggleTheme,
}: {
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <header className="flex h-[72px] items-center justify-between border-b bg-background/90 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-2 lg:hidden">
        <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Volume2 className="size-3.5" />
        </span>
        <span className="text-sm font-semibold">Interview Agent</span>
      </div>
      <p className="hidden text-sm text-muted-foreground lg:block">
        Your interview practice space
      </p>
      <Button
        variant="outline"
        size="icon"
        aria-label="Toggle color theme"
        onClick={onToggleTheme}
      >
        {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
    </header>
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
    <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10 lg:py-14">
      <section className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-3 text-sm font-medium text-primary">
            Tuesday, October 1
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Good evening, Lucas.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-6 text-muted-foreground">
            Keep building confidence for the moments that matter most.
          </p>
        </div>
        <Button size="lg" className="gap-2" onClick={onStart}>
          <Play className="size-4 fill-current" /> Start interview
        </Button>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-primary/15 bg-card">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                Your next practice
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                A focused session for today
              </p>
            </div>
            <Target className="size-5 text-primary" />
          </CardHeader>
          <CardContent className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Technical interview
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Mid-level · 25 minutes · Spoken English
              </p>
            </div>
            <Button variant="secondary" className="gap-2" onClick={onStart}>
              Begin session <ArrowUpRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold tracking-tight text-foreground">
              72<span className="ml-1 text-lg text-muted-foreground">/100</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Up 8 points this month
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">
                Communication confidence
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Last five interviews
              </p>
            </div>
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              +18%
            </span>
          </CardHeader>
          <CardContent>
            <TrendChart />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>Sep 3</span>
              <span>Today</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium">
              Focus for your next session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <FocusRow
              label="Answer structure"
              status="Primary focus"
              value={58}
            />
            <FocusRow label="Verb tense" status="Improving" value={70} />
            <FocusRow label="Pacing" status="Stable" value={76} />
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent sessions</h2>
          <button
            onClick={onProgress}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            See progress <ChevronRight className="size-4" />
          </button>
        </div>
        <Card>
          <CardContent className="p-2">
            {sessions.map((session) => (
              <button
                key={session.name}
                onClick={onProgress}
                className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {session.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {session.date}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {session.score}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
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
      <div className="mb-2 flex justify-between gap-4 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      <Progress value={value} />
    </div>
  );
}

function ProgressView() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-10 lg:py-14">
      <p className="text-sm font-medium text-primary">Performance</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Your progress
      </h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        A simple view of the skills that are becoming more automatic under
        interview pressure.
      </p>
      <section className="mt-10 grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Confidence trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Sep 3</span>
              <span>Today</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">This month</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Metric label="Interviews completed" value="12" />
            <Separator />
            <Metric label="Time practiced" value="4h 28m" />
            <Separator />
            <Metric label="Average readiness" value="68" />
          </CardContent>
        </Card>
      </section>
      <section className="mt-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Skill development
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FocusRow label="Answer structure" status="58%" value={58} />
            <FocusRow label="Verb tense" status="70%" value={70} />
            <FocusRow label="Pacing" status="76%" value={76} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong className="text-lg text-foreground">{value}</strong>
    </div>
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
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-14">
      <p className="text-sm font-medium text-primary">Preferences</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-3 text-muted-foreground">
        Choose how your practice environment feels. Account management will be
        added later.
      </p>
      <section className="mt-10 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Appearance</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-foreground">
                {darkMode ? "Dark mode" : "Light mode"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Light mode is the default experience.
              </p>
            </div>
            <Button variant="outline" className="gap-2" onClick={onToggleTheme}>
              {darkMode ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}{" "}
              Switch to {darkMode ? "light" : "dark"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Interview preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Voice-first interview
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Interview interactions will happen by voice.
                </p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                Enabled
              </span>
            </div>
            <Separator />
            <p className="text-sm text-muted-foreground">
              Camera and interviewer-avatar preferences will be configurable in
              a later iteration.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function InterviewView({ onLeave }: { onLeave: () => void }) {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [seconds, setSeconds] = useState(134);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col px-4 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between pb-5 text-sm">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <span className="size-2 rounded-full bg-emerald-500" /> Interview in
          progress
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock3 className="size-4" /> {elapsed}
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-4 md:grid-cols-2">
        <VideoTile
          label="You"
          active={micOn}
          initials="LT"
          dark
          cameraOn={cameraOn}
        />
        <VideoTile label="Interviewer" active={!micOn} initials="AI" cameraOn />
      </div>
      <div className="mx-auto flex w-full max-w-6xl justify-center pt-6">
        <div className="flex items-center gap-2 rounded-2xl border bg-card p-2 shadow-sm">
          <Button
            variant={micOn ? "secondary" : "destructive"}
            size="icon"
            aria-label="Toggle microphone"
            onClick={() => setMicOn(!micOn)}
          >
            {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </Button>
          <Button
            variant={cameraOn ? "secondary" : "destructive"}
            size="icon"
            aria-label="Toggle camera"
            onClick={() => setCameraOn(!cameraOn)}
          >
            {cameraOn ? (
              <Camera className="size-4" />
            ) : (
              <VideoOff className="size-4" />
            )}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Interview options"
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            variant="destructive"
            className="gap-2 px-4"
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
      className={`relative flex min-h-72 items-center justify-center overflow-hidden rounded-2xl border ${dark ? "bg-[#2a2d2e] text-white" : "bg-secondary"} ${active ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background" : ""}`}
    >
      {cameraOn ? (
        <Avatar className="size-28 border-4 border-background/70 text-2xl">
          <AvatarFallback
            className={
              dark
                ? "bg-[#414a49] text-white"
                : "bg-primary text-primary-foreground"
            }
          >
            {initials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="text-center">
          <VideoOff className="mx-auto size-7 opacity-55" />
          <p className="mt-3 text-sm opacity-70">Camera is off</p>
        </div>
      )}
      {active && (
        <div className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Volume2 className="size-4" />
        </div>
      )}
      <span className="absolute bottom-4 left-4 rounded-md bg-black/55 px-2.5 py-1.5 text-sm text-white">
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
  }, [darkMode]);
  const navigate = (nextView: View) => {
    setView(nextView);
    setSidebarExpanded(false);
  };
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <Navigation
          view={view}
          expanded={sidebarExpanded}
          onNavigate={navigate}
          onExpand={setSidebarExpanded}
        />
        <div className="min-w-0 flex-1">
          <Topbar
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode(!darkMode)}
          />
          {view === "home" && (
            <HomeView
              onStart={() => navigate("interview")}
              onProgress={() => navigate("progress")}
            />
          )}
          {view === "interview" && (
            <InterviewView onLeave={() => navigate("home")} />
          )}
          {view === "progress" && <ProgressView />}
          {view === "settings" && (
            <SettingsView
              darkMode={darkMode}
              onToggleTheme={() => setDarkMode(!darkMode)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
