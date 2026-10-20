import type { CSSProperties } from "react";

/**
 * A heading whose letters rise out of a blur one after another, like the landing's headline. Screen readers get the plain
 * text (the animated copy is aria-hidden); without CSS motion (reduced motion) the letters simply sit in place.
 * The per-letter stagger shrinks for long titles so every title finishes forming in about 1s.
 */
export function SplitTitle({ text }: { text: string }) {
  const words = text.split(" ");
  const total = text.length;
  const stagger = Math.min(20, 330 / Math.max(1, total));
  let index = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="ds-split" style={{ "--cs": `${stagger.toFixed(1)}ms` } as CSSProperties}>
        {words.map((word, w) => {
          const chars = Array.from(word).map((char) => <span key={index} className="ds-split-ch" style={{ "--i": index++ } as CSSProperties}>{char}</span>);
          index += 1; // the space
          return <span key={w}><span className="ds-split-w">{chars}</span>{w < words.length - 1 ? " " : ""}</span>;
        })}
      </span>
    </>
  );
}
