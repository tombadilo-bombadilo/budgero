import { currencyDisplayFor } from '@shared/lib/number-format';
import * as React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type {
  YNABImportProgressUpdate,
  YNABImportStage,
  YNABImportSummary,
  YNABReadyToAssignCategoryCause,
  YNABReadyToAssignMismatch,
  YNABReconciliationReport,
} from '@budgero/core/browser';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Progress } from '@shared/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';

interface YnabImportStatusProps {
  sourceMode: 'api' | 'zip';
  updates: YNABImportProgressUpdate[];
  error: string | null;
  summary: YNABImportSummary | null;
  verification: YNABReconciliationReport | null;
  currency: string;
  isFinalizing: boolean;
  onBack: () => void;
  onContinue: () => void;
  onAcceptWarnings: () => void;
  onCancelPending: () => void;
}

interface ImportStep {
  stage: YNABImportStage;
  label: string;
}

type StepStatus = 'pending' | 'running' | 'passed' | 'warning' | 'failed';

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />;
  }
  if (status === 'passed') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />;
  }
  if (status === 'warning') {
    return <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />;
  }
  if (status === 'failed') {
    return <XCircle className="h-4 w-4 text-destructive" aria-hidden />;
  }
  return <Circle className="h-4 w-4 text-muted-foreground/50" aria-hidden />;
}

function formatMilli(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: currencyDisplayFor(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(amount / 1000);
  } catch {
    return `${(amount / 1000).toFixed(3)} ${currency}`;
  }
}

function causeKey(cause: YNABReadyToAssignCategoryCause): string {
  return `${cause.categoryGroup}::${cause.category}::${cause.month}::${cause.reason}`;
}

function ReadyToAssignMismatchesTable({
  mismatches,
  currency,
}: {
  mismatches: YNABReadyToAssignMismatch[];
  currency: string;
}) {
  const { t } = useLingui();
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = React.useState({
    overflows: false,
    atStart: true,
    atEnd: true,
  });

  const updateScrollState = React.useCallback(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setScrollState({
      overflows: maxScroll > 1,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= maxScroll - 1,
    });
  }, []);

  React.useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      observer?.disconnect();
    };
  }, [updateScrollState]);

  const scrollByColumns = (direction: -1 | 1) => {
    tableContainerRef.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });
  };

  const reasonLabel = (cause: YNABReadyToAssignCategoryCause) =>
    cause.reason === 'cash_overspend'
      ? t`cash overspend in ${cause.month}`
      : t`assignment difference in ${cause.month}`;

  // The same origin cause is repeated on every later mismatched month.
  const possibleCauses = new Map<string, YNABReadyToAssignCategoryCause>();
  for (const mismatch of mismatches) {
    for (const cause of mismatch.affectedCategories ?? []) {
      const key = causeKey(cause);
      if (!possibleCauses.has(key)) possibleCauses.set(key, cause);
    }
  }
  const sortedCauses = [...possibleCauses.entries()].sort(
    ([, a], [, b]) => a.month.localeCompare(b.month) || Math.abs(b.amount) - Math.abs(a.amount)
  );

  const headClass = 'h-8 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide';

  return (
    <div className="space-y-2">
      {sortedCauses.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-background/90 p-2.5 text-xs">
          <p className="font-semibold text-foreground">
            <Trans>Possible contributors</Trans>
          </p>
          <p className="text-[11px] text-muted-foreground">
            <Trans>
              Budgero-side amounts that may explain these differences. They are hints for comparing
              with YNAB, not an exact breakdown.
            </Trans>
          </p>
          <div className="grid grid-cols-1 gap-1.5 pt-0.5 sm:grid-cols-2">
            {sortedCauses.map(([key, cause]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-[11px]"
              >
                <span className="min-w-0 truncate font-medium">
                  {cause.categoryGroup} › {cause.category}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                    {formatMilli(cause.amount, currency)}
                  </span>{' '}
                  <span className="text-[10px] text-muted-foreground">({reasonLabel(cause)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scrollState.overflows && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            <Trans>Scroll horizontally to view all columns</Trans>
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => scrollByColumns(-1)}
              disabled={scrollState.atStart}
              aria-label={t`Scroll left`}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => scrollByColumns(1)}
              disabled={scrollState.atEnd}
              aria-label={t`Scroll right`}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="w-full overflow-hidden rounded-md border bg-background/80 shadow-2xs">
        <Table
          containerRef={tableContainerRef}
          containerClassName="max-h-80 overflow-x-auto overflow-y-auto [scrollbar-width:auto] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/55 [&::-webkit-scrollbar-track]:bg-muted/40"
          className="min-w-[1120px] text-xs"
        >
          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-xs">
            <TableRow>
              <TableHead className={headClass}>
                <Trans>Month</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>Difference</Trans>
              </TableHead>
              <TableHead className={headClass}>
                <Trans>Possible contributors</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>YNAB value</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>Budgero value</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>Income</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>Assigned</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>Off-budget</Trans>
              </TableHead>
              <TableHead className={`${headClass} text-right`}>
                <Trans>Prior cash overspend</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mismatches.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="whitespace-nowrap py-1.5 font-medium">{m.month}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono font-medium text-amber-700 dark:text-amber-400">
                  {formatMilli(m.difference, currency)}
                </TableCell>
                <TableCell className="min-w-[220px] py-1.5">
                  {m.affectedCategories && m.affectedCategories.length > 0 ? (
                    <div className="space-y-1">
                      {m.affectedCategories.map((cause) => (
                        <div key={causeKey(cause)} className="text-[11px] leading-tight">
                          <span className="font-medium">
                            {cause.categoryGroup} › {cause.category}
                          </span>
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                              {formatMilli(cause.amount, currency)}
                            </span>{' '}
                            ({reasonLabel(cause)})
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <span className="text-muted-foreground" aria-hidden>
                        —
                      </span>
                      <span className="sr-only">
                        <Trans>Not attributed</Trans>
                      </span>
                    </>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono">
                  {formatMilli(m.expectedReadyToAssign, currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono">
                  {formatMilli(m.computedReadyToAssign, currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono">
                  {formatMilli(m.breakdown.income, currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono">
                  {formatMilli(m.breakdown.assignments, currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono">
                  {formatMilli(m.breakdown.offBudgetTransfers, currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right font-mono">
                  {formatMilli(m.breakdown.priorCashOverspend, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function YnabImportStatus({
  sourceMode,
  updates,
  error,
  summary,
  verification,
  currency,
  isFinalizing,
  onBack,
  onContinue,
  onAcceptWarnings,
  onCancelPending,
}: YnabImportStatusProps) {
  const { t } = useLingui();

  const verificationSteps: ImportStep[] = [
    { stage: 'account-verification', label: t`Verify account balances` },
    { stage: 'category-verification', label: t`Verify category history` },
    { stage: 'rta-verification', label: t`Verify Ready to Assign by month` },
  ];

  const baseSteps: ImportStep[] = [
    { stage: 'source-verification', label: t`Verify YNAB source data` },
    { stage: 'preparing', label: 'Create the Budgero budget' },
    { stage: 'categories', label: t`Import categories` },
    { stage: 'accounts', label: t`Import accounts` },
    { stage: 'assignments', label: t`Import assignments` },
    { stage: 'transactions', label: t`Import transactions and splits` },
  ];

  const steps = [
    ...baseSteps.filter((step) => sourceMode === 'api' || step.stage !== 'source-verification'),
    ...(sourceMode === 'api' ? verificationSteps : []),
    { stage: 'complete' as const, label: t`Save imported budget` },
  ];
  const latestByStage = new Map<YNABImportStage, YNABImportProgressUpdate>();
  for (const update of updates) latestByStage.set(update.stage, update);
  const lastUpdate = updates.at(-1);
  const hasWarning = verification?.status === 'warning';
  const isSaved = latestByStage.get('complete')?.status === 'passed';
  const isPendingReview = Boolean(summary && hasWarning && !isSaved && !error);
  const progress = isSaved ? 100 : (lastUpdate?.progress ?? 0);

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">
          {isPendingReview
            ? t`Review YNAB differences`
            : isSaved
              ? hasWarning
                ? t`YNAB import saved with warnings`
                : t`YNAB import verified`
              : error
                ? t`YNAB import stopped`
                : t`Importing from YNAB`}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isPendingReview
            ? t`Source rows and account balances reconcile. Review the reporting differences before deciding whether to keep this budget.`
            : isSaved
              ? hasWarning
                ? t`You accepted the differences below. Import History keeps a summary of them.`
                : t`Budgero finished the import and passed every available integrity check.`
              : error
                ? t`Review the failed check below before trying again.`
                : t`You can follow each import and verification stage here.`}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{lastUpdate?.label ?? t`Waiting to start`}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <ol className="divide-y rounded-md border bg-muted/15 px-3">
        {steps.map((step) => {
          const update = latestByStage.get(step.stage);
          const failed = Boolean(error && lastUpdate?.stage === step.stage);
          const status: StepStatus = failed
            ? 'failed'
            : update?.status === 'running'
              ? 'running'
              : update?.status === 'warning'
                ? 'warning'
                : update?.status === 'passed'
                  ? 'passed'
                  : 'pending';

          return (
            <li key={step.stage} className="flex items-start gap-2.5 py-2.5">
              <span className="mt-0.5">
                <StepIcon status={status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium">{step.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {status}
                  </span>
                </div>
                {update?.detail && (
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                    {update.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>
            <Trans>Integrity check failed</Trans>
          </AlertTitle>
          <AlertDescription className="break-words text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {verification && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border bg-emerald-50/70 p-3 dark:bg-emerald-950/20">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <Trans>Source</Trans>
            </p>
            <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <Trans>{verification.source.registerRows.toLocaleString()} rows exact</Trans>
            </p>
          </div>
          <div className="rounded-md border bg-emerald-50/70 p-3 dark:bg-emerald-950/20">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <Trans>Accounts</Trans>
            </p>
            <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <Trans>
                {verification.accounts.matched} of {verification.accounts.checked} exact
              </Trans>
            </p>
          </div>
          <div
            className={`rounded-md border p-3 ${
              verification.categories.matched === verification.categories.checked
                ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                : 'bg-amber-50/70 dark:bg-amber-950/20'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <Trans>Categories</Trans>
            </p>
            <p className="mt-1 text-sm font-semibold">
              <Trans>
                {verification.categories.matched} of {verification.categories.checked} values exact
              </Trans>
            </p>
          </div>
          <div
            className={`rounded-md border p-3 ${
              verification.readyToAssign.matched === verification.readyToAssign.checked
                ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                : 'bg-amber-50/70 dark:bg-amber-950/20'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <Trans>Ready to Assign</Trans>
            </p>
            <p className="mt-1 text-sm font-semibold">
              <Trans>
                {verification.readyToAssign.matched} of {verification.readyToAssign.checked} months
                exact
              </Trans>
            </p>
          </div>
        </div>
      )}

      {verification && verification.accounts.debtBalanceAdjustments.length > 0 && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>
            <Trans>YNAB-managed debt interest preserved</Trans>
          </AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            <p>
              <Trans>
                YNAB applies loan interest to balances without exporting a separate transaction.
                Budgero added visible ledger adjustments so these balances remain exact.
              </Trans>
            </p>
            {verification.accounts.debtBalanceAdjustments.map((adjustment) => (
              <p key={`${adjustment.accountName}-${adjustment.date}`}>
                <Trans>
                  {adjustment.accountName}: {formatMilli(adjustment.amount, currency)} on{' '}
                  {adjustment.date}
                </Trans>
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {verification && verification.readyToAssign.mismatches.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <div>
            <p className="text-xs font-semibold">
              <Trans>Ready to Assign differences</Trans>
            </p>
            <p className="text-[11px] text-muted-foreground">
              <Trans>Budgero did not alter the ledger to force these values to match.</Trans>
            </p>
          </div>
          <ReadyToAssignMismatchesTable
            mismatches={verification.readyToAssign.mismatches}
            currency={currency}
          />
        </div>
      )}

      {verification && verification.categories.mismatches.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <p className="text-xs font-semibold">
            <Trans>Category-history differences</Trans>
          </p>
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {verification.categories.mismatches.slice(0, 20).map((mismatch, index) => (
              <div
                key={`${mismatch.month}-${mismatch.categoryGroup}-${mismatch.category}-${mismatch.field}-${index}`}
                className="grid grid-cols-[1fr_auto] gap-2 rounded border bg-background/80 p-2 text-[11px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {mismatch.categoryGroup} › {mismatch.category}
                  </p>
                  <p className="text-muted-foreground">
                    <Trans>
                      {mismatch.month} · {mismatch.field} · YNAB{' '}
                      {formatMilli(mismatch.expectedAmount, currency)} · Budgero{' '}
                      {formatMilli(mismatch.computedAmount, currency)}
                    </Trans>
                  </p>
                </div>
                <span className="text-amber-700 dark:text-amber-400">
                  Δ {formatMilli(mismatch.difference, currency)}
                </span>
              </div>
            ))}
          </div>
          {verification.categories.checked - verification.categories.matched > 20 && (
            <p className="text-[11px] text-muted-foreground">
              <Trans>
                Showing 20 of {verification.categories.checked - verification.categories.matched}{' '}
                differences.
              </Trans>
            </p>
          )}
        </div>
      )}

      {error && (
        <Button type="button" variant="outline" className="w-full" onClick={onBack}>
          <Trans>
            <RotateCcw className="h-4 w-4" />
            Back to import
          </Trans>
        </Button>
      )}

      {isPendingReview && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" disabled={isFinalizing} onClick={onCancelPending}>
            <Trans>
              <Trash2 className="h-4 w-4" />
              Cancel and remove
            </Trans>
          </Button>
          <Button type="button" disabled={isFinalizing} onClick={onAcceptWarnings}>
            <Trans>
              {isFinalizing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              Import anyway
            </Trans>
          </Button>
        </div>
      )}

      {summary && !isPendingReview && isSaved && (
        <Button type="button" className="w-full" onClick={onContinue}>
          <Trans>
            <CheckCircle2 className="h-4 w-4" />
            Open imported budget
          </Trans>
        </Button>
      )}
    </div>
  );
}
