import { useMemo } from 'react';
import type { QuestionColumn, QuestionSource } from '@features/reports/lib/question';
import { currencyDisplayFor } from '@shared/lib/number-format';
import { formatMaskedMilli, maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { useUiStore } from '@shared/store/useUiStore';
import { booleanLabel, columnBucket, columnFormat, formatBucketValue } from './question-labels';

export interface QuestionFormatters {
  /** A cell / axis value of a column, fully formatted (masked in privacy mode). */
  cell: (column: QuestionColumn, value: unknown, style?: 'short' | 'long') => string;
  /** Compact axis tick for a metric column. */
  compact: (column: QuestionColumn, value: number) => string;
  masked: boolean;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Formats question values: budget-currency money, counts, dates, yes/no. */
export function useQuestionFormatters(source: QuestionSource): QuestionFormatters {
  const localizer = useUiStore((state) => state.globalLocalizer);
  const masked = useUiStore((state) => state.privacyMaskNumbers);

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

    const cell: QuestionFormatters['cell'] = (column, value, style = 'short') => {
      const bucket = columnBucket(column, source);
      if (bucket) return formatBucketValue(bucket, value, style);
      if (typeof value === 'boolean') return booleanLabel(value);
      const format = columnFormat(column);
      if (format !== 'text') {
        const numeric = toNumber(value);
        if (numeric === null) return '—';
        if (format === 'percent') return mask(`${plain.format(numeric)}%`);
        return format === 'money'
          ? formatMaskedMilli(localizer, Math.round(numeric * 1000), masked)
          : mask(plain.format(numeric));
      }
      if (value === null || value === undefined || value === '') return '—';
      return String(value);
    };

    return {
      cell,
      compact: (column, value) => {
        if (masked) return '•••';
        if (columnFormat(column) === 'percent') return `${compactPlain.format(value)}%`;
        return columnFormat(column) === 'money'
          ? compactMoney.format(value)
          : compactPlain.format(value);
      },
      masked,
    };
  }, [localizer, masked, source]);
}
