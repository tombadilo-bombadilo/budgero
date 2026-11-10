import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { todayIso, type QuestionColumn, type QuestionSource } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { cn } from '@shared/lib/utils';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { changeRatio, summarizeResult } from './summary';

/**
 * One plain sentence about the result above the chart ("Spending in October
 * 2026 was 12% more than in September 2026"), computed on this device from
 * the rows. Nothing when the result has no clear story or numbers are hidden.
 */
export function ResultSummaryLine({
  result,
  columns,
  source,
  className,
}: {
  result: QueryResult;
  columns: QuestionColumn[];
  source: QuestionSource;
  className?: string;
}) {
  const { t } = useLingui();
  const format = useQuestionFormatters(source, result);
  const today = todayIso();
  const summary = useMemo(() => summarizeResult(result, columns, today), [result, columns, today]);
  if (!summary || format.masked) return null;

  const metricName = columnLabel(source, summary.metric);
  const money = (value: number) => format.cell(summary.metric, value);
  const pct = (ratio: number) => format.percent(Math.abs(ratio), Math.abs(ratio) < 0.1 ? 1 : 0);

  let text: string;
  switch (summary.kind) {
    case 'period': {
      const period = format.cell(summary.x, summary.current.x, 'long');
      const value = money(summary.current.value);
      const ratio = changeRatio(summary.current.value, summary.previous.value);
      const change = ratio === null ? '' : pct(ratio);
      if (summary.against === 'lastYear') {
        const before = money(summary.previous.value);
        if (ratio === null) text = t`${metricName} in ${period}: ${value}.`;
        else if (ratio > 0.0005)
          text = t`${metricName} in ${period} was ${change} more than a year earlier (${value} vs ${before}).`;
        else if (ratio < -0.0005)
          text = t`${metricName} in ${period} was ${change} less than a year earlier (${value} vs ${before}).`;
        else text = t`${metricName} in ${period} was the same as a year earlier (${value}).`;
        break;
      }
      const previousPeriod = format.cell(summary.x, summary.previous.x, 'long');
      const before = money(summary.previous.value);
      if (ratio === null) text = t`${metricName} in ${period}: ${value}.`;
      else if (ratio > 0.0005)
        text = t`${metricName} in ${period} was ${change} more than in ${previousPeriod} (${value} vs ${before}).`;
      else if (ratio < -0.0005)
        text = t`${metricName} in ${period} was ${change} less than in ${previousPeriod} (${value} vs ${before}).`;
      else text = t`${metricName} in ${period} was the same as in ${previousPeriod} (${value}).`;
      break;
    }
    case 'largest': {
      const name = format.cell(summary.x, summary.top.x, 'long');
      const value = money(summary.top.value);
      const share = format.percent(summary.share);
      text = t`${name} is the largest: ${value}, ${share} of the total.`;
      break;
    }
    case 'largestInPeriod': {
      const period = format.cell(summary.x, summary.period, 'long');
      const name = format.cell(summary.series, summary.top.group, 'long');
      const value = money(summary.top.value);
      const ratio = summary.before ? changeRatio(summary.top.value, summary.before.value) : null;
      const change = ratio === null ? '' : pct(ratio);
      if (summary.before && ratio !== null && Math.abs(ratio) > 0.0005) {
        const previousPeriod = format.cell(summary.x, summary.before.period, 'long');
        text =
          ratio > 0
            ? t`In ${period}, ${name} was the largest at ${value}, ${change} more than in ${previousPeriod}.`
            : t`In ${period}, ${name} was the largest at ${value}, ${change} less than in ${previousPeriod}.`;
      } else {
        text = t`In ${period}, ${name} was the largest at ${value}.`;
      }
      break;
    }
  }

  return (
    <p
      className={cn('flex items-start gap-1.5 text-sm text-muted-foreground', className)}
      data-no-export
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
