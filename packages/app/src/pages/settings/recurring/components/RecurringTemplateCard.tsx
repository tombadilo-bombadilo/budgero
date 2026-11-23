import { plural, t } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import {
  Bell,
  ChevronRight,
  Clock,
  Flag,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@shared/lib/utils';
import type { RecurringTransaction, RecurringOccurrenceWithTemplate } from '@budgero/core/browser';
import { formatDueLabel } from '@shared/lib/date-utils';
import { formatRecurringAmount } from './format-recurring-amount';
import { RecurringKindBadge } from './RecurringKindBadge';
import { RecurringOccurrenceRow } from './RecurringOccurrenceRow';

function frequencyLabelFor(schedule: RecurringTransaction['schedule']): string {
  const key = `${schedule.intervalUnit}:${schedule.intervalCount ?? 1}`;
  switch (key) {
    case 'day:1':
      return t`Daily`;
    case 'week:1':
      return t`Weekly`;
    case 'week:2':
      return t`Every 2 weeks`;
    case 'month:1':
      return t`Monthly`;
    case 'month:2':
      return t`Every 2 months`;
    case 'month:3':
      return t`Quarterly`;
    case 'month:6':
      return t`Every 6 months`;
    case 'year:1':
      return t`Yearly`;
    default:
      return t`Custom cadence`;
  }
}

function endLabelFor(schedule: RecurringTransaction['schedule']): string | null {
  const count = schedule.occurrenceCount ?? null;
  const countLabel = count ? `after ${count} ${count === 1 ? 'occurrence' : 'occurrences'}` : null;
  const dateLabel = schedule.endDate ? `on ${schedule.endDate}` : null;
  if (countLabel && dateLabel) return t`Ends ${countLabel} or ${dateLabel}`;
  if (countLabel) return t`Ends ${countLabel}`;
  if (dateLabel) return t`Ends ${dateLabel}`;
  return null;
}

function reminderLabelFor(daysBefore: number): string {
  if (daysBefore <= 0) return t`Remind on due date`;
  return plural(daysBefore, { one: 'Remind # day before', other: 'Remind # days before' });
}

interface RecurringTemplateCardProps {
  template: RecurringTransaction;
  accountName: string;
  accountCurrency?: string;
  toAccountName?: string;
  categoryName: string | undefined;
  occurrences: RecurringOccurrenceWithTemplate[];
  accountLocalizer: { format: (n: number) => string };
  budgetAmount?: number | null;
  budgetCurrency?: string;
  budgetLocalizer?: { format: (n: number) => string };
  isProcessing: boolean;
  isTogglePending: boolean;
  onToggleActive: (nextActive: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  processingOccurrenceId: number | null;
  isMarkReadyPending: boolean;
  isSkipPending: boolean;
  isOccurrencesFetching: boolean;
  onMarkReady: (occurrence: RecurringOccurrenceWithTemplate, transactionDate?: string) => void;
  onSkip: (occurrence: RecurringOccurrenceWithTemplate) => void;
}

export function RecurringTemplateCard({
  template,
  accountName,
  accountCurrency,
  toAccountName,
  categoryName,
  occurrences,
  accountLocalizer,
  budgetAmount,
  budgetCurrency,
  budgetLocalizer,
  isProcessing,
  isTogglePending,
  onToggleActive,
  onEdit,
  onDelete,
  processingOccurrenceId,
  isMarkReadyPending,
  isSkipPending,
  isOccurrencesFetching,
  onMarkReady,
  onSkip,
}: RecurringTemplateCardProps) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const nextOccurrence = occurrences[0];
  const upcomingCount = occurrences.length;

  const dueLabel = nextOccurrence ? formatDueLabel(nextOccurrence.dueDate) : t`No upcoming dates`;
  const amountDisplay = formatRecurringAmount(template, accountLocalizer);
  const budgetAmountDisplay =
    budgetAmount != null &&
    budgetLocalizer &&
    accountCurrency &&
    budgetCurrency &&
    accountCurrency !== budgetCurrency
      ? `≈ ${formatRecurringAmount(template, budgetLocalizer, budgetAmount)}`
      : null;
  const frequencyLabel = frequencyLabelFor(template.schedule);
  const endLabel = endLabelFor(template.schedule);
  const destination =
    template.toAccountId != null ? (toAccountName ?? t`Unknown account`) : categoryName;
  const toggleLabel = template.active ? t`Pause` : t`Resume`;
  const { startDate } = template.schedule;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="relative">
      <div className={cn('flex items-start gap-2 px-3 py-2', !template.active && 'opacity-60')}>
        <CollapsibleTrigger asChild disabled={!upcomingCount}>
          <Button
            variant="ghost"
            size="icon"
            className="mt-px size-6 shrink-0 text-muted-foreground disabled:opacity-30"
            aria-label={expanded ? t`Hide upcoming` : t`Show upcoming`}
          >
            <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
          </Button>
        </CollapsibleTrigger>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{template.name}</span>
              <RecurringKindBadge template={template} />
              {!template.active && (
                <Badge variant="outline" className="px-1.5 py-0 text-[0.625rem]">
                  <Trans>Paused</Trans>
                </Badge>
              )}
              {template.memo && template.memo !== template.name ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {template.memo}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="start"
                    className="max-w-sm whitespace-pre-wrap break-words text-sm"
                  >
                    {template.memo}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1" title={t`Started ${startDate}`}>
                <RefreshCw className="h-3 w-3" /> {frequencyLabel}
              </span>
              <span className="flex items-center gap-1">
                <Trans>
                  <Clock className="h-3 w-3" />
                  Next due {dueLabel}
                </Trans>
                {upcomingCount > 1 && <span>· {t`${upcomingCount} upcoming`}</span>}
              </span>
              {endLabel && (
                <span className="flex items-center gap-1">
                  <Flag className="h-3 w-3" /> {endLabel}
                </span>
              )}
              <span className="truncate">
                {accountName} → {destination}
              </span>
              <span className="flex items-center gap-1">
                <Bell className="h-3 w-3" /> {reminderLabelFor(template.notifyDaysBefore || 0)}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium tabular-nums">{amountDisplay}</div>
              {budgetAmountDisplay ? (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {budgetAmountDisplay}
                </div>
              ) : null}
            </div>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onToggleActive(!template.active)}
                disabled={isProcessing || isTogglePending}
                title={toggleLabel}
                aria-label={toggleLabel}
              >
                {template.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onEdit}
                disabled={isProcessing}
                title={t`Edit`}
                aria-label={t`Edit`}
              >
                <Pencil className="size-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    disabled={isProcessing}
                    title={t`Delete`}
                    aria-label={t`Delete`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      <Trans>Delete “{template.name}”?</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <Trans>
                        This will remove upcoming reminders. Existing transactions are unaffected.
                      </Trans>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      <Trans>Cancel</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      <Trans>Delete</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
      <CollapsibleContent asChild>
        <ul className="divide-y border-t bg-muted/30">
          {occurrences.map((occurrence) => (
            <RecurringOccurrenceRow
              key={occurrence.id}
              occurrence={occurrence}
              isProcessing={processingOccurrenceId === occurrence.id}
              isMarkReadyPending={isMarkReadyPending}
              isSkipPending={isSkipPending}
              isFetching={isOccurrencesFetching}
              onMarkReady={() => onMarkReady(occurrence)}
              onPostNow={(today) => onMarkReady(occurrence, today)}
              onSkip={() => onSkip(occurrence)}
            />
          ))}
        </ul>
      </CollapsibleContent>
      {isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </Collapsible>
  );
}
