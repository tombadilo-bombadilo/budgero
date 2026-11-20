import { useLingui } from '@lingui/react/macro';
import * as React from 'react';
import { TimeInput } from '@shared/ui/time-input';
import { cn } from '@shared/lib/utils';

interface TimeInputCellProps {
  /** 'HH:MM', or null/undefined for none. */
  value: string | null | undefined;
  /** Called with 'HH:MM' or '' (cleared), only when the value changed. */
  onCommit: (time: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** Editing ended (blur, Enter or Escape). */
  onDone?: () => void;
}

/**
 * An optional time of day for an existing transaction. Saves when the input
 * loses focus or on Enter; Escape puts the stored value back.
 */
export function TimeInputCell({
  value,
  onCommit,
  className,
  autoFocus,
  onDone,
}: TimeInputCellProps) {
  const { t } = useLingui();
  const stored = value ?? '';
  const [draft, setDraft] = React.useState(stored);
  const cancelled = React.useRef(false);

  React.useEffect(() => setDraft(stored), [stored]);

  const commit = () => {
    if (!cancelled.current && draft !== stored) onCommit(draft);
    cancelled.current = false;
  };

  return (
    <TimeInput
      value={draft}
      onValueChange={setDraft}
      autoFocus={autoFocus}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        commit();
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (onDone) e.currentTarget.blur();
          else commit();
        } else if (e.key === 'Escape') {
          setDraft(stored);
          if (onDone) {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }
      }}
      aria-label={t`Time (optional)`}
      title={t`Time (optional)`}
      className={cn('h-9 w-28 shrink-0', className)}
    />
  );
}
