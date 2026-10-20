import type { CSSProperties } from "react";

/**
 * Low-level helper: a heading whose letters rise out of a blur one after another (the landing's headline). Screen readers get
 * the plain text (the animated copy is aria-hidden); under reduced motion the letters sit in place. Use it sparingly: one
 * signature heading, not every page.
 * Parameters: `rise` (em the letters travel, 0 = none), `blur` (px, 0 = off), `duration` (ms per letter), `budget` (ms the whole
 * stagger may span, so long titles do not drag) and `maxStagger` (ms between letters for short titles).
 */
export function SplitTitle({ text, rise = 0.5, blur = 7, duration = 800, budget = 330, maxStagger = 20 }: {
  text: string;
  rise?: number;
  blur?: number;
  duration?: number;
  budget?: number;
  maxStagger?: number;
}) {
  const words = text.split(" ");
  const stagger = Math.min(maxStagger, budget / Math.max(1, text.length));
  let index = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="ds-split" style={{ "--cs": `${stagger.toFixed(1)}ms`, "--ch-y": `${rise}em`, "--ch-blur": `${blur}px`, "--ch-d": `${duration}ms` } as CSSProperties}>
        {words.map((word, w) => {
          const chars = Array.from(word).map((char) => <span key={index} className="ds-split-ch" style={{ "--i": index++ } as CSSProperties}>{char}</span>);
          index += 1; // the space
          return <span key={w}><span className="ds-split-w">{chars}</span>{w < words.length - 1 ? " " : ""}</span>;
        })}
      </span>
    </>
  );
}
