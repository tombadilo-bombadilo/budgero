import { cn } from '@shared/lib/utils';

/** Inline legend chip row shown above charts with 2–4 fixed series. */
export function LegendChips({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Budgero-voiced findings under the answer: short computed sentences with a
 * tone dot. Renders nothing when there is nothing worth saying.
 */
export function InsightStrip({
  insights,
}: {
  insights: { tone: 'good' | 'warn' | 'neutral'; text: string }[];
}) {
  if (insights.length === 0) return null;
  const toneClass = {
    good: 'bg-green-500',
    warn: 'bg-red-500',
    neutral: 'bg-muted-foreground',
  } as const;
  return (
    <ul className="max-w-3xl space-y-1 border-l-2 border-border pl-3">
      {insights.map((insight) => (
        <li key={insight.text} className="flex items-baseline gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full',
              toneClass[insight.tone]
            )}
            aria-hidden
          />
          {insight.text}
        </li>
      ))}
    </ul>
  );
}
