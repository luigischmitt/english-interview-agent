/**
 * Page heading, in the landing's reading order: kicker, serif title, one supporting sentence, then (optionally) one action.
 * No entrance animation: the text is simply there.
 */
export function PageIntro({
  kicker,
  kickerTone,
  title,
  description,
  action,
}: {
  kicker?: string;
  /** "voice" turns the kicker square terra (voice/acoustics screens). */
  kickerTone?: "voice";
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid min-w-0 max-w-2xl gap-3">
        {kicker && <p className="ds-kicker" data-tone={kickerTone}>{kicker}</p>}
        <h1 className="ds-title">{title}</h1>
        <p className="ds-lead">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
