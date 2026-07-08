import type { ReactNode } from 'react';

const DefaultChartIcon = (
  <svg
    className="h-8 w-8 text-muted-foreground"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
    />
  </svg>
);

interface ChartEmptyStateProps {
  /** Bold primary line. Defaults to "No spending data". */
  message?: string;
  /** Optional muted secondary line below the message. */
  hint?: ReactNode;
  /** Icon node rendered inside the muted circle. Defaults to a bar-chart glyph. */
  icon?: ReactNode;
  /** Wrapper height/layout override. Defaults to a 300px-tall centered block. */
  className?: string;
}

/**
 * Centered empty-state placeholder for analytics charts: a muted circular icon,
 * a bold message, and an optional hint. Shared by the spending donut, overview,
 * and breakdown reports so they render identically.
 */
export function ChartEmptyState({
  message = 'No spending data',
  hint,
  icon = DefaultChartIcon,
  className = 'flex h-[300px] flex-col items-center justify-center space-y-3',
}: ChartEmptyStateProps) {
  return (
    <div className={className}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">{icon}</div>
      <div className="text-center">
        <p className="text-lg font-medium text-muted-foreground">{message}</p>
        {hint ? <p className="text-sm text-muted-foreground/70">{hint}</p> : null}
      </div>
    </div>
  );
}
