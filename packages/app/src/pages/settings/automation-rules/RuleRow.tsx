import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type ReactNode } from 'react';
import type { RuleTrigger, TransactionRule } from '@budgero/core/browser';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Switch } from '@shared/ui/switch';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { RuleSummary } from '@features/rules/ui/RuleSummary';
import { formatRelativeToNow as formatDistanceToNow } from '@shared/lib/date-format';
import { cn } from '@shared/lib/utils';
import {
  ChevronRight,
  Clock,
  History,
  Layers2,
  Loader2,
  Pencil,
  Play,
  Rocket,
  ShieldOff,
  Trash2,
} from 'lucide-react';

interface RuleRowProps {
  rule: TransactionRule;
  categoryNames: Map<number, string>;
  accountNames: Map<number, string>;
  runningTrigger: RuleTrigger | null;
  runDisabled: boolean;
  isTogglePending: boolean;
  isDeletePending: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onRun: (trigger: RuleTrigger) => void;
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function IconAction({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
}

export function RuleRow({
  rule,
  categoryNames,
  accountNames,
  runningTrigger,
  runDisabled,
  isTogglePending,
  isDeletePending,
  onToggleEnabled,
  onRun,
  onHistory,
  onEdit,
  onDelete,
}: RuleRowProps) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);

  const lastRunLabel = rule.lastRunAt
    ? formatDistanceToNow(new Date(rule.lastRunAt), { addSuffix: true })
    : t`Never`;
  const isOneTimeConsumed = rule.mode === 'one_time' && rule.oneTimeConsumed;
  const modeLabel =
    rule.mode === 'one_time' ? t`One time` : rule.mode === 'autofill' ? t`Autofill` : t`Continuous`;
  const conditionCount = rule.conditions.length;
  const actionCount = rule.actions.length;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="flex items-start gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mt-px size-6 shrink-0 text-muted-foreground"
            aria-label={expanded ? t`Hide details` : t`Show details`}
          >
            <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
          </Button>
        </CollapsibleTrigger>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <div className={cn('min-w-0 flex-1 space-y-0.5', !rule.enabled && 'opacity-60')}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{rule.name}</span>
              <Badge
                variant={rule.mode === 'one_time' ? 'secondary' : 'outline'}
                className="px-1.5 py-0 text-[0.625rem]"
              >
                {modeLabel}
              </Badge>
              {rule.description ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {rule.description}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Trans>
                  <Layers2 className="h-3 w-3" />
                  Run order {rule.runOrder}
                </Trans>
              </span>
              <span className="flex items-center gap-1">
                <Trans>
                  <Clock className="h-3 w-3" />
                  Last run {lastRunLabel}
                </Trans>
              </span>
              <span>
                <Trans>
                  {conditionCount} condition(s) · {actionCount} action(s)
                </Trans>
              </span>
              {isOneTimeConsumed ? (
                <span className="flex items-center gap-1 text-destructive">
                  <Trans>
                    <ShieldOff className="h-3 w-3" />
                    Consumed after retro run
                  </Trans>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-end gap-1">
            <IconAction label={t`Run now`} onClick={() => onRun('manual')} disabled={runDisabled}>
              {runningTrigger === 'manual' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
            </IconAction>
            <ConfirmDialog
              trigger={
                <IconAction label={t`Retro run`} disabled={isOneTimeConsumed || runDisabled}>
                  {runningTrigger === 'retroactive' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Rocket className="size-3.5" />
                  )}
                </IconAction>
              }
              title={t`Run this rule on past transactions?`}
              description={t`Budgero will evaluate every transaction in this budget and apply any matching actions. This may take a moment for larger budgets.`}
              confirmText={t`Confirm retro run`}
              confirmDisabled={runDisabled}
              onConfirm={() => onRun('retroactive')}
            />
            <IconAction label={t`History`} onClick={onHistory}>
              <History className="size-3.5" />
            </IconAction>
            <IconAction label={t`Edit`} onClick={onEdit}>
              <Pencil className="size-3.5" />
            </IconAction>
            <ConfirmDialog
              trigger={
                <IconAction label={t`Delete`} className="text-destructive hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </IconAction>
              }
              title={<Trans>Delete “{rule.name}”?</Trans>}
              description={t`This rule and its history will be removed. Recent runs can still be undone from the global undo menu.`}
              confirmText={t`Delete rule`}
              variant="destructive"
              confirmDisabled={isDeletePending}
              onConfirm={onDelete}
            />
            <Switch
              className="ml-1"
              checked={rule.enabled}
              onCheckedChange={onToggleEnabled}
              disabled={isTogglePending}
              aria-label={rule.enabled ? t`Pause rule` : t`Enable rule`}
            />
          </div>
        </div>
      </div>
      <CollapsibleContent className="border-t bg-muted/30 py-2 pl-11 pr-3">
        <RuleSummary rule={rule} categoryNames={categoryNames} accountNames={accountNames} />
      </CollapsibleContent>
    </Collapsible>
  );
}
