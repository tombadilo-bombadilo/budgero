import type * as React from 'react';
import { cn } from '@shared/lib/utils';
import { importStatusChipClass, type ImportRowStatus } from '@shared/lib/import-status-chip';

export type { ImportRowStatus };

/** An import row status as a coloured pill; the label comes from the caller. */
export function ImportStatusChip({
  status,
  className,
  ...props
}: React.ComponentProps<'span'> & { status: ImportRowStatus }) {
  return <span className={cn(importStatusChipClass(status), className)} {...props} />;
}
