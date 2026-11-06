import { useId, type ComponentType, type ReactNode } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Skeleton } from '@shared/ui/skeleton';
import { cn } from '@shared/lib/utils';

interface ReportLayoutProps {
  /** The household question this report answers; rendered as the h2. */
  question: string;
  /** One plain-language sentence answering the question, number inline. */
  answer: ReactNode;
  /** Left-aligned row of labelled view switches and selects. */
  toolbar?: ReactNode;
  insights?: ReactNode;
  legend?: ReactNode;
  chart: ReactNode;
  /** Inline key-figures row shown under the chart. */
  figures?: ReactNode;
  /** Full-width sections under the figures (breakdown tables, extra tools). */
  children?: ReactNode;
  isLoading: boolean;
  isEmpty: boolean;
  emptyText: string;
}

/**
 * Question-led report layout, top to bottom in one column: the question,
 * its answer in words, the view toolbar, the chart at full width, a quiet
 * row of key figures, then ledger-style breakdowns.
 */
export function ReportLayout({
  question,
  answer,
  toolbar,
  insights,
  legend,
  chart,
  figures,
  children,
  isLoading,
  isEmpty,
  emptyText,
}: ReportLayoutProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <header className="max-w-3xl space-y-1">
        <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
          {question}
        </h2>
        {isLoading ? (
          <Skeleton className="h-5 w-72 max-w-full" />
        ) : (
          <p className="text-base leading-relaxed text-foreground/85" data-testid="report-answer">
            {answer}
          </p>
        )}
      </header>

      {toolbar ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{toolbar}</div>
      ) : null}

      {insights}

      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        {legend && !isLoading && !isEmpty ? <div className="mb-3">{legend}</div> : null}
        {isLoading ? (
          <Skeleton className="h-[380px] w-full" />
        ) : isEmpty ? (
          <div className="flex h-[300px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          chart
        )}
      </div>

      {figures && !isLoading && !isEmpty ? figures : null}
      {isLoading ? <Skeleton className="h-40 w-full" /> : children}
    </section>
  );
}

export interface ViewOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * Labelled segmented control ("Show: Over time | Share"). Square segments
 * divided by hairlines; the active one is underlined in the primary color.
 */
export function ViewSwitch<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ViewOption<T>[];
}) {
  const labelId = useId();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex flex-wrap divide-x divide-border overflow-hidden rounded-md border border-border bg-card"
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-sm transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active
                  ? 'bg-muted font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {option.icon ? <option.icon className="h-3.5 w-3.5" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Visible label next to a toolbar control (select, input). */
export function ToolbarField({
  label,
  children,
}: {
  label: string;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children(labelId)}
    </div>
  );
}

export interface KeyFigure {
  label: string;
  value: string;
  detail?: ReactNode;
  valueClassName?: string;
}

/** A single quiet row of 2–4 figures, label above value, hairline dividers. */
export function KeyFigures({ items }: { items: KeyFigure[] }) {
  const { t } = useLingui();
  return (
    <dl
      aria-label={t`Key figures`}
      className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-3 sm:flex sm:flex-wrap sm:gap-x-0"
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 sm:min-w-[8rem] sm:border-l sm:border-border sm:px-4 sm:first:border-l-0 sm:first:pl-0"
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              'mt-0.5 text-sm font-semibold tabular-nums sm:text-base',
              item.valueClassName
            )}
          >
            {item.value}
          </dd>
          {item.detail ? <dd className="text-xs text-muted-foreground">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
