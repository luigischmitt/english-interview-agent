"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";

import {
  applyColorScheme,
  readStoredPreference,
  resolveColorScheme,
  writeStoredPreference,
  type ColorPreference,
} from "@/lib/theme/color-scheme.mjs";

import "./theme-toggle.css";

const OPTIONS = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const satisfies readonly { value: ColorPreference; label: string; icon: unknown }[];

const CHANGE_EVENT = "eia:color-preference-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// The server cannot know the preference: render "system" and let the client snapshot take over after hydration.
const getServerSnapshot = (): ColorPreference => "system";
const getSnapshot = (): ColorPreference => readStoredPreference(getStorage());

// Kept in memory when storage is blocked, so the toggle still works for the current page.
let memoryPreference: ColorPreference | null = null;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const preference = memoryPreference ?? stored;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const apply = useCallback((next: ColorPreference, animate: boolean) => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && !reduceMotion) {
      root.setAttribute("data-theme-transition", "");
      window.setTimeout(() => root.removeAttribute("data-theme-transition"), 220);
    }
    applyColorScheme(root, resolveColorScheme(next, window.matchMedia(DARK_QUERY).matches));
  }, []);

  const select = useCallback(
    (next: ColorPreference) => {
      const saved = writeStoredPreference(getStorage(), next);
      memoryPreference = saved ? null : next;
      apply(next, true);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [apply],
  );

  // Follow the OS while the preference is "system" (also covers another tab changing the stored value).
  useEffect(() => {
    apply(preference, false);
    if (preference !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => apply("system", true);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference, apply]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const nextIndex = (index + step + OPTIONS.length) % OPTIONS.length;
    select(OPTIONS[nextIndex].value);
    buttons.current[nextIndex]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Tema" className={`thm-toggle ${className}`}>
      {OPTIONS.map(({ value, label, icon: Icon }, index) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            className="thm-item"
            onClick={() => select(value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
