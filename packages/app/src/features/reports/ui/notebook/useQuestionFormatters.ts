import { useMemo } from 'react';
import type { QuestionColumn, QuestionSource } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { currencyDisplayFor } from '@shared/lib/number-format';
import { formatMaskedMilli, maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { useUiStore } from '@shared/store/useUiStore';
import {
  booleanLabel,
  columnBucket,
  columnFormat,
  formatBucketValue,
  formatDatePartValue,
} from './question-labels';

export interface QuestionFormatters {
  /** A cell / axis value of a column, fully formatted (masked in privacy mode). */
  cell: (column: QuestionColumn, value: unknown, style?: 'short' | 'long') => string;
  /** Compact axis tick for a metric column. */
  compact: (column: QuestionColumn, value: number) => string;
  /** A ratio (0.25) as a percentage in the app's number locale ("25%"). */
  percent: (ratio: number, fractionDigits?: number) => string;
  masked: boolean;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Bin widths of the result's numeric-bin groupings, by column key: auto bins
 * only know their width from the result's hidden `<key>__key` column.
 */
export function resultBinWidths(result: QueryResult | null | undefined): Map<string, number> {
  const widths = new Map<string, number>();
  if (!result || result.rows.length === 0) return widths;
  result.columns.forEach((name, position) => {
    if (!name.endsWith('_bin__key')) return;
    const width = toNumber(result.rows[0][position]);
    if (width !== null && width > 0) widths.set(name.slice(0, -'__key'.length), width);
  });
  return widths;
}

/**
 * Formats question values: budget-currency money, counts, dates, date parts
 * (weekday / month names), numeric ranges, yes/no. Pass the result to label
 * auto-width bins as ranges.
 */
export function useQuestionFormatters(
  source: QuestionSource,
  result?: QueryResult | null
): QuestionFormatters {
  const localizer = useUiStore((state) => state.globalLocalizer);
  const masked = useUiStore((state) => state.privacyMaskNumbers);
  const binWidths = useMemo(() => resultBinWidths(result), [result]);

  return useMemo(() => {
    const resolved = localizer.resolvedOptions();
    const currency = resolved.currency ?? 'USD';
    const compactMoney = new Intl.NumberFormat(resolved.locale, {
      style: 'currency',
      currency,
      currencyDisplay: currencyDisplayFor(currency),
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const plain = new Intl.NumberFormat(resolved.locale, { maximumFractionDigits: 2 });
    const compactPlain = new Intl.NumberFormat(resolved.locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const mask = (text: string) => maskFormattedIfEnabled(text, masked);
    const percentFormats = new Map<number, Intl.NumberFormat>();
    const percent: QuestionFormatters['percent'] = (ratio, fractionDigits = 0) => {
      let formatter = percentFormats.get(fractionDigits);
      if (!formatter) {
        formatter = new Intl.NumberFormat(resolved.locale, {
          style: 'percent',
          maximumFractionDigits: fractionDigits,
        });
        percentFormats.set(fractionDigits, formatter);
      }
      return formatter.format(ratio);
    };

    const number = (column: QuestionColumn, numeric: number) =>
      columnFormat(column) === 'money'
        ? formatMaskedMilli(localizer, Math.round(numeric * 1000), masked)
        : mask(plain.format(numeric));

    const cell: QuestionFormatters['cell'] = (column, value, style = 'short') => {
      if (column.kind === 'breakout' && column.breakout.part) {
        return formatDatePartValue(column.breakout.part, value, style);
      }
      if (column.kind === 'breakout' && column.breakout.bin !== undefined) {
        const from = toNumber(value);
        if (from === null) return '—';
        const { bin } = column.breakout;
        const width = typeof bin === 'number' ? bin : binWidths.get(column.key);
        if (!width) return `${number(column, from)}+`;
        return `${number(column, from)} – ${number(column, from + width)}`;
      }
      const bucket = columnBucket(column, source);
      if (bucket) return formatBucketValue(bucket, value, style);
      if (typeof value === 'boolean') return booleanLabel(value);
      const format = columnFormat(column);
      if (format !== 'text') {
        const numeric = toNumber(value);
        if (numeric === null) return '—';
        if (format === 'percent') return mask(percent(numeric / 100, 2));
        return number(column, numeric);
      }
      if (value === null || value === undefined || value === '') return '—';
      return String(value);
    };

    return {
      cell,
      compact: (column, value) => {
        if (masked) return '•••';
        if (columnFormat(column) === 'percent') return percent(value / 100, 1);
        return columnFormat(column) === 'money'
          ? compactMoney.format(value)
          : compactPlain.format(value);
      },
      percent,
      masked,
    };
  }, [localizer, masked, source, binWidths]);
}
