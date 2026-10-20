import type { CSSProperties, ReactNode } from "react";

/**
 * One loading language for the whole app: a calm voice-waveform mark that breathes next to a sentence-case label, and skeleton
 * blocks that mirror the layout that is coming, with a soft green-tinted shimmer. Styles live in the "Loading" block of
 * design-system.css. Skeletons never carry `data-reveal`: the content entrance plays after the swap.
 */

export function LoadingMark({ className = "" }: { className?: string }) {
  return (
    <span className={`ld-mark ${className}`.trim()} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
    </span>
  );
}

/** The friendly status line. `children` is the already translated sentence ("Organizando seu histórico…"). */
export function LoadingLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`ld-label ${className}`.trim()} role="status" aria-live="polite">
      <LoadingMark />
      <span>{children}</span>
    </p>
  );
}

type SkProps = { className?: string; w?: string; h?: string; r?: string; i?: number; style?: CSSProperties };

/** A single shimmering placeholder. Size with `w`/`h` (any CSS length) or classes; `i` staggers the sweep. */
export function Sk({ className = "", w, h, r, i = 0, style }: SkProps) {
  return <span className={`ld-sk ${className}`.trim()} aria-hidden="true" style={{ width: w, height: h, borderRadius: r, "--i": i, ...style } as CSSProperties} />;
}

/** Text-like lines; the last one is shorter, like a paragraph. */
export function SkLines({ lines = 2, h = "0.8rem", i = 0 }: { lines?: number; h?: string; i?: number }) {
  return (
    <span className="ld-lines" aria-hidden="true">
      {Array.from({ length: lines }, (_, n) => <Sk key={n} h={h} i={i + n} w={n === lines - 1 && lines > 1 ? "62%" : "100%"} />)}
    </span>
  );
}

/** A card-shaped placeholder with a faint title bar and lines inside. */
export function SkCard({ lines = 3, minHeight, i = 0, className = "", children }: { lines?: number; minHeight?: string; i?: number; className?: string; children?: ReactNode }) {
  return (
    <div className={`ld-card ${className}`.trim()} style={{ minHeight }} aria-hidden="true">
      <Sk h="0.95rem" w="42%" i={i} />
      {children ?? <SkLines lines={lines} i={i + 1} />}
    </div>
  );
}

/** Faux chart area: soft columns of different heights where a chart or trend will draw. */
export function SkChart({ bars = 12, h = "9rem", i = 0 }: { bars?: number; h?: string; i?: number }) {
  const shape = [38, 56, 44, 70, 52, 64, 82, 58, 74, 66, 88, 72];
  return (
    <span className="ld-chart" style={{ height: h }} aria-hidden="true">
      {Array.from({ length: bars }, (_, n) => <Sk key={n} className="ld-col" i={i + n} h={`${shape[n % shape.length]}%`} />)}
    </span>
  );
}

/** Wrapper that announces busy state; put a LoadingLabel and the skeleton shapes inside. */
export function LoadingRegion({ label, className = "", children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`ld-region ${className}`.trim()} aria-busy="true">
      <LoadingLabel>{label}</LoadingLabel>
      {children}
    </section>
  );
}
