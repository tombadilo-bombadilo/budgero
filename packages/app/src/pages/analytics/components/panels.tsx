import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';

/** Small labeled stat card used in the report side panel (2-up grid). */
export function StatTile({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-1 break-words text-lg font-semibold tracking-tight', valueClassName)}>
        {value}
      </div>
      {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

/**
 * Ranked list row with a series swatch, name, exact value, and a proportion
 * meter. Doubles as the chart legend and the "table view" relief channel for
 * low-contrast palette slots, so it must always show exact values.
 */
export function ProportionRow({
  color,
  name,
  value,
  fraction,
}: {
  color: string;
  name: string;
  value: string;
  fraction: number;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
        <span className="whitespace-nowrap text-sm font-medium tabular-nums">{value}</span>
      </div>
      <div className="ml-[18px] mt-1 h-1 rounded-full bg-muted">
        <div
          className="h-1 rounded-full"
          style={{
            width: `${Math.max(2, Math.min(100, fraction * 100))}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

/** Month row for the side panel monthly breakdown lists. */
export function MonthRow({
  label,
  primary,
  secondary,
  primaryClassName,
}: {
  label: string;
  primary: string;
  secondary?: string;
  primaryClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {secondary ? <div className="text-xs text-muted-foreground">{secondary}</div> : null}
      </div>
      <div className={cn('whitespace-nowrap text-sm font-semibold tabular-nums', primaryClassName)}>
        {primary}
      </div>
    </div>
  );
}

export function PanelSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

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
 * Budgero-voiced findings above a chart: short computed sentences with a
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
    <div className="mt-3 space-y-1 rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-2">
      {insights.map((insight) => (
        <p key={insight.text} className="flex items-baseline gap-2 text-sm text-foreground/90">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full',
              toneClass[insight.tone]
            )}
            aria-hidden
          />
          {insight.text}
        </p>
      ))}
    </div>
  );
}
