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
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(amount / 1000);
  } catch {
    return `${(amount / 1000).toFixed(3)} ${currency}`;
  }
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

  const scrollLeft = () => {
    tableContainerRef.current?.scrollBy({ left: -320, behavior: 'smooth' });
  };

  const scrollRight = () => {
    tableContainerRef.current?.scrollBy({ left: 320, behavior: 'smooth' });
  };

  // Extract unique root causes across all mismatches
  const rootCausesMap = new Map<string, YNABReadyToAssignCategoryCause>();

  for (const m of mismatches) {
    if (m.affectedCategories) {
      for (const cause of m.affectedCategories) {
        const key = `category::${cause.categoryGroup}::${cause.category}::${cause.month}::${cause.reason}`;
        if (!rootCausesMap.has(key)) {
          rootCausesMap.set(key, cause);
        }
      }
    }
  }

  const rootCauses = [...rootCausesMap.values()].sort((a, b) => {
    const monthA = a.month;
    const monthB = b.month;
    const monthCmp = monthA.localeCompare(monthB);
    if (monthCmp !== 0) return monthCmp;
    return Math.abs(b.amount) - Math.abs(a.amount);
  });

  return (
    <div className="space-y-2">
      {rootCauses.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-background/90 p-2.5 text-xs space-y-1.5">
          <p className="font-semibold text-foreground">
            <Trans>Discrepancy Causes by Origin Month</Trans>
          </p>
          <p className="text-[11px] text-muted-foreground">
            <Trans>
              Ready to Assign differences across months originate from the following discrepancies:
            </Trans>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
            {rootCauses.map((cause, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1 text-[11px]"
              >
                <span className="font-medium truncate mr-2">
                  `${cause.categoryGroup} › ${cause.category}`
                </span>
                <span className="shrink-0 font-mono font-medium text-amber-700 dark:text-amber-400">
                  {formatMilli(cause.amount, currency)}{' '}
                  <span className="text-[10px] text-muted-foreground font-sans font-normal">
                    ({cause.month} ·{' '}
                    {cause.reason === 'cash_overspend' ? 'cash overspend' : 'assigned'})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
          <Trans>Scroll horizontally to view all columns →</Trans>
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={scrollLeft}
            aria-label={t`Scroll left`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={scrollRight}
            aria-label={t`Scroll right`}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-md border bg-background/80 shadow-2xs">
        <Table
          containerRef={tableContainerRef}
          containerClassName="max-h-80 overflow-x-auto overflow-y-auto [scrollbar-width:auto] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/55 [&::-webkit-scrollbar-track]:bg-muted/40"
          className="min-w-[1120px] text-xs"
        >
          <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur-xs z-10">
            <TableRow>
              <TableHead className="h-8 font-semibold whitespace-nowrap">
                <Trans>YEAR-MONTH</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>DIFFERENCE</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold whitespace-nowrap">
                <Trans>CATEGORY</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>YNAB VALUE</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>Budgero VALUE</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>Income</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>Assigned</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>Off-budget</Trans>
              </TableHead>
              <TableHead className="h-8 font-semibold text-right whitespace-nowrap">
                <Trans>Prior cash overspend</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mismatches.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="py-1.5 font-medium whitespace-nowrap">{m.month}</TableCell>
                <TableCell className="py-1.5 text-right font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap font-mono">
                  {formatMilli(m.difference, currency)}
                </TableCell>
                <TableCell className="py-1.5 min-w-[220px]">
                  {m.affectedCategories && m.affectedCategories.length > 0 ? (
                    <div className="space-y-1">
                      {m.affectedCategories.map((cause, idx) => (
                        <div key={idx} className="text-[11px] leading-tight">
                          <span className="font-medium">
                            {cause.categoryGroup} › {cause.category}
                          </span>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            <span
                              className={
                                cause.amount < 0
                                  ? 'text-amber-700 dark:text-amber-400 font-medium'
                                  : 'font-medium'
                              }
                            >
                              {formatMilli(cause.amount, currency)}
                            </span>{' '}
                            <span className="font-sans">
                              (
                              {cause.reason === 'cash_overspend'
                                ? `cash overspend in ${cause.month}`
                                : `assigned diff in ${cause.month}`}
                              )
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No Category (possible Transfer)</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap font-mono">
                  {formatMilli(m.expectedReadyToAssign, currency)}
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap font-mono">
                  {formatMilli(m.computedReadyToAssign, currency)}
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap font-mono">
                  {formatMilli(m.breakdown.income, currency)}
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap font-mono">
                  {formatMilli(m.breakdown.assignments, currency)}
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap font-mono">
                  {formatMilli(m.breakdown.offBudgetTransfers, currency)}
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap font-mono">
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
                ? t`You accepted the differences below. They are saved in Import History for later review.`
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
