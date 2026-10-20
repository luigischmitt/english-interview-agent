import { SplitTitle } from "@/components/ui/split-title";

/** Page heading. Default: the title rises calmly with the subcopy and action right after; replays whenever the screen mounts. */
export function PageIntro({
  title,
  description,
  action,
  titleEffect = "rise",
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  /** "rise": calm block rise (default). "letters": letters form (reserve for one signature heading). */
  titleEffect?: "rise" | "letters";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-balance font-[family-name:var(--font-display)] text-[clamp(2.25rem,calc(1.5rem+3.75vw),3rem)] leading-[1.08] tracking-[-0.02em]">
          {titleEffect === "letters"
            ? <SplitTitle key={title} text={title} />
            : <span key={title} className="ds-rise" style={{ "--d": "0ms", "--rise-y": "12px", "--rise-t": "550ms", display: "inline-block" } as React.CSSProperties}>{title}</span>}
        </h1>
        <p className="ds-rise mt-3 max-w-[60ch] text-[15px] leading-6 text-muted-foreground sm:text-base" style={{ "--d": "200ms", "--rise-y": "10px" } as React.CSSProperties}>
          {description}
        </p>
      </div>
      {action && <div className="ds-rise" style={{ "--d": "320ms", "--rise-y": "10px" } as React.CSSProperties}>{action}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h2 className="ds-h2">{title}</h2>
      {description && <p className="ds-small mt-1">{description}</p>}
    </div>
  );
}
