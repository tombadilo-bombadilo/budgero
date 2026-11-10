import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react';
import { Button } from '@shared/ui/button';
import type { BreakoutColumn } from '@features/reports/lib/question';
import { useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import type { DrillRequest } from '../DrillMenu';
import { withAlpha } from './display';
import { downloadCsv } from './export';
import {
  buildPivot,
  pivotToCsv,
  sortPivotRows,
  type PivotHeader,
  type PivotSort,
} from './transforms';
import type { VizViewProps } from './types';

/** Rows / columns rendered at first; "show more" adds another batch. */
export const PIVOT_ROW_PAGE = 100;
export const PIVOT_COLUMN_PAGE = 30;

interface PivotTableViewProps extends VizViewProps {
  /** File name (without extension) for the CSV download. */
  exportName?: string;
  /** Click on a cell or row header (drill-through). */
  onDrill?: (request: DrillRequest) => void;
}

type SortKey = 'label' | 'total' | string;
type SortState = { key: SortKey; direction: 'asc' | 'desc' } | null;

function SortIcon({ sort, sortKey }: { sort: SortState; sortKey: SortKey }) {
  const Icon = sort?.key !== sortKey ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Icon className={cn('h-3 w-3 shrink-0', sort?.key !== sortKey && 'opacity-40')} aria-hidden />
  );
}

/**
 * Rows = first grouping, columns = second grouping, cells = first metric,
 * with row and column totals. Headers stay put while scrolling; every
 * header sorts the rows. Cells are shaded by size.
 */
export function PivotTableView({
  result,
  columns,
  source,
  fitHeight,
  className,
  exportName,
  onDrill,
}: PivotTableViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source, result);
  const pivot = useMemo(() => buildPivot(result, columns), [result, columns]);
  const [sort, setSort] = useState<SortState>(null);
  const [rowLimit, setRowLimit] = useState(PIVOT_ROW_PAGE);
  const [colLimit, setColLimit] = useState(PIVOT_COLUMN_PAGE);
  // A new result starts from the first page again.
  useEffect(() => {
    setRowLimit(PIVOT_ROW_PAGE);
    setColLimit(PIVOT_COLUMN_PAGE);
  }, [result]);

  const rowLabel = (value: unknown) => (pivot ? format.cell(pivot.rowColumn, value) : '');
  const colLabel = (value: unknown) => (pivot ? format.cell(pivot.colColumn, value) : '');
  const pivotSort: PivotSort | null = sort
    ? {
        by: sort.key === 'label' || sort.key === 'total' ? sort.key : { column: sort.key },
        direction: sort.direction,
      }
    : null;
  const rows = pivot ? sortPivotRows(pivot, pivotSort, rowLabel) : [];

  if (!pivot) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>A pivot table needs two groupings and a metric.</Trans>
      </div>
    );
  }

  const shownRows = rows.slice(0, rowLimit);
  const shownCols = pivot.cols.slice(0, colLimit);
  let maxCell = 1;
  for (const row of rows) {
    for (const value of Object.values(pivot.cells[row.key] ?? {})) {
      if (Math.abs(value) > maxCell) maxCell = Math.abs(value);
    }
  }

  const drillValue = (column: typeof pivot.rowColumn, header: PivotHeader) => ({
    column: column as BreakoutColumn,
    value: header.value,
    ...('id' in header ? { key: header.id } : {}),
  });
  const drill = (target: HTMLElement, row: PivotHeader, col?: PivotHeader) => {
    const box = target.getBoundingClientRect();
    onDrill?.({
      values: [
        drillValue(pivot.rowColumn, row),
        ...(col ? [drillValue(pivot.colColumn, col)] : []),
      ],
      anchor: { x: box.left, y: box.bottom },
    });
  };
  const drillButton =
    '-mx-1 rounded px-1 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const shade = palette.series[0];
  const totalLabel = t`Total`;
  const cornerLabel = `${columnLabel(source, pivot.rowColumn)} \\ ${columnLabel(source, pivot.colColumn)}`;

  const toggleSort = (key: SortKey) =>
    setSort((previous) => {
      if (previous?.key !== key) return { key, direction: key === 'label' ? 'asc' : 'desc' };
      if (previous.direction === (key === 'label' ? 'asc' : 'desc')) {
        return { key, direction: key === 'label' ? 'desc' : 'asc' };
      }
      return null;
    });
  const ariaSort = (key: SortKey) =>
    sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';

  const exportCsv = () => {
    const csv = pivotToCsv(pivot, rows, {
      corner: cornerLabel,
      total: totalLabel,
      row: (value) => format.cell(pivot.rowColumn, value),
      col: (value) => format.cell(pivot.colColumn, value),
    });
    downloadCsv(csv, exportName || t`pivot`);
  };

  const headerButton =
    'inline-flex w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const rowsText = plural(rows.length, { one: '# row', other: '# rows' });
  const colsText = plural(pivot.cols.length, { one: '# column', other: '# columns' });
  const shownRowCount = shownRows.length.toLocaleString();
  const shownColCount = shownCols.length.toLocaleString();
  const capped = shownRows.length < rows.length || shownCols.length < pivot.cols.length;
  const sizeText = capped
    ? t`${rowsText} × ${colsText}, showing ${shownRowCount} × ${shownColCount}`
    : t`${rowsText} × ${colsText}`;

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t`${columnLabel(source, pivot.metric)} · ${sizeText}`}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          <Trans>Pivot CSV</Trans>
        </Button>
      </div>
      <div
        className={cn(
          'min-h-0 overflow-auto rounded-md border',
          fitHeight ? 'flex-1' : 'max-h-[32rem]'
        )}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                aria-sort={ariaSort('label')}
                className="sticky left-0 top-0 z-30 border-b border-r bg-card px-2 py-1.5 text-left font-medium"
              >
                <button type="button" className={headerButton} onClick={() => toggleSort('label')}>
                  <span className="max-w-[30vw] truncate sm:max-w-56">{cornerLabel}</span>
                  <SortIcon sort={sort} sortKey="label" />
                </button>
              </th>
              {shownCols.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort(col.key)}
                  className="sticky top-0 z-20 border-b bg-card px-2 py-1.5 text-right font-medium"
                >
                  <button
                    type="button"
                    className={cn(headerButton, 'justify-end')}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="max-w-40 truncate">{colLabel(col.value)}</span>
                    <SortIcon sort={sort} sortKey={col.key} />
                  </button>
                </th>
              ))}
              <th
                scope="col"
                aria-sort={ariaSort('total')}
                className="top-0 z-30 border-b border-l bg-card px-2 py-1.5 text-right font-semibold sticky sm:right-0"
              >
                <button
                  type="button"
                  className={cn(headerButton, 'justify-end')}
                  onClick={() => toggleSort('total')}
                >
                  {totalLabel}
                  <SortIcon sort={sort} sortKey="total" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row) => (
              <tr key={row.key} className="hover:bg-muted/40">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[36vw] truncate border-b border-r bg-card px-3 py-1.5 text-left font-normal sm:max-w-64"
                >
                  {onDrill ? (
                    <button
                      type="button"
                      aria-haspopup="menu"
                      className={cn(drillButton, 'max-w-full truncate text-primary')}
                      onClick={(event) => drill(event.currentTarget, row)}
                    >
                      {rowLabel(row.value)}
                    </button>
                  ) : (
                    rowLabel(row.value)
                  )}
                </th>
                {shownCols.map((col) => {
                  const value = pivot.cells[row.key]?.[col.key];
                  return (
                    <td
                      key={col.key}
                      className="border-b px-3 py-1.5 text-right font-mono tabular-nums"
                      style={
                        value !== undefined && !format.masked
                          ? {
                              backgroundColor: withAlpha(
                                shade,
                                0.04 + (Math.abs(value) / maxCell) * 0.28
                              ),
                            }
                          : undefined
                      }
                    >
                      {value === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : onDrill ? (
                        <button
                          type="button"
                          aria-haspopup="menu"
                          aria-label={t`Explore ${rowLabel(row.value)} · ${colLabel(col.value)}`}
                          className={drillButton}
                          onClick={(event) => drill(event.currentTarget, row, col)}
                        >
                          {format.cell(pivot.metric, value)}
                        </button>
                      ) : (
                        format.cell(pivot.metric, value)
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-l bg-card px-3 py-1.5 text-right font-mono font-semibold tabular-nums sm:sticky sm:right-0">
                  {format.cell(pivot.metric, row.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-20 border-r border-t bg-card px-3 py-1.5 text-left font-semibold"
              >
                {totalLabel}
              </th>
              {shownCols.map((col) => (
                <td
                  key={col.key}
                  className="sticky bottom-0 z-10 border-t bg-card px-3 py-1.5 text-right font-mono font-semibold tabular-nums"
                >
                  {format.cell(pivot.metric, col.total)}
                </td>
              ))}
              <td className="sticky bottom-0 z-20 border-l border-t bg-card sm:right-0 px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                {format.cell(pivot.metric, pivot.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(shownRows.length < rows.length || shownCols.length < pivot.cols.length) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {shownRows.length < rows.length && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRowLimit((limit) => limit + PIVOT_ROW_PAGE * 5)}
            >
              <Trans>Show more rows</Trans>
            </Button>
          )}
          {shownCols.length < pivot.cols.length && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setColLimit((limit) => limit + PIVOT_COLUMN_PAGE)}
            >
              <Trans>Show more columns</Trans>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
