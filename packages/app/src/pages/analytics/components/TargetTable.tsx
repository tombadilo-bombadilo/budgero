import { Trans, useLingui } from '@lingui/react/macro';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { TargetPill } from '@features/budget-planning/ui/desktop-table/TargetPill';
import { fundedPercent, type TargetReport, type TargetReportRow } from '../target-report';

interface TargetTableProps {
  report: TargetReport;
  money: (milli: number) => string;
  monthCount: number;
  isLoading: boolean;
}

const headClass = 'h-8 text-xs font-medium uppercase tracking-wide text-muted-foreground';
const moneyCell = 'text-right font-mono text-sm tabular-nums';

/**
 * Every category's goal target for the period next to what was assigned and
 * spent, with group subtotals. The target pill fills with how much of the
 * target was funded.
 */
export function TargetTable({ report, money, monthCount, isLoading }: TargetTableProps) {
  const { t } = useLingui();
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const allOpen =
    report.groups.length > 0 && report.groups.every((group) => openGroups.has(group.name));
  const toggleGroup = (name: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const metLabel = (row: TargetReportRow) =>
    row.monthsWithTarget > 0 ? `${row.monthsMet}/${row.monthsWithTarget}` : '';

  return (
    <Card className="overflow-hidden border-dashed p-0" data-testid="target-table">
      <div className="p-5 pb-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-muted-foreground">
            <Trans>Targets</Trans>
          </h2>
          {report.groups.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() =>
                setOpenGroups(
                  allOpen ? new Set() : new Set(report.groups.map((group) => group.name))
                )
              }
            >
              {allOpen ? <Trans>Collapse all</Trans> : <Trans>Expand all</Trans>}
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {monthCount > 1 ? (
            <Trans>
              Each month's goal target added up over the period, against what you assigned and
              spent.
            </Trans>
          ) : (
            <Trans>This month's goal targets against what you assigned and spent.</Trans>
          )}
        </p>
      </div>
      {isLoading ? (
        <div className="space-y-2 px-6 pb-6">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : report.groups.length === 0 ? (
        <div className="px-6 pb-6 text-sm text-muted-foreground">
          <Trans>No categories in this period.</Trans>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead className={cn(headClass, 'pl-6')}>
                  <Trans>Category</Trans>
                </TableHead>
                <TableHead className={cn(headClass, 'w-[140px] text-right')}>
                  <Trans>Assigned</Trans>
                </TableHead>
                <TableHead className={cn(headClass, 'w-[140px] text-right')}>
                  <Trans>Spent</Trans>
                </TableHead>
                {monthCount > 1 ? (
                  <TableHead
                    className={cn(headClass, 'w-[110px] text-right')}
                    title={t`Months the target was fully funded`}
                  >
                    <Trans>Months met</Trans>
                  </TableHead>
                ) : null}
                <TableHead className={cn(headClass, 'w-[150px] text-right pr-6')}>
                  <Trans>Target</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.groups.map((group) => (
                <Fragment key={group.name}>
                  <TableRow
                    className="cursor-pointer bg-muted/40 text-sm hover:bg-muted/60"
                    onClick={() => toggleGroup(group.name)}
                  >
                    <TableCell className="pl-4 font-semibold uppercase tracking-wide">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 uppercase"
                        aria-expanded={openGroups.has(group.name)}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleGroup(group.name);
                        }}
                      >
                        {openGroups.has(group.name) ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {group.name}
                        <span className="text-xs font-normal normal-case text-muted-foreground">
                          · {group.rows.length}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className={cn(moneyCell, 'font-semibold')}>
                      {money(group.assigned)}
                    </TableCell>
                    <TableCell className={cn(moneyCell, 'font-semibold')}>
                      {money(group.spent)}
                    </TableCell>
                    {monthCount > 1 ? <TableCell /> : null}
                    <TableCell className="text-right pr-6">
                      <TargetPill
                        target={group.target}
                        percent={fundedPercent(group)}
                        formatter={money}
                        bold
                      />
                    </TableCell>
                  </TableRow>
                  {(openGroups.has(group.name) ? group.rows : []).map((row) => (
                    <TableRow key={row.categoryId} className="text-sm">
                      <TableCell className="pl-10">{row.name}</TableCell>
                      <TableCell className={moneyCell}>{money(row.assigned)}</TableCell>
                      <TableCell className={cn(moneyCell, 'text-muted-foreground')}>
                        {money(row.spent)}
                      </TableCell>
                      {monthCount > 1 ? (
                        <TableCell className={cn(moneyCell, 'text-muted-foreground')}>
                          {metLabel(row)}
                        </TableCell>
                      ) : null}
                      <TableCell
                        className="text-right pr-6"
                        data-testid={`report-target-${row.categoryId}`}
                      >
                        <TargetPill
                          target={row.target}
                          percent={fundedPercent(row)}
                          formatter={money}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
              <TableRow className="border-t-2 text-sm">
                <TableCell className="pl-6 font-semibold">
                  <Trans>Total</Trans>
                </TableCell>
                <TableCell className={cn(moneyCell, 'font-semibold')}>
                  {money(report.total.assigned)}
                </TableCell>
                <TableCell className={cn(moneyCell, 'font-semibold')}>
                  {money(report.total.spent)}
                </TableCell>
                {monthCount > 1 ? <TableCell /> : null}
                <TableCell className="text-right pr-6">
                  <TargetPill
                    target={report.total.target}
                    percent={fundedPercent(report.total)}
                    formatter={money}
                    bold
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
