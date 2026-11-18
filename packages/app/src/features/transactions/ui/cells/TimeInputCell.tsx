import { useLingui } from '@lingui/react/macro';
import * as React from 'react';
import { Input } from '@shared/ui/input';
import { cn } from '@shared/lib/utils';

interface TimeInputCellProps {
  /** 'HH:MM', or null/undefined for none. */
  value: string | null | undefined;
  /** Called with 'HH:MM' or '' (cleared), only when the value changed. */
  onCommit: (time: string) => void;
  className?: string;
}

/**
 * An optional time of day for an existing transaction. Saves when the input
 * loses focus or on Enter; Escape puts the stored value back.
 */
export function TimeInputCell({ value, onCommit, className }: TimeInputCellProps) {
  const { t } = useLingui();
  const stored = value ?? '';
  const [draft, setDraft] = React.useState(stored);

  React.useEffect(() => setDraft(stored), [stored]);

  const commit = () => {
    if (draft !== stored) onCommit(draft);
  };

  return (
    <Input
      type="time"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(stored);
        }
      }}
      aria-label={t`Time (optional)`}
      title={t`Time (optional)`}
      className={cn('h-9 w-28 shrink-0', className)}
    />
  );
}
