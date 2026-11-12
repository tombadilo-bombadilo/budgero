import { cn } from '@shared/lib/utils';

/** Duplicate-check status of an import row (core duplicate planner). */
export type ImportRowStatus = 'new' | 'already-imported' | 'needs-review' | 'invalid';

const STATUS_CLASS: Record<ImportRowStatus, string> = {
  new: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'already-imported': 'bg-muted text-muted-foreground',
  'needs-review': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  invalid: 'bg-destructive/10 text-destructive',
};

/** Pill classes for an import row status, shared by the review step and the Imports guide. */
export function importStatusChipClass(status: ImportRowStatus): string {
  return cn('inline-flex items-center rounded-full px-2 py-0.5', STATUS_CLASS[status]);
}
