import type { ComponentType, ReactNode } from 'react';
import { Card } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { cn } from '@shared/lib/utils';

export interface ModeOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export function ModeToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ModeOption<T>[];
  ariaLabel: string;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      className="flex-wrap justify-end"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="gap-1.5 px-3">
          {option.icon ? <option.icon className="h-3.5 w-3.5" /> : null}
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

interface ReportShellProps {
  title: string;
  hero: ReactNode;
  heroClassName?: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  insights?: ReactNode;
  legend?: ReactNode;
  chart: ReactNode;
  panel: ReactNode;
  isLoading: boolean;
  isEmpty: boolean;
  emptyText: string;
}

/**
 * Shared report layout: chart area with a hero figure on the left, summary
 * panel (stat tiles + lists — the always-available exact-value channel) on
 * the right.
 */
export function ReportShell({
  title,
  hero,
  heroClassName,
  subtitle,
  controls,
  insights,
  legend,
  chart,
  panel,
  isLoading,
  isEmpty,
  emptyText,
}: ReportShellProps) {
  return (
    <Card className="overflow-hidden border-dashed p-0">
      <div className="flex flex-col lg:flex-row">
        <div className="min-w-0 flex-1 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-muted-foreground">{title}</h2>
              {isLoading ? (
                <Skeleton className="mt-1 h-9 w-40" />
              ) : (
                <p className={cn('text-3xl font-semibold tracking-tight', heroClassName)}>{hero}</p>
              )}
              {subtitle ? (
                <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">{controls}</div>
          </div>
          {insights}
          {legend ? <div className="mt-3">{legend}</div> : null}
          <div className="mt-4">
            {isLoading ? (
              <Skeleton className="h-[380px] w-full" />
            ) : isEmpty ? (
              <div className="flex h-[380px] items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              chart
            )}
          </div>
        </div>
        <aside className="shrink-0 border-t border-dashed border-border/60 p-5 lg:w-[360px] lg:border-l lg:border-t-0 xl:w-[420px]">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            panel
          )}
        </aside>
      </div>
    </Card>
  );
}
