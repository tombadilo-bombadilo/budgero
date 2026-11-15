'use client';

import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { EChartsCoreOption } from 'echarts/core';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  BASE_GRID,
  tooltipBase,
  tooltipHtml,
  useChartPalette,
  valueAxis,
} from '@/components/tools/chart-theme';
import { parseAmount } from '@/lib/debt-payoff';
import {
  MAX_YEARS,
  coastCrossing,
  coastNumber,
  fireNumber,
  planFire,
  project,
  type FireResult,
  type YearRow,
} from '@/lib/fire';

// The chart library loads after hydration; the chart box reserves its height.
const EChart = dynamic(() => import('@/components/tools/echart'), { ssr: false });

const EXAMPLE = {
  age: '35',
  savings: '80000',
  monthly: '2000',
  spending: '40000',
  return: '5',
  withdrawal: '4',
  coastAge: '65',
};

type Field = keyof typeof EXAMPLE;
type FieldIssue = 'required' | 'number' | 'negative' | 'range' | null;

const MAX_AGE = 120;

const noop = () => () => {};
// The server renders with fixed values; the visitor's own locale and today's
// month replace them after hydration.
const useBrowserLocale = () =>
  useSyncExternalStore(
    noop,
    () => navigator.language || 'en-US',
    () => 'en-US'
  );
const useStartMonth = () =>
  useSyncExternalStore(
    noop,
    () => {
      const now = new Date();
      return now.getFullYear() * 12 + now.getMonth();
    },
    () => null
  );

/** Checks one parsed field. `inRange` is only called for finite numbers. */
function fieldIssue(
  value: number | null,
  inRange: (value: number) => boolean = (v) => v >= 0
): FieldIssue {
  if (value === null) return 'required';
  if (Number.isNaN(value)) return 'number';
  if (!inRange(value)) return value < 0 ? 'negative' : 'range';
  return null;
}

const isAge = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_AGE;

function inputClass(invalid: boolean) {
  return cn(
    'h-10 w-full rounded-md border bg-background px-3 text-base text-foreground shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring tabular-nums',
    invalid ? 'border-destructive' : 'border-border'
  );
}

export function FireCalculator() {
  const t = useTranslations('fire_calculator');
  const locale = useBrowserLocale();
  const startMonth = useStartMonth();
  const baseId = useId();
  const [values, setValues] = useState(EXAMPLE);
  const [tableOpen, setTableOpen] = useState(false);
  const tracked = useRef(false);

  const decimalSeparator = useMemo<'.' | ','>(() => {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  }, [locale]);
  const money = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale]
  );
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale]
  );
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale]
  );
  const fmt = (value: number) => money.format(value);
  // Stable between renders so the chart only redraws when its data changes.
  const chartFmt = useCallback((value: number) => money.format(value), [money]);
  const compactNumber = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale]
  );
  const chartCompact = useCallback((value: number) => compactNumber.format(value), [compactNumber]);
  const monthDate = (month: number) => {
    if (startMonth === null) return t('month_number', { month });
    const index = startMonth + month;
    return monthFormat.format(Date.UTC(Math.floor(index / 12), index % 12, 1));
  };
  const duration = (total: number) => {
    const years = Math.floor(total / 12);
    const months = total % 12;
    return t('duration', { years, months, both: years > 0 && months > 0 ? 'yes' : 'no' });
  };

  const setField = (field: Field, value: string) => {
    if (!tracked.current) {
      tracked.current = true;
      // No figures are sent, only that the calculator was used.
      track('FIRE Calculator - Edited');
    }
    setValues((current) => ({ ...current, [field]: value }));
  };

  const parsed = useMemo(() => {
    const read = (field: Field) => parseAmount(values[field], decimalSeparator);
    const age = read('age');
    const savings = read('savings');
    const monthly = read('monthly');
    const spending = read('spending');
    const ret = read('return');
    const withdrawal = read('withdrawal');
    const coastAge = read('coastAge');
    const issues: Record<Field, FieldIssue> = {
      age: fieldIssue(age, isAge),
      savings: fieldIssue(savings),
      monthly: fieldIssue(monthly),
      spending: fieldIssue(spending),
      return: fieldIssue(ret, (v) => v > -100),
      withdrawal: fieldIssue(withdrawal, (v) => v > 0 && v <= 100),
      // Only compared with the current age once that age is valid.
      coastAge: fieldIssue(coastAge, (v) => isAge(v) && (age === null || !isAge(age) || v > age)),
    };
    return {
      issues,
      age: age as number,
      savings: savings as number,
      monthly: monthly as number,
      spending: spending as number,
      ret: ret as number,
      withdrawal: withdrawal as number,
      coastAge: coastAge as number,
    };
  }, [values, decimalSeparator]);

  const { issues } = parsed;
  const mainValid =
    !issues.age &&
    !issues.savings &&
    !issues.monthly &&
    !issues.spending &&
    !issues.return &&
    !issues.withdrawal;

  const result = useMemo(() => {
    if (!mainValid) return null;
    const target = fireNumber(parsed.spending, parsed.withdrawal);
    return { target, plan: planFire(parsed.savings, parsed.monthly, parsed.ret, target) };
  }, [mainValid, parsed]);

  const issueText = (field: Field, issue: FieldIssue) => {
    if (issue === 'required') return t(`error_${field}_required`);
    if (issue === 'number') return t('error_number');
    if (
      issue === 'negative' &&
      (field === 'savings' || field === 'monthly' || field === 'spending')
    )
      return t('error_negative');
    if (issue) return t(`error_${field}_range`);
    return null;
  };

  // The return can be negative, and numeric keypads on phones have no minus key.
  const fields: {
    field: Field;
    label: string;
    help?: string;
    mode: 'decimal' | 'numeric' | 'text';
  }[] = [
    { field: 'age', label: t('label_age'), mode: 'numeric' },
    { field: 'savings', label: t('label_savings'), mode: 'decimal' },
    { field: 'monthly', label: t('label_monthly'), mode: 'decimal' },
    { field: 'spending', label: t('label_spending'), help: t('help_spending'), mode: 'decimal' },
    { field: 'return', label: t('label_return'), help: t('help_return'), mode: 'text' },
    {
      field: 'withdrawal',
      label: t('label_withdrawal'),
      help: t('help_withdrawal'),
      mode: 'decimal',
    },
    { field: 'coastAge', label: t('label_coast_age'), help: t('help_coast_age'), mode: 'numeric' },
  ];

  return (
    <div className="space-y-10">
      {/* Inputs */}
      <section aria-labelledby={`${baseId}-inputs`} className="space-y-4">
        <div>
          <h2 id={`${baseId}-inputs`} className="text-2xl font-bold text-foreground">
            {t('inputs_heading')}
          </h2>
          <p className="mt-1 text-sm text-foreground/65">{t('example_note')}</p>
        </div>

        <div className="grid gap-5 rounded-xl border border-border/70 bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
          {fields.map(({ field, label, help, mode }) => {
            const inputId = `${baseId}-${field}`;
            const message = issueText(field, issues[field]);
            const describedBy = message ? `${inputId}-error` : help ? `${inputId}-help` : undefined;
            return (
              <div key={field} className="space-y-1.5">
                <label htmlFor={inputId} className="block text-sm font-medium">
                  {label}
                </label>
                <input
                  id={inputId}
                  type="text"
                  inputMode={mode}
                  autoComplete="off"
                  value={values[field]}
                  onChange={(e) => setField(field, e.target.value)}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={describedBy}
                  className={inputClass(Boolean(message))}
                />
                {message ? (
                  <p id={`${inputId}-error`} className="text-sm text-destructive">
                    {message}
                  </p>
                ) : (
                  help && (
                    <p id={`${inputId}-help`} className="text-sm text-foreground/65">
                      {help}
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Results */}
      <section aria-labelledby={`${baseId}-results`} className="space-y-6">
        <h2 id={`${baseId}-results`} className="text-2xl font-bold text-foreground">
          {t('results_heading')}
        </h2>

        {!result ? (
          <p className="rounded-xl border border-border/70 bg-muted/20 p-5 text-foreground/75">
            {t('invalid')}
          </p>
        ) : (
          <>
            <Summary
              plan={result.plan}
              target={result.target}
              inputs={parsed}
              fmt={fmt}
              percent={(v) => percent.format(v)}
              duration={duration}
              monthDate={monthDate}
              t={t}
            />

            {result.plan.status !== 'reached' && (
              <Coast
                target={result.target}
                inputs={parsed}
                coastAgeIssue={issues.coastAge}
                fmt={fmt}
                percent={(v) => percent.format(v)}
                duration={duration}
                t={t}
              />
            )}

            {result.plan.status === 'ok' && (
              <SavingsChart
                plan={result.plan}
                target={result.target}
                inputs={parsed}
                fmt={chartFmt}
                compact={chartCompact}
                startYear={startMonth === null ? null : Math.floor(startMonth / 12)}
                reachedDate={startMonth === null ? '' : monthDate(result.plan.months)}
                t={t}
              />
            )}

            {result.plan.status === 'ok' && (
              <details
                className="rounded-xl border border-border/70 bg-card"
                onToggle={(e) => setTableOpen(e.currentTarget.open)}
              >
                <summary className="cursor-pointer p-4 font-medium sm:p-5">
                  {t('table_summary', { years: result.plan.years.length })}
                </summary>
                {tableOpen && (
                  <YearTable
                    rows={result.plan.years}
                    savings={parsed.savings}
                    age={parsed.age}
                    fmt={fmt}
                    t={t}
                  />
                )}
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

interface Inputs {
  age: number;
  savings: number;
  monthly: number;
  spending: number;
  ret: number;
  withdrawal: number;
  coastAge: number;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <dt className="text-sm text-foreground/65">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
      </dd>
      {note && <dd className="mt-1 text-sm text-foreground/65">{note}</dd>}
    </div>
  );
}

function Notice({ title, body, tone }: { title: string; body: string; tone: 'bad' | 'good' }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-5',
        tone === 'bad'
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-emerald-600/40 bg-emerald-600/5'
      )}
    >
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-foreground/75">{body}</p>
    </div>
  );
}

function Summary({
  plan,
  target,
  inputs,
  fmt,
  percent,
  duration,
  monthDate,
  t,
}: {
  plan: FireResult;
  target: number;
  inputs: Inputs;
  fmt: (n: number) => string;
  percent: (n: number) => string;
  duration: (months: number) => string;
  monthDate: (month: number) => string;
  t: T;
}) {
  const numberStat = (
    <Stat
      label={t('result_number')}
      value={fmt(target)}
      note={t('result_number_note', {
        spending: fmt(inputs.spending),
        rate: percent(inputs.withdrawal),
      })}
    />
  );

  if (plan.status !== 'ok') {
    let notice: { title: string; body: string; tone: 'bad' | 'good' };
    if (plan.status === 'reached') {
      notice = {
        title: t('reached_title'),
        body: t('reached_body', {
          savings: fmt(inputs.savings),
          number: fmt(target),
          rate: percent(inputs.withdrawal),
          payable: fmt((inputs.savings * inputs.withdrawal) / 100),
          spending: fmt(inputs.spending),
        }),
        tone: 'good',
      };
    } else if (plan.status === 'too-long') {
      notice = {
        title: t('too_long_title', { years: MAX_YEARS }),
        body: t('too_long_body', {
          years: MAX_YEARS,
          balance: fmt(plan.balanceAfter),
          number: fmt(target),
        }),
        tone: 'bad',
      };
    } else {
      notice = {
        title: t('never_title'),
        body:
          plan.reason === 'ceiling'
            ? t('never_ceiling', {
                rate: percent(inputs.ret),
                monthly: fmt(inputs.monthly),
                ceiling: fmt(plan.ceiling),
                number: fmt(target),
              })
            : plan.reason === 'flat'
              ? t('never_flat', { savings: fmt(inputs.savings), number: fmt(target) })
              : t('never_nothing'),
        tone: 'bad',
      };
    }
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{numberStat}</dl>
        <Notice {...notice} />
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {numberStat}
      <Stat label={t('result_time')} value={duration(plan.months)} />
      <Stat label={t('result_age')} value={String(inputs.age + Math.floor(plan.months / 12))} />
      <Stat label={t('result_when')} value={monthDate(plan.months)} />
    </dl>
  );
}

function Coast({
  target,
  inputs,
  coastAgeIssue,
  fmt,
  percent,
  duration,
  t,
}: {
  target: number;
  inputs: Inputs;
  coastAgeIssue: FieldIssue;
  fmt: (n: number) => string;
  percent: (n: number) => string;
  duration: (months: number) => string;
  t: T;
}) {
  let body: string[];
  let value: string | null = null;

  if (coastAgeIssue) {
    body = [t('coast_fix')];
  } else {
    const years = inputs.coastAge - inputs.age;
    const coast = coastNumber(target, inputs.ret, years);
    value = fmt(coast);
    body = [
      t('coast_explain', {
        number: fmt(target),
        age: inputs.coastAge,
        rate: percent(inputs.ret),
      }),
    ];
    if (Math.round(inputs.savings * 100) >= Math.round(coast * 100)) {
      const alone = planFire(inputs.savings, 0, inputs.ret, target);
      body.push(
        alone.status === 'ok'
          ? t('coast_passed', {
              savings: fmt(inputs.savings),
              age: inputs.age + Math.floor(alone.months / 12),
            })
          : t('coast_passed_by', { savings: fmt(inputs.savings), age: inputs.coastAge })
      );
    } else {
      body.push(
        t('coast_short', { savings: fmt(inputs.savings), short: fmt(coast - inputs.savings) })
      );
      const crossed = coastCrossing(inputs.savings, inputs.monthly, inputs.ret, target, years);
      body.push(
        crossed === null
          ? t('coast_not_crossed', { monthly: fmt(inputs.monthly), age: inputs.coastAge })
          : t('coast_crossed', {
              monthly: fmt(inputs.monthly),
              duration: duration(crossed),
              age: inputs.age + Math.floor(crossed / 12),
            })
      );
    }
  }

  return (
    <div>
      <h3 className="mb-2 font-semibold text-foreground">{t('coast_heading')}</h3>
      <div className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 sm:grid-cols-[auto_1fr] sm:items-start sm:p-5">
        {value && (
          <dl>
            <dt className="text-sm text-foreground/65">
              {t('coast_label', { age: inputs.coastAge })}
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground sm:text-xl">
              {value}
            </dd>
          </dl>
        )}
        <div className="space-y-2 text-foreground/80">
          {body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function SavingsChart({
  plan,
  target,
  inputs,
  fmt,
  compact,
  startYear,
  reachedDate,
  t,
}: {
  plan: Extract<FireResult, { status: 'ok' }>;
  target: number;
  inputs: Inputs;
  fmt: (n: number) => string;
  compact: (n: number) => string;
  /** Calendar year today, or null before the visitor's date is known. */
  startYear: number | null;
  reachedDate: string;
  t: T;
}) {
  const palette = useChartPalette();
  // A few years past the FIRE date, so the crossing isn't at the edge.
  const years = Math.min(MAX_YEARS, Math.max(10, Math.ceil(plan.months / 12) + 5));
  const { savings, monthly, ret, age } = inputs;
  const points = useMemo(
    () => [{ year: 0, balance: savings }, ...project(savings, monthly, ret, years)],
    [savings, monthly, ret, years]
  );
  const reachedAge = age + plan.months / 12;
  const last = points[points.length - 1];

  const option = useMemo<EChartsCoreOption>(() => {
    const from = age;
    const to = age + years;
    return {
      grid: BASE_GRID,
      xAxis: {
        type: 'value' as const,
        min: from,
        max: to,
        minInterval: 1,
        axisLine: { lineStyle: { color: palette.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: palette.axisText, fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: { ...valueAxis(palette, compact), min: 0 },
      tooltip: {
        ...tooltipBase(palette),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: palette.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { seriesIndex: number; value: [number, number] }[];
          const point = items.find((item) => item.seriesIndex === 0);
          if (!point) return '';
          const [pointAge, balance] = point.value;
          const year = startYear === null ? null : startYear + (pointAge - from);
          return tooltipHtml(
            year === null
              ? `${t('col_age')} ${pointAge}`
              : t('chart_tooltip_age', { age: pointAge, year }),
            [
              { color: palette.blue, name: t('chart_savings'), value: fmt(balance) },
              { color: palette.orange, name: t('result_number'), value: fmt(target) },
            ]
          );
        },
      },
      series: [
        {
          name: t('chart_savings'),
          type: 'line' as const,
          data: points.map((p) => [from + p.year, p.balance]),
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { color: palette.blue, width: 2.5 },
          itemStyle: { color: palette.blue, borderColor: palette.surface, borderWidth: 2 },
          areaStyle: { color: palette.blue, opacity: 0.12 },
          emphasis: { disabled: true },
          z: 3,
        },
        {
          name: 'fire-number',
          type: 'line' as const,
          data: [
            [from, target],
            [to, target],
          ],
          showSymbol: false,
          silent: true,
          tooltip: { show: false },
          lineStyle: { color: palette.orange, width: 2, type: 'dashed' as const },
          emphasis: { disabled: true },
          z: 2,
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: palette.orange, type: 'dotted' as const, width: 1.5, opacity: 0.8 },
            data: [{ xAxis: reachedAge }],
          },
          markPoint: {
            silent: true,
            symbol: 'circle',
            symbolSize: 11,
            itemStyle: { color: palette.orange, borderColor: palette.surface, borderWidth: 2 },
            label: { show: false },
            data: [{ coord: [reachedAge, target] }],
          },
        },
      ],
    };
  }, [points, age, years, target, reachedAge, palette, fmt, compact, startYear, t]);

  return (
    <figure>
      <h3 className="mb-2 font-semibold text-foreground">{t('chart_heading')}</h3>
      <div className="rounded-xl border border-border/70 bg-card p-3 sm:p-4">
        <div className="h-[240px] sm:h-[300px]">
          <EChart
            option={option}
            ariaLabel={t('chart_label', {
              from: age,
              to: age + years,
              start: fmt(savings),
              end: fmt(last.balance),
              number: fmt(target),
              age: age + Math.floor(plan.months / 12),
            })}
          />
        </div>
        <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground/70">
          <span className="inline-flex items-center gap-2">
            <svg width="24" height="6" aria-hidden>
              <line x1="0" x2="24" y1="3" y2="3" stroke={palette.blue} strokeWidth={2.5} />
            </svg>
            <span className="text-foreground">{t('chart_savings')}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width="24" height="6" aria-hidden>
              <line
                x1="0"
                x2="24"
                y1="3"
                y2="3"
                stroke={palette.orange}
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
            </svg>
            <span>
              <span className="text-foreground">{t('chart_number', { number: fmt(target) })}</span>
              {reachedDate && (
                <>
                  {', '}
                  {t('chart_reached', { date: reachedDate })}
                </>
              )}
            </span>
          </span>
          <span>{t('chart_axis')}</span>
        </figcaption>
      </div>
    </figure>
  );
}

function YearTable({
  rows,
  savings,
  age,
  fmt,
  t,
}: {
  rows: YearRow[];
  savings: number;
  age: number;
  fmt: (n: number) => string;
  t: T;
}) {
  // Amounts show in whole units. Growth is derived from the rounded figures so
  // each row adds up on screen.
  let previous = Math.round(savings);
  return (
    <div className="overflow-x-auto border-t border-border/70">
      <table className="w-full min-w-max text-sm tabular-nums">
        <caption className="px-4 py-3 text-left text-foreground/65 sm:px-5">
          {t('table_caption')}
        </caption>
        <thead className="bg-muted/30 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('col_age')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('col_contributed')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('col_growth')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('col_balance')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const balance = Math.round(row.balance);
            const contributed = Math.round(row.contributed);
            const growth = balance - previous - contributed;
            previous = balance;
            return (
              <tr key={row.year} className="border-t border-border/50">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  {age + row.year}
                </th>
                <td className="px-3 py-1.5 text-right">{fmt(contributed)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(growth)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(balance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
