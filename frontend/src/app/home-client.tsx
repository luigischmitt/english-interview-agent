"use client";

import AOS from "aos";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Home,
  LineChart,
  Moon,
  Play,
  SlidersHorizontal,
  Sun,
  Target,
  Video,
  Volume2,
} from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import type { InterviewConfig } from "@/lib/interview/types";

import "aos/dist/aos.css";

type View = "home" | "interview-setup" | "interview" | "progress" | "settings";

const primaryNavigationItems = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "interview-setup" as const, label: "Interview", icon: Video },
  { id: "progress" as const, label: "Progress", icon: LineChart },
];

const settingsNavigationItem = { id: "settings" as const, label: "Settings", icon: SlidersHorizontal };
const navigationItems = [...primaryNavigationItems, settingsNavigationItem];

import { InterviewRoom } from "./components/interview-room";
import { InterviewSetup } from "./components/interview-setup";
import { ProgressView } from "./components/progress-view";
import { PageIntro, SectionHeading } from "./components/shared";
import { defaultInterviewConfig } from "./interview-config";

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
  const renderNavigationItem = ({ id, label, icon: Icon }: (typeof navigationItems)[number]) => (
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
  );

  return (
    <>
      <aside
        className="sticky top-0 hidden min-h-dvh w-60 shrink-0 border-r bg-sidebar px-4 py-5 lg:flex lg:flex-col"
      >
        <div className="pb-8">
          <Brand />
        </div>
        <nav aria-label="Primary navigation">
          <ul className="space-y-1">{primaryNavigationItems.map(renderNavigationItem)}</ul>
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <nav aria-label="Utility navigation">
            <ul>{renderNavigationItem(settingsNavigationItem)}</ul>
          </nav>
        </div>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">
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
