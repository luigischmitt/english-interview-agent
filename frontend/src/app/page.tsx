"use client";

import { useEffect, useState } from "react";
import {
  Camera,
  ChevronRight,
  Clock3,
  Home,
  Mic,
  MicOff,
  Moon,
  PhoneOff,
  Play,
  Settings2,
  Sun,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type View = "home" | "interview";

const recentSessions = [
  { name: "Technical interview", date: "Today", score: "72" },
  { name: "Behavioral interview", date: "Sep 27", score: "68" },
  { name: "General conversation", date: "Sep 24", score: "64" },
];

function TrendChart() {
  return (
    <svg
      aria-label="Communication confidence improved from 48 to 72 across five sessions"
      className="h-20 w-full overflow-visible"
      viewBox="0 0 280 80"
      role="img"
    >
      <path
        d="M0 68H280M0 42H280M0 16H280"
        stroke="currentColor"
        className="text-border"
        strokeWidth="1"
      />
      <path
        d="M8 63 C44 58, 57 50, 84 51 S127 39, 152 39 S196 28, 220 31 S253 18, 272 16"
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {[
        [8, 63],
        [84, 51],
        [152, 39],
        [220, 31],
        [272, 16],
      ].map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="3.5"
          className="fill-background stroke-primary"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card lg:flex lg:flex-col">
      <div className="flex items-center gap-3 px-6 py-7">
        <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Volume2 className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">Interview Agent</span>
      </div>
      <nav className="space-y-1 px-3">
        <button
          onClick={() => onNavigate("home")}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${view === "home" ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
        >
          <Home className="size-4" /> Home
        </button>
        <button
          onClick={() => onNavigate("interview")}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${view === "interview" ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
        >
          <Video className="size-4" /> Interviews
        </button>
      </nav>
      <div className="mt-auto p-5 text-xs leading-5 text-muted-foreground">
        Practice with intention. Speak with confidence.
      </div>
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
    <header className="flex h-18 items-center justify-between border-b px-5 sm:px-8">
      <div className="flex items-center gap-2 lg:hidden">
        <Volume2 className="size-4 text-primary" />
        <span className="text-sm font-semibold">Interview Agent</span>
      </div>
      <div className="hidden text-sm text-muted-foreground lg:block">
        Your interview practice space
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle color theme"
        onClick={onToggleTheme}
      >
        {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
    </header>
  );
}

function HomeView({ onStart }: { onStart: () => void }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 lg:py-14">
      <section className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">
            Tuesday, October 1
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Good evening, Lucas.
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Your next interview is an opportunity to make your technical
            experience sound as strong in English as it is in Portuguese.
          </p>
        </div>
        <Button size="lg" className="gap-2" onClick={onStart}>
          <Play className="size-4 fill-current" /> Start interview
        </Button>
      </section>

      <section className="mt-12 grid gap-5 md:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <p className="text-sm font-medium">Communication confidence</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your last five sessions
              </p>
            </div>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
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
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              Practice summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-2xl font-semibold tracking-tight">12</p>
              <p className="text-sm text-muted-foreground">
                interviews completed
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-2xl font-semibold tracking-tight">4h 28m</p>
              <p className="text-sm text-muted-foreground">time practiced</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5 grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium">
              Your focus now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <FocusRow
              label="Answer structure"
              status="In progress"
              value={58}
            />
            <FocusRow label="Verb tense" status="Improving" value={70} />
            <FocusRow label="Pacing" status="Stable" value={76} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-medium">
              Recent sessions
            </CardTitle>
            <button className="text-sm text-primary hover:underline">
              View all
            </button>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentSessions.map((session) => (
              <button
                key={session.name}
                className="flex w-full items-center justify-between rounded-md px-2 py-3 text-left hover:bg-accent"
              >
                <div>
                  <p className="text-sm font-medium">{session.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.date}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
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
      <div className="mb-2 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      <Progress value={value} />
    </div>
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
    <main className="flex min-h-[calc(100vh-4.5rem)] flex-col px-4 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between pb-5 text-sm">
        <div className="flex items-center gap-2 font-medium">
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
      className={`relative flex min-h-72 items-center justify-center overflow-hidden rounded-2xl border ${dark ? "bg-slate-800 text-white" : "bg-secondary"} ${active ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background" : ""}`}
    >
      {cameraOn ? (
        <Avatar className="size-28 border-4 border-background/70 text-2xl">
          <AvatarFallback
            className={
              dark
                ? "bg-slate-700 text-white"
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
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <Sidebar view={view} onNavigate={setView} />
        <div className="min-w-0 flex-1">
          <Topbar
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode(!darkMode)}
          />
          {view === "home" ? (
            <HomeView onStart={() => setView("interview")} />
          ) : (
            <InterviewView onLeave={() => setView("home")} />
          )}
        </div>
      </div>
    </div>
  );
}
