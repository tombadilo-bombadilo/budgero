import { useMemo } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@shared/ui/sheet';
import { ScrollArea } from '@shared/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import { Badge } from '@shared/ui/badge';
import { Separator } from '@shared/ui/separator';
import { Skeleton } from '@shared/ui/skeleton';
import { Button } from '@shared/ui/button';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { useRuleRunChanges, useRuleRuns } from '@entities/rule/api/useRules';
import type {
  TransactionRule,
  TransactionRuleRun,
  TransactionRuleRunChange,
} from '@budgero/core/browser';
import { formatDistanceToNow } from 'date-fns';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { Loader2, RotateCcw } from 'lucide-react';

/** Rule-run change log stores amounts in milliunits; render decimals. */
function displayAmount(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(toDecimal(roundMilli(num))) : String(value ?? '');
}

interface RuleHistoryDrawerProps {
  rule: TransactionRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUndoRun: (params: { runId: number; ruleId: number; budgetId: number }) => Promise<void>;
  undoingRunId: number | null;
}

export function RuleHistoryDrawer({
  rule,
  open,
  onOpenChange,
  onUndoRun,
  undoingRunId,
}: RuleHistoryDrawerProps) {
  const ruleId = rule?.id ?? 0;
  const { data: runs = [], isLoading } = useRuleRuns(ruleId, 25, open);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle>Run history</SheetTitle>
          <SheetDescription>
            {rule ? (
              <span className="text-sm text-muted-foreground">
                {rule.name} •{' '}
                {{ continuous: 'Continuous', one_time: 'One time', autofill: 'Autofill' }[
                  rule.mode
                ] ?? 'Continuous'}{' '}
                rule
              </span>
            ) : (
              'Automation run details'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 h-full flex flex-col">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No runs recorded yet. Trigger this rule to see execution details.
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-200px)] pr-4">
              <Accordion type="multiple" className="space-y-3">
                {runs.map((run, index) => (
                  <RunAccordionItem
                    key={run.id}
                    run={run}
                    isLatest={index === 0}
                    ruleId={rule?.id ?? run.ruleId}
                    budgetId={rule?.budgetId ?? 0}
                    onUndoRun={onUndoRun}
                    undoingRunId={undoingRunId}
                  />
                ))}
              </Accordion>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RunAccordionItem({
  run,
  isLatest,
  ruleId,
  budgetId,
  onUndoRun,
  undoingRunId,
}: {
  run: TransactionRuleRun;
  isLatest: boolean;
  ruleId: number;
  budgetId: number;
  onUndoRun: (params: { runId: number; ruleId: number; budgetId: number }) => Promise<void>;
  undoingRunId: number | null;
}) {
  const statusVariant = getStatusVariant(run.status);
  const { data: changes = [], isLoading } = useRuleRunChanges(run.id, true);

  const header = useMemo(() => {
    const completedDate = parseUtcDate(run.completedAt);
    const relative = completedDate
      ? formatDistanceToNow(completedDate, { addSuffix: true })
      : 'in progress';
    return `${run.status.toUpperCase()} • ${run.transactionCount} transaction${run.transactionCount === 1 ? '' : 's'} • ${relative}`;
  }, [run.completedAt, run.status, run.transactionCount]);

  const canUndo =
    isLatest &&
    budgetId > 0 &&
    (run.status === 'completed' || run.status === 'partial') &&
    run.transactionCount > 0;

  const isUndoing = undoingRunId === run.id;

  const handleUndo = async () => {
    await onUndoRun({ runId: run.id, ruleId, budgetId });
  };

  return (
    <AccordionItem value={String(run.id)} className="rounded-lg border bg-card/30">
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 text-left">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant}>{run.status}</Badge>
              <Badge variant="outline">{run.trigger}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{header}</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {(() => {
              const startedDate = parseUtcDate(run.startedAt);
              return startedDate
                ? `Started ${formatDistanceToNow(startedDate, { addSuffix: true })}`
                : 'Started —';
            })()}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {run.notes ? <p className="mb-3 text-sm text-muted-foreground">{run.notes}</p> : null}
        {run.status === 'undone' ? (
          <div className="mb-3 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
            This run has been undone. Transactions were restored to their prior values.
          </div>
        ) : null}
        {canUndo ? (
          <div className="mb-3 flex flex-col gap-3 rounded-md border border-dashed bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Restore {run.transactionCount} transaction{run.transactionCount === 1 ? '' : 's'} to
              their pre-run values.
            </div>
            <ConfirmDialog
              trigger={
                <Button size="sm" disabled={!canUndo || isUndoing}>
                  {isUndoing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Undo changes
                </Button>
              }
              title="Undo this rule run?"
              description="Budgero will revert every transaction touched by this run back to its original values. You can re-run the rule afterward if needed."
              confirmText={
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Undo run
                </>
              }
              confirmDisabled={isUndoing}
              onConfirm={() => {
                void handleUndo();
              }}
            />
          </div>
        ) : null}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-14 w-full" />
            ))}
          </div>
        ) : changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded changes for this run.</p>
        ) : (
          <div className="space-y-3">
            {changes.map((change) => (
              <RuleChangeRow key={change.id} change={change} />
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function RuleChangeRow({ change }: { change: TransactionRuleRunChange }) {
  const metadata = (change.metadata ?? {}) as Record<string, unknown>;
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">tx #{change.transactionId}</Badge>
        <Badge variant="outline" className="capitalize">
          {change.field || change.actionType}
        </Badge>
        <span className="text-muted-foreground">{change.actionType.replace('.', ' ')}</span>
      </div>
      <Separator className="my-2" />
      <div className="space-y-1 text-xs text-muted-foreground">
        {change.field === 'memo' ? (
          <div>
            <span className="font-medium text-foreground">Memo:</span>{' '}
            <DiffText
              before={metadata.oldMemo ?? change.oldValue}
              after={metadata.newMemo ?? change.newValue}
            />
          </div>
        ) : null}
        {change.field === 'categoryId' ? (
          <div>
            <span className="font-medium text-foreground">Category:</span>{' '}
            {String(metadata.previousCategoryId ?? change.oldValue ?? '')} →{' '}
            {String(metadata.nextCategoryId ?? change.newValue ?? '')}
          </div>
        ) : null}
        {change.field === 'accountId' ? (
          <div>
            <span className="font-medium text-foreground">Account:</span>{' '}
            {String(metadata.previousAccountId ?? change.oldValue ?? '')} →{' '}
            {String(metadata.nextAccountId ?? change.newValue ?? '')}
          </div>
        ) : null}
        {change.field === 'payee' ? (
          <div>
            <span className="font-medium text-foreground">Payee:</span>{' '}
            <DiffText
              before={metadata.previousPayee ?? change.oldValue}
              after={metadata.nextPayee ?? change.newValue}
            />
          </div>
        ) : null}
        {change.field === 'amount' ? (
          <div>
            <span className="font-medium text-foreground">Amount:</span>{' '}
            {displayAmount(metadata.oldAmount ?? change.oldValue)} →{' '}
            {displayAmount(metadata.newAmount ?? change.newValue)}
          </div>
        ) : null}
        {!change.field ? <div className="text-muted-foreground">Action completed.</div> : null}
      </div>
    </div>
  );
}

function DiffText({ before, after }: { before?: unknown; after?: unknown }) {
  const beforeText = (before ?? '').toString();
  const afterText = (after ?? '').toString();

  if (!beforeText && !afterText) {
    return <span className="text-muted-foreground">(cleared)</span>;
  }

  if (beforeText === afterText) {
    return <span className="text-foreground">{afterText}</span>;
  }

  return (
    <span>
      <span className="line-through text-destructive/80">{beforeText || '—'}</span>{' '}
      <span className="text-foreground">→ {afterText || '—'}</span>
    </span>
  );
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'partial':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'undone':
      return 'outline';
    default:
      return 'outline';
  }
}
function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  try {
    let normalized = value.trim();
    if (!normalized.includes('T')) {
      normalized = normalized.replace(' ', 'T');
    }
    const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
    if (!hasTimezone) {
      normalized = `${normalized}Z`;
    }
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
