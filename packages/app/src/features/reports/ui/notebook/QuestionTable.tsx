import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import {
  rowDrillValues,
  type QuestionColumn,
  type QuestionSource,
} from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { Button } from '@shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { columnFormat, columnLabel } from './question-labels';
import { useQuestionFormatters } from './useQuestionFormatters';
import type { DrillRequest } from './DrillMenu';

const PAGE_SIZE = 100;

interface QuestionTableProps {
  result: QueryResult;
  columns: QuestionColumn[];
  source: QuestionSource;
  className?: string;
  /** Summarized results: clicking a cell explores its values. */
  onDrill?: (request: DrillRequest) => void;
}

/** Result rows with friendly headers ("Month", "Spending") and formatted cells. */
export function QuestionTable({ result, columns, source, className, onDrill }: QuestionTableProps) {
  const { t } = useLingui();
  const format = useQuestionFormatters(source);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const index = new Map(result.columns.map((name, position) => [name, position]));
  const shown = columns.filter((column) => index.has(column.key));
  const rows = result.rows.slice(0, visible);
  const shownCount = rows.length.toLocaleString();
  const totalCount = result.rows.length.toLocaleString();
  const drillable = Boolean(onDrill) && columns.some((column) => column.kind === 'breakout');
  const drill = (row: unknown[], column: QuestionColumn, target: HTMLElement) => {
    // A grouping cell explores that value; a metric cell the whole row.
    const values = rowDrillValues(
      columns,
      result.columns,
      row,
      column.kind === 'breakout' ? column.key : undefined
    );
    if (values.length === 0) return;
    const box = target.getBoundingClientRect();
    onDrill?.({ values, anchor: { x: box.left, y: box.bottom } });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="max-h-[32rem] overflow-auto rounded-md border">
        <Table className="w-max min-w-full text-sm">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {shown.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cn(columnFormat(column) !== 'text' && 'text-right')}
                >
                  {columnLabel(source, column)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {shown.map((column) => {
                  const numeric = columnFormat(column) !== 'text';
                  const text = format.cell(column, row[index.get(column.key) ?? -1]);
                  return (
                    <TableCell
                      key={column.key}
                      className={cn(numeric && 'text-right font-mono tabular-nums')}
                    >
                      {drillable ? (
                        <button
                          type="button"
                          onClick={(event) => drill(row, column, event.currentTarget)}
                          aria-haspopup="menu"
                          aria-label={t`Explore ${text}`}
                          className={cn(
                            '-mx-1 rounded px-1 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            column.kind === 'breakout' && 'text-primary'
                          )}
                        >
                          {text}
                        </button>
                      ) : (
                        text
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {result.rows.length === 1 ? t`1 row` : t`Showing ${shownCount} of ${totalCount} rows`}
        </span>
        {visible < result.rows.length && (
          <Button variant="outline" size="sm" onClick={() => setVisible((n) => n + PAGE_SIZE * 5)}>
            <Trans>Show more rows</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}
