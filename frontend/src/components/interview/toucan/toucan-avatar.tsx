"use client";

import { useEffect, useId, useRef, type RefObject } from "react";

import { createToucanEngine, REST_BIB_PATH, REST_SKIN_PATH, type SpeechFeed, type ToucanState } from "./toucan-engine.mjs";

import "./toucan.css";

export type ToucanAvatarProps = {
  state: ToucanState;
  /** Receives the interviewer's audio chunks (see `onChunkAudio` in speech-playback.mjs) for the beak lip-sync. */
  speechFeed?: SpeechFeed | null;
  /** Smoothed candidate microphone level (0..1), written by the room; read once per frame while "listening". */
  candidateLevelRef?: RefObject<number>;
  className?: string;
};

// Below this tile area (px²) the animation runs at ~30 fps: nobody can tell, and it halves the work.
const SMALL_TILE_AREA = 200 * 200;
const SMALL_TILE_INTERVAL_MS = 1000 / 30;

/**
 * The animated toucan interviewer. One requestAnimationFrame loop per mounted avatar writes SVG attributes directly
 * (no React state per frame); it pauses while the tab is hidden, the tile is not visible, and on unmount.
 */
export function ToucanAvatar({ state, speechFeed = null, candidateLevelRef, className }: ToucanAvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const feedRef = useRef(speechFeed);
  const levelRef = useRef(candidateLevelRef);
  const engineRef = useRef<ReturnType<typeof createToucanEngine> | null>(null);

  useEffect(() => {
    stateRef.current = state;
    engineRef.current?.setState(state, performance.now() / 1000);
  }, [state]);
  useEffect(() => {
    feedRef.current = speechFeed;
    engineRef.current?.setFeed(speechFeed);
  }, [speechFeed]);
  useEffect(() => { levelRef.current = candidateLevelRef; }, [candidateLevelRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const engine = createToucanEngine({ root, reducedMotion: () => reduced.matches });
    engineRef.current = engine;
    engine.setState(stateRef.current, performance.now() / 1000);
    engine.setFeed(feedRef.current);

    let raf = 0;
    let lastPaint = 0;
    let minInterval = 0;
    let onScreen = true;
    const visible = () => onScreen && document.visibilityState === "visible";

    const tick = (ms: number) => {
      raf = 0;
      if (!visible()) return;
      raf = requestAnimationFrame(tick);
      if (minInterval && ms - lastPaint < minInterval - 2) return;
      lastPaint = ms;
      engine.setCandidateLevel(levelRef.current?.current ?? 0);
      engine.frame(ms / 1000);
    };
    const start = () => {
      if (raf || !visible()) return;
      engine.resume();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const sync = () => (visible() ? start() : stop());

    engine.frame(performance.now() / 1000); // first paint already in pose
    document.addEventListener("visibilitychange", sync);
    const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
      sync();
    });
    intersection?.observe(root);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      minInterval = box && box.width * box.height < SMALL_TILE_AREA ? SMALL_TILE_INTERVAL_MS : 0;
    });
    resize?.observe(root);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
      intersection?.disconnect();
      resize?.disconnect();
      engineRef.current = null;
    };
  }, []);

  const id = (name: string) => `toucan-${name}-${uid}`;
  return (
    <div ref={rootRef} className={`toucan${className ? ` ${className}` : ""}`} aria-hidden="true">
      <svg viewBox="30 0 350 280" preserveAspectRatio="xMidYMid meet" focusable="false">
        <defs>
          <radialGradient id={id("wall")} cx=".5" cy=".42" r=".75"><stop offset="0" style={{ stopColor: "var(--tc-wall-a)" }} /><stop offset="1" style={{ stopColor: "var(--tc-wall-b)" }} /></radialGradient>
          <radialGradient id={id("floor")} cx=".5" cy=".5" r=".5"><stop offset="0" style={{ stopColor: "var(--tc-floor)" }} /><stop offset="1" style={{ stopColor: "var(--tc-floor)", stopOpacity: 0 }} /></radialGradient>
          <clipPath id={id("eye")}><circle r="7" /></clipPath>
          <clipPath id={id("up")}><path d="M211,52 C248,29 332,33 372,88 C330,80 272,86 219,92 C207,86 203,66 211,52Z" /></clipPath>
        </defs>
        <rect x="-400" y="-300" width="1200" height="900" fill={`url(#${id("wall")})`} />
        <ellipse cx="168" cy="246" rx="150" ry="13" fill={`url(#${id("floor")})`} />
        <g transform="translate(-16 -10) scale(.94)">
          <path d="M30 268 C96 250 170 248 266 238" fill="none" stroke="var(--tc-branch)" strokeWidth="9" strokeLinecap="round" />
          <path d="M232 241 C246 228 252 218 250 206" fill="none" stroke="var(--tc-branch)" strokeWidth="5" strokeLinecap="round" />
          <g fill="none" stroke="var(--tc-feet)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M152,228 L152,240 M152,240 C150,247 144,250 139,248 M152,240 C155,247 161,250 166,247 M152,240 L152,251" />
            <path d="M180,224 L180,238 M180,238 C178,246 172,249 167,247 M180,238 C183,246 189,249 194,246 M180,238 L180,250" />
          </g>
          <g data-tc="tail">
            <path d="M106,200 C106,236 103,262 99,284 Q112,294 126,284 C136,264 146,246 154,222Z" fill="var(--tc-body)" />
            <path d="M100,272 Q113,280 125,272 L126,279 Q113,288 99,280Z" fill="var(--tc-wingline)" opacity=".92" />
          </g>
          <g data-tc="body">
            <path d="M118,112 C100,150 98,190 108,214 L152,234 L180,228 C206,214 226,186 226,152 C226,134 222,118 208.6,103.7Z" fill="var(--tc-body)" />
            <path d="M104,170 C106,150 128,142 146,152 C160,162 166,184 164,198 C162,222 150,238 138,250 C120,228 106,200 104,170Z" fill="var(--tc-wing)" />
            <path d="M112,188 C128,184 148,194 154,216 C150,232 144,242 138,250 C124,232 114,210 112,188Z" fill="var(--tc-wing2)" />
            <path d="M114,188 C120,210 128,232 138,250 L134,250 C124,232 116,212 111,192Z" fill="var(--tc-wingline)" />
          </g>
          <path data-tc="skin" d={REST_SKIN_PATH} fill="var(--tc-body)" />
          <g data-tc="head">
            <circle cx="178" cy="78" r="40" fill="var(--tc-body)" />
            <path d="M196,50 L211,52 L219,92 L229,110 L196,112Z" fill="var(--tc-body)" />
            <path data-tc="bib" d={REST_BIB_PATH} fill="var(--tc-bib)" />
            <g transform="translate(190 66)">
              <circle r="11.5" fill="var(--tc-ring)" stroke="var(--tc-ringedge)" strokeWidth="1.5" />
              <g clipPath={`url(#${id("eye")})`}>
                <circle r="7" fill="var(--tc-iris)" />
                <g data-tc="pup"><circle r="3.6" fill="#050706" /><circle cx="-1.6" cy="-1.8" r="1.4" fill="#fff" /></g>
                <g data-tc="lid"><rect x="-9" y="-24" width="18" height="24" fill="var(--tc-ring)" /><line x1="-9" y1="0" x2="9" y2="0" stroke="var(--tc-ringedge)" strokeWidth="1.6" /></g>
              </g>
              <path data-tc="lash" d="M-5,1 Q0,5 5,1" fill="none" stroke="var(--tc-ringedge)" strokeWidth="1.8" strokeLinecap="round" opacity="0" />
            </g>
            <g data-tc="beak">
              <path data-tc="wedge" d="" className="toucan-wedge" />
              <g data-tc="mouth" />
              <g data-tc="lower">
                <path d="M219,92 C267,86.6 319,81.2 358.8,86 C340,104 286,114 227,110 C212,106 211,98 219,92Z" fill="var(--tc-low)" />
                <path d="M219,92 C267,86.6 319,81.2 358.8,86" fill="none" stroke="#8a5a36" strokeWidth="1.1" strokeLinecap="round" opacity=".8" />
                <path d="M229,104 C264,106 318,100 350,90" fill="none" stroke="var(--tc-up-shade)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
                <path d="M227,111 C264,114 322,106 359,87" fill="none" stroke="var(--tc-edge)" strokeWidth="1.4" strokeLinecap="round" />
              </g>
              <g data-tc="upper">
                <path d="M211,52 C248,29 332,33 372,88 C330,80 272,86 219,92 C207,86 203,66 211,52Z" fill="var(--tc-up)" />
                <g clipPath={`url(#${id("up")})`}>
                  <path d="M203,70 C250,70 310,66 380,80 L380,104 L190,104Z" fill="var(--tc-up-shade)" />
                  <path d="M318,20 C346,54 330,80 312,108 L392,108 L392,20Z" fill="var(--tc-tip)" />
                </g>
                <path d="M227,89 C272,84 328,78 364,84" fill="none" stroke="var(--tc-edge)" strokeWidth="1.2" opacity=".8" />
                <path d="M229,47 C266,39 318,45 348,64" fill="none" stroke="var(--tc-edge)" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
                <path d="M227,57 C260,50 306,55 336,70" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M211,52 C248,29 332,33 372,88 C330,80 272,86 219,92 C207,86 203,66 211,52Z" fill="none" stroke="var(--tc-edge)" strokeWidth="1.8" strokeLinejoin="round" />
                <ellipse cx="241" cy="62" rx="5.5" ry="2.5" transform="rotate(10 241 62)" fill="var(--tc-body)" opacity=".8" />
                <path d="M235,57 C241,55 247,57 251,60" fill="none" stroke="var(--tc-edge)" strokeWidth="1.2" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
