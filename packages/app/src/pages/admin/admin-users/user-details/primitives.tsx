/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle } from 'lucide-react';

export function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-xl border bg-background/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 text-lg font-semibold leading-tight">{value}</div>
        </div>
        <div className="rounded-lg bg-muted p-2 text-teal-700">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}

export function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

export function SectionError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
      <div className="text-sm">{message}</div>
    </div>
  );
}

export function EmptyState({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-dashed bg-muted/20 text-center text-muted-foreground ${
        compact ? 'p-4 text-sm' : 'p-8 text-sm'
      }`}
    >
      {message}
    </div>
  );
}

export function formatOptionalDate(value: string | undefined, pattern: string) {
  if (!value) return 'Never';
  return formatDate(value, pattern);
}

export function formatDate(value: string, pattern: string) {
  return format(parseISO(value), pattern);
}
