/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';

export type ImportStatus = 'new' | 'already-imported' | 'needs-review' | 'invalid';

const STATUS_CLASSES: Record<ImportStatus, string> = {
  new: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'already-imported': 'bg-muted text-muted-foreground',
  'needs-review': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  invalid: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

/** Colour classes (pill shape included) for an import row status. */
export function importStatusChipClass(status: ImportStatus): string {
  return cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_CLASSES[status]);
}

export function ImportStatusChip({
  status,
  children,
  className,
}: {
  status: ImportStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-status={status}
      className={cn('inline-flex w-fit items-center', importStatusChipClass(status), className)}
    >
      {children}
    </span>
  );
}
