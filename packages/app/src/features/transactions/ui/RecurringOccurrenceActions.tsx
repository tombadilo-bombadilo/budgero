import { useLingui } from '@lingui/react/macro';
import { track } from '@shared/lib/analytics/track';
import { CalendarCheck, Check, Loader2, RefreshCw, SkipForward } from 'lucide-react';
import type React from 'react';
import { toast } from 'sonner';
import {
  useMarkRecurringOccurrenceReady,
  useSkipRecurringOccurrence,
} from '@entities/recurring/api/useRecurringTransactions';
import { getTodayISO } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';

interface RecurringOccurrenceActionsProps {
  occurrenceId: number;
  /** YYYY-MM-DD due date; "Post now" is offered when it isn't today. */
  dueDate?: string;
  /** Button size, e.g. 'h-7 w-7' (desktop table) or 'h-6 w-6' (mobile card). */
  size?: string;
  iconSize?: string;
}

/**
 * Inline "Mark ready" / "Post now" / "Skip this time" actions for a projected
 * recurring occurrence in the register (replaces the separate upcoming panel).
 */
export function RecurringOccurrenceActions({
  occurrenceId,
  dueDate,
  size = 'h-7 w-7',
  iconSize = 'h-4 w-4',
}: RecurringOccurrenceActionsProps) {
  const { t } = useLingui();
  const markReady = useMarkRecurringOccurrenceReady();
  const skip = useSkipRecurringOccurrence();
  const busy = markReady.isPending || skip.isPending;
  const today = getTodayISO();
  const canPostNow = dueDate != null && dueDate.slice(0, 10) !== today;

  const onError = (error: unknown) =>
    toast.error(t`Action failed`, {
      description: getErrorMessage(error, t`Something went wrong.`),
    });

  const post = (transactionDate?: string) =>
    markReady.mutate(
      { occurrenceId, transactionDate },
      {
        onSuccess: (result) => {
          track('recurring_posted', { how: transactionDate ? 'post_now' : 'mark_ready' });
          const { template } = result.occurrence;
          toast.success(t`Transaction posted`, {
            description: t`${template.name} was added to your register.`,
          });
        },
        onError,
      }
    );

  const dueLabel = dueDate?.slice(0, 10);

  return (
    <div className="flex items-center gap-0.5">
      <ActionButton
        label={t`Mark ready`}
        hint={dueLabel ? t`Post it dated ${dueLabel}, its due date` : t`Post it on its due date`}
        className={cn(size, 'text-success hover:bg-success/10 hover:text-success')}
        disabled={busy}
        onClick={() => post()}
      >
        {markReady.isPending && markReady.variables?.transactionDate == null ? (
          <Loader2 className={cn(iconSize, 'animate-spin')} />
        ) : (
          <Check className={iconSize} />
        )}
      </ActionButton>
      {canPostNow && (
        <ActionButton
          label={t`Post now`}
          hint={t`Post it dated today instead of its due date`}
          className={cn(size, 'text-primary hover:bg-primary/10 hover:text-primary')}
          disabled={busy}
          onClick={() => post(today)}
        >
          {markReady.isPending && markReady.variables?.transactionDate != null ? (
            <Loader2 className={cn(iconSize, 'animate-spin')} />
          ) : (
            <CalendarCheck className={iconSize} />
          )}
        </ActionButton>
      )}
      <ActionButton
        label={t`Skip this time`}
        hint={t`Skip this occurrence; the schedule continues`}
        className={cn(size, 'text-muted-foreground hover:text-foreground')}
        disabled={busy}
        onClick={() =>
          skip.mutate(
            { id: occurrenceId },
            {
              onSuccess: () =>
                toast.success(t`Occurrence skipped`, {
                  description: t`We will remind you again next time.`,
                }),
              onError,
            }
          )
        }
      >
        {skip.isPending ? (
          <Loader2 className={cn(iconSize, 'animate-spin')} />
        ) : (
          <SkipForward className={iconSize} />
        )}
      </ActionButton>
    </div>
  );
}

function ActionButton({
  label,
  hint,
  className,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  className: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('rounded-full', className)}
          disabled={disabled}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{label}</p>
        <p className="text-xs opacity-80">{hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Small recurring icon marking a row as projected from, or posted by, a recurring transaction. */
export function RecurringIndicator({ className }: { className?: string }) {
  const { t } = useLingui();
  return (
    <RefreshCw
      className={cn('h-3.5 w-3.5 shrink-0 text-primary', className)}
      aria-label={t`Recurring transaction`}
      role="img"
    />
  );
}
