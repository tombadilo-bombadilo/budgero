import type { ReactNode } from 'react';
import { useLingui } from '@lingui/react/macro';
import { ChevronRight } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { formatShare } from '../report-answers';

export interface LedgerColumn<Row> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right';
  render: (row: Row) => ReactNode;
  cellClassName?: (row: Row) => string | undefined;
  /** Hide on narrow screens (e.g. secondary columns). */
  hideOnMobile?: boolean;
}

interface LedgerTableProps<Row> {
  title: ReactNode;
  /** Right side of the title bar (e.g. a collapse button). */
  actions?: ReactNode;
  columns: LedgerColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Scroll the body past this height (Tailwind class, e.g. max-h-[420px]). */
  maxHeightClassName?: string;
  footnote?: ReactNode;
}

/**
 * Register-style table: hairline rows, tabular numbers, a sticky header.
 * The first column is the row header (scope="row").
 */
export function LedgerTable<Row>({
  title,
  actions,
  columns,
  rows,
  rowKey,
  maxHeightClassName,
  footnote,
}: LedgerTableProps<Row>) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      <div className={cn('overflow-auto', maxHeightClassName)}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-2 text-xs font-medium text-muted-foreground',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.hideOnMobile && 'hidden sm:table-cell'
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border/60 last:border-b-0 hover:bg-muted/40"
              >
                {columns.map((column, index) => {
                  const Cell = index === 0 ? 'th' : 'td';
                  return (
                    <Cell
                      key={column.key}
                      scope={index === 0 ? 'row' : undefined}
                      className={cn(
                        'px-4 py-2 align-middle',
                        index === 0 ? 'max-w-[16rem] text-left font-normal' : 'whitespace-nowrap',
                        column.align === 'right' && 'text-right tabular-nums',
                        column.hideOnMobile && 'hidden sm:table-cell',
                        column.cellClassName?.(row)
                      )}
                    >
                      {column.render(row)}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote ? (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/** Tiny inline trend line; no axes, no fill. */
export function Sparkline({
  values,
  color,
  width = 72,
  height = 20,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="text-muted-foreground">—</span>;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = (width - 2) / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = 1 + index * step;
      const y = 1 + (height - 2) * (1 - (value - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle text-muted-foreground"
      aria-hidden
      data-testid="sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color ?? 'currentColor'}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface BreakdownRow {
  key: string;
  name: string;
  /** Milliunits. */
  amount: number;
  color?: string;
  /** One value per month of the period. */
  trend?: number[];
  /** Makes the name a button (drill-down / expand Other). */
  onSelect?: () => void;
}

/**
 * Ranked breakdown: Name | Amount | Share | trend sparkline. Rows with
 * `onSelect` open a deeper view; the detail replaces the current view rather
 * than unfolding inline, so the button is not a disclosure (no aria-expanded).
 */
export function BreakdownTable({
  title,
  actions,
  rows,
  total,
  money,
  nameHeader,
  showTrend = true,
  maxHeightClassName,
  footnote,
}: {
  title: ReactNode;
  actions?: ReactNode;
  rows: BreakdownRow[];
  /** Denominator for the share column (milliunits). */
  total: number;
  money: (milli: number) => string;
  nameHeader: string;
  showTrend?: boolean;
  maxHeightClassName?: string;
  footnote?: ReactNode;
}) {
  const { t } = useLingui();
  const columns: LedgerColumn<BreakdownRow>[] = [
    {
      key: 'name',
      header: nameHeader,
      render: (row) => {
        const content = (
          <span className="flex min-w-0 items-center gap-2">
            {row.color ? (
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
            ) : null}
            <span className="min-w-0 truncate">{row.name}</span>
            {row.onSelect ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
          </span>
        );
        return row.onSelect ? (
          <button
            type="button"
            onClick={row.onSelect}
            className="-mx-1 block max-w-full rounded px-1 text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </button>
        ) : (
          content
        );
      },
    },
    {
      key: 'amount',
      header: t`Amount`,
      align: 'right',
      render: (row) => money(row.amount),
    },
    {
      key: 'share',
      header: t`Share`,
      align: 'right',
      render: (row) => formatShare(row.amount, total),
      cellClassName: () => 'text-muted-foreground',
    },
  ];
  if (showTrend) {
    columns.push({
      key: 'trend',
      header: t`Monthly trend`,
      align: 'right',
      hideOnMobile: true,
      render: (row) => (row.trend ? <Sparkline values={row.trend} color={row.color} /> : null),
    });
  }
  return (
    <LedgerTable
      title={title}
      actions={actions}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      maxHeightClassName={maxHeightClassName}
      footnote={footnote}
    />
  );
}
