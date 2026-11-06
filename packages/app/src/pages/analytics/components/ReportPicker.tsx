import { useRef, type KeyboardEvent } from 'react';
import { useLingui } from '@lingui/react/macro';
import { cn } from '@shared/lib/utils';
import type { ReportKey } from '../analytics-state';
import { REPORT_ORDER, REPORT_PANEL_ID, reportMeta, reportTabId } from '../report-questions';

/**
 * The report picker is a tab strip of questions ("Where does my money go?")
 * with the short report name underneath. Arrow keys / Home / End move
 * between tabs (automatic activation), per the WAI-ARIA tabs pattern.
 */
export function ReportPicker({
  value,
  onChange,
}: {
  value: ReportKey;
  onChange: (key: ReportKey) => void;
}) {
  const { t } = useLingui();
  const tabRefs = useRef(new Map<ReportKey, HTMLButtonElement>());

  const focusTab = (key: ReportKey) => {
    onChange(key);
    tabRefs.current.get(key)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = REPORT_ORDER.indexOf(value);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % REPORT_ORDER.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + REPORT_ORDER.length) % REPORT_ORDER.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = REPORT_ORDER.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    focusTab(REPORT_ORDER[next]);
  };

  return (
    <div
      role="tablist"
      aria-label={t`Reports`}
      aria-orientation="horizontal"
      className="-mx-1 flex snap-x gap-1 overflow-x-auto border-b border-border px-1"
    >
      {REPORT_ORDER.map((key) => {
        const { label, question } = reportMeta(key);
        const selected = key === value;
        return (
          <button
            key={key}
            ref={(element) => {
              if (element) tabRefs.current.set(key, element);
              else tabRefs.current.delete(key);
            }}
            id={reportTabId(key)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={REPORT_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={onKeyDown}
            className={cn(
              'relative flex w-40 shrink-0 snap-start flex-col items-start gap-0.5 rounded-t-md px-3 pb-2.5 pt-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:w-auto lg:min-w-0 lg:flex-1',
              selected
                ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <span className={cn('text-sm leading-snug', selected && 'font-semibold')}>
              {question}
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
