'use client';

import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  minimumShortfalls,
  parseAmount,
  planPayoff,
  type Debt,
  type PlanResult,
  type ScheduleMonth,
  type Strategy,
} from '@/lib/debt-payoff';

interface Row {
  id: number;
  name: string;
  balance: string;
  apr: string;
  min: string;
}

const MAX_ROWS = 20;

const EXAMPLE_ROWS: Row[] = [
  { id: 1, name: 'Credit card', balance: '9500', apr: '24.9', min: '240' },
  { id: 2, name: 'Car loan', balance: '7000', apr: '7', min: '210' },
  { id: 3, name: 'Personal loan', balance: '3000', apr: '11', min: '95' },
];
const EXAMPLE_EXTRA = '200';

type Field = 'balance' | 'apr' | 'min';
type FieldIssue = 'required' | 'number' | 'negative' | null;

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

function fieldIssue(value: number | null): FieldIssue {
  if (value === null) return 'required';
  if (Number.isNaN(value)) return 'number';
  if (value < 0) return 'negative';
  return null;
}

function inputClass(invalid: boolean) {
  return cn(
    'h-10 w-full rounded-md border bg-background px-3 text-base text-foreground shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring',
    invalid ? 'border-destructive' : 'border-border'
  );
}

export function DebtPayoffCalculator() {
  const t = useTranslations('debt_payoff_calculator');
  const locale = useBrowserLocale();
  const startMonth = useStartMonth();
  const baseId = useId();
  const [rows, setRows] = useState<Row[]>(EXAMPLE_ROWS);
  const [extra, setExtra] = useState(EXAMPLE_EXTRA);
  const [strategy, setStrategy] = useState<Strategy>('snowball');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const nextId = useRef(EXAMPLE_ROWS.length + 1);
  const tracked = useRef(false);

  const decimalSeparator = useMemo<'.' | ','>(() => {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  }, [locale]);
  const money = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale]
  );
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale]
  );
  const shortMonthFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    [locale]
  );
  const fmt = (value: number) => money.format(value);
  const monthDate = (month: number, format = monthFormat) => {
    if (startMonth === null) return t('month_number', { month });
    const index = startMonth + month;
    return format.format(Date.UTC(Math.floor(index / 12), index % 12, 1));
  };
  const duration = (total: number) => {
    const years = Math.floor(total / 12);
    const months = total % 12;
    return t('duration', { years, months, both: years > 0 && months > 0 ? 'yes' : 'no' });
  };

  const noteEdit = () => {
    if (tracked.current) return;
    tracked.current = true;
    // No figures are sent, only that the calculator was used.
    track('Debt Calculator - Edited');
  };

  const parsed = useMemo(
    () =>
      rows.map((row, i) => {
        const balance = parseAmount(row.balance, decimalSeparator);
        const apr = parseAmount(row.apr, decimalSeparator);
        const min = parseAmount(row.min, decimalSeparator);
        const blank = !row.name.trim() && balance === null && apr === null && min === null;
        const issues: Record<Field, FieldIssue> = {
          balance: fieldIssue(balance),
          apr: fieldIssue(apr),
          min: fieldIssue(min),
        };
        const valid = !blank && !issues.balance && !issues.apr && !issues.min;
        const debt: Debt = {
          name: row.name.trim() || t('default_name', { number: i + 1 }),
          balance: valid ? (balance as number) : Number.NaN,
          apr: valid ? (apr as number) : Number.NaN,
          minPayment: valid ? (min as number) : Number.NaN,
        };
        return { blank, issues, valid, debt, zero: valid && Math.round(debt.balance * 100) === 0 };
      }),
    [rows, decimalSeparator, t]
  );

  const extraValue = parseAmount(extra, decimalSeparator);
  const extraIssue: FieldIssue = extraValue === null ? null : fieldIssue(extraValue);
  const extraAmount = extraIssue || extraValue === null ? 0 : extraValue;

  const debts = useMemo(() => parsed.map((p) => p.debt), [parsed]);
  const leftOut = parsed.filter((p) => !p.blank && !p.valid).length;

  const plans = useMemo(
    () => ({
      snowball: planPayoff(debts, extraAmount, 'snowball'),
      avalanche: planPayoff(debts, extraAmount, 'avalanche'),
    }),
    [debts, extraAmount]
  );
  const plan = plans[strategy];
  const shortfalls = useMemo(() => minimumShortfalls(debts), [debts]);

  const updateRow = (id: number, patch: Partial<Row>) => {
    noteEdit();
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const addRow = () => {
    noteEdit();
    const id = nextId.current++;
    setRows((current) =>
      current.length >= MAX_ROWS
        ? current
        : [...current, { id, name: '', balance: '', apr: '', min: '' }]
    );
  };
  const removeRow = (id: number) => {
    noteEdit();
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const issueText = (field: Field, issue: FieldIssue) => {
    if (issue === 'required') {
      return t(
        field === 'balance'
          ? 'error_balance_required'
          : field === 'apr'
            ? 'error_apr_required'
            : 'error_min_required'
      );
    }
    if (issue === 'number') return t('error_number');
    if (issue === 'negative') return t('error_negative');
    return null;
  };

  const fields: { field: Field; label: string; mode: 'decimal' }[] = [
    { field: 'balance', label: t('label_balance'), mode: 'decimal' },
    { field: 'apr', label: t('label_apr'), mode: 'decimal' },
    { field: 'min', label: t('label_min'), mode: 'decimal' },
  ];

  return (
    <div className="space-y-10">
      {/* Inputs */}
      <section aria-labelledby={`${baseId}-debts`} className="space-y-4">
        <div>
          <h2 id={`${baseId}-debts`} className="text-2xl font-bold text-foreground">
            {t('debts_heading')}
          </h2>
          <p className="mt-1 text-sm text-foreground/65">{t('example_note')}</p>
        </div>

        <div className="space-y-4">
          {rows.map((row, i) => {
            const state = parsed[i];
            const rowId = `${baseId}-row-${row.id}`;
            return (
              <fieldset
                key={row.id}
                className="rounded-xl border border-border/70 bg-card p-4 sm:p-5"
              >
                <legend className="sr-only">{t('debt_legend', { number: i + 1 })}</legend>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto] lg:items-start">
                  <div className="space-y-1.5">
                    <label htmlFor={`${rowId}-name`} className="block text-sm font-medium">
                      {t('label_name')}
                    </label>
                    <input
                      id={`${rowId}-name`}
                      type="text"
                      autoComplete="off"
                      value={row.name}
                      placeholder={t('default_name', { number: i + 1 })}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                      className={inputClass(false)}
                    />
                  </div>
                  {fields.map(({ field, label, mode }) => {
                    const issue = state.blank ? null : state.issues[field];
                    const message = issueText(field, issue);
                    const inputId = `${rowId}-${field}`;
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
                          value={row[field]}
                          onChange={(e) => updateRow(row.id, { [field]: e.target.value })}
                          aria-invalid={message ? true : undefined}
                          aria-describedby={message ? `${inputId}-error` : undefined}
                          className={cn(inputClass(Boolean(message)), 'tabular-nums')}
                        />
                        {message && (
                          <p id={`${inputId}-error`} className="text-sm text-destructive">
                            {message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-end lg:h-full lg:pt-6">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(row.id)}
                      aria-label={t('remove_debt', { name: state.debt.name })}
                      className="text-foreground/70"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                {state.zero && (
                  <p className="mt-3 text-sm text-foreground/65">{t('note_zero_balance')}</p>
                )}
              </fieldset>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            disabled={rows.length >= MAX_ROWS}
          >
            <Plus className="size-4" aria-hidden /> {t('add_debt')}
          </Button>
          {rows.length >= MAX_ROWS && (
            <p className="text-sm text-foreground/65">{t('max_debts', { count: MAX_ROWS })}</p>
          )}
        </div>

        <div className="grid gap-6 rounded-xl border border-border/70 bg-card p-4 sm:p-5 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-extra`} className="block text-sm font-medium">
              {t('label_extra')}
            </label>
            <input
              id={`${baseId}-extra`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={extra}
              onChange={(e) => {
                noteEdit();
                setExtra(e.target.value);
              }}
              aria-invalid={extraIssue ? true : undefined}
              aria-describedby={`${baseId}-extra-help`}
              className={cn(inputClass(Boolean(extraIssue)), 'tabular-nums')}
            />
            <p id={`${baseId}-extra-help`} className="text-sm text-foreground/65">
              {extraIssue ? (
                <span className="text-destructive">{issueText('balance', extraIssue)}</span>
              ) : (
                t('help_extra')
              )}
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">{t('strategy_legend')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['snowball', 'avalanche'] as const).map((option) => (
                <label
                  key={option}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                    strategy === option
                      ? 'border-foreground bg-muted/40'
                      : 'border-border hover:bg-muted/20'
                  )}
                >
                  <input
                    type="radio"
                    name={`${baseId}-strategy`}
                    value={option}
                    checked={strategy === option}
                    onChange={() => {
                      noteEdit();
                      setStrategy(option);
                    }}
                    className="mt-1 accent-foreground"
                  />
                  <span>
                    <span className="block font-medium">{t(`strategy_${option}`)}</span>
                    <span className="block text-sm text-foreground/65">
                      {t(`strategy_${option}_hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {leftOut > 0 && (
          <p className="text-sm text-destructive" role="status">
            {t('rows_left_out', { count: leftOut })}
          </p>
        )}
      </section>

      {/* Results */}
      <section aria-labelledby={`${baseId}-results`} className="space-y-6">
        <h2 id={`${baseId}-results`} className="text-2xl font-bold text-foreground">
          {t('results_heading')}
        </h2>

        {shortfalls.length > 0 && (
          <ul className="space-y-2">
            {shortfalls.map((s) => (
              <li
                key={s.index}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
              >
                {t('warning_min_short', {
                  name: s.name,
                  min: fmt(s.minPayment),
                  interest: fmt(s.interest),
                  short: fmt(s.shortBy),
                })}
              </li>
            ))}
          </ul>
        )}

        <PlanSummary
          plan={plan}
          fmt={fmt}
          duration={duration}
          monthDate={monthDate}
          hasDate={startMonth !== null}
          t={t}
        />

        {plans.snowball.status !== 'empty' &&
          plans.snowball.status !== 'no-payment' &&
          plans.snowball.status !== 'never' && (
            <Comparison
              snowball={plans.snowball}
              avalanche={plans.avalanche}
              strategy={strategy}
              fmt={fmt}
              monthDate={monthDate}
              t={t}
            />
          )}

        {plans.snowball.status === 'ok' && plans.avalanche.status === 'ok' && (
          <BalanceChart
            snowball={plans.snowball.schedule}
            avalanche={plans.avalanche.schedule}
            strategy={strategy}
            t={t}
          />
        )}

        {plan.status === 'ok' && (
          <details
            className="rounded-xl border border-border/70 bg-card"
            onToggle={(e) => setScheduleOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer p-4 font-medium sm:p-5">
              {t('schedule_summary', { months: plan.months })}
            </summary>
            {scheduleOpen && (
              <div className="overflow-x-auto border-t border-border/70">
                <table className="w-full min-w-max text-sm tabular-nums">
                  <caption className="px-4 py-3 text-left text-foreground/65 sm:px-5">
                    {t('schedule_caption')}
                  </caption>
                  <thead className="bg-muted/30 text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('col_month')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('col_date')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('col_paid')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('col_interest')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('col_left')}
                      </th>
                      {parsed.map((p, i) =>
                        p.valid && !p.zero ? (
                          <th
                            key={rows[i].id}
                            scope="col"
                            className="px-3 py-2 text-right font-medium"
                          >
                            {p.debt.name}
                          </th>
                        ) : null
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.schedule.map((m: ScheduleMonth) => (
                      <tr key={m.month} className="border-t border-border/50">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal">
                          {m.month}
                        </th>
                        <td className="px-3 py-1.5">{monthDate(m.month, shortMonthFormat)}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(m.payment)}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(m.interest)}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(m.balance)}</td>
                        {m.debts.map((d, i) => (
                          <td key={i} className="px-3 py-1.5 text-right text-foreground/75">
                            {fmt(d.balance)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        )}
      </section>
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function PlanSummary({
  plan,
  fmt,
  duration,
  monthDate,
  hasDate,
  t,
}: {
  plan: PlanResult;
  fmt: (n: number) => string;
  duration: (months: number) => string;
  monthDate: (month: number) => string;
  hasDate: boolean;
  t: T;
}) {
  if (plan.status === 'empty' || plan.status === 'no-payment') {
    return (
      <p className="rounded-xl border border-border/70 bg-muted/20 p-5 text-foreground/75">
        {t(plan.status === 'empty' ? 'empty' : 'no_payment')}
      </p>
    );
  }
  if (plan.status === 'never') {
    const values = {
      payment: fmt(plan.monthlyPayment),
      interest: fmt(plan.monthlyInterest),
      short: fmt(plan.shortBy),
    };
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
        <h3 className="font-semibold text-foreground">{t('never_title')}</h3>
        <p className="mt-2 text-foreground/75">
          {plan.shortBy > 0 ? t('never_short', values) : t('never_equal', values)}{' '}
          {t('never_need', { need: fmt(plan.shortBy + 0.01) })}
        </p>
      </div>
    );
  }
  if (plan.status === 'too-long') {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
        <h3 className="font-semibold text-foreground">{t('too_long_title')}</h3>
        <p className="mt-2 text-foreground/75">
          {t('too_long_body', { balance: fmt(plan.balanceAfter) })}
        </p>
      </div>
    );
  }

  const stats = [
    { label: t('result_debt_free'), value: monthDate(plan.months) },
    { label: t('result_time'), value: duration(plan.months) },
    { label: t('result_interest'), value: fmt(plan.totalInterest) },
    { label: t('result_paid'), value: fmt(plan.totalPaid) },
  ];

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/70 bg-card p-4">
            <dt className="text-sm text-foreground/65">{stat.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground sm:text-xl">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="mb-2 font-semibold text-foreground">{t('order_heading')}</h3>
        <ol className="list-decimal space-y-1 pl-6 text-foreground/80">
          {plan.payoffOrder.map((event) => (
            <li key={event.index}>
              {hasDate
                ? t('order_item', {
                    name: event.name,
                    date: monthDate(event.month),
                    month: event.month,
                  })
                : t('order_item_no_date', { name: event.name, month: event.month })}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

type Finished = Extract<PlanResult, { status: 'ok' } | { status: 'too-long' }>;

function Comparison({
  snowball,
  avalanche,
  strategy,
  fmt,
  monthDate,
  t,
}: {
  snowball: Finished;
  avalanche: PlanResult;
  strategy: Strategy;
  fmt: (n: number) => string;
  monthDate: (month: number) => string;
  t: T;
}) {
  if (avalanche.status !== 'ok' && avalanche.status !== 'too-long') return null;
  const rows = [
    { key: 'snowball' as const, plan: snowball },
    { key: 'avalanche' as const, plan: avalanche },
  ];

  let summary: string | null = null;
  if (snowball.status === 'ok' && avalanche.status === 'ok') {
    const saved = Math.round((snowball.totalInterest - avalanche.totalInterest) * 100) / 100;
    const monthGap = snowball.months - avalanche.months;
    const finish = monthGap === 0 ? 'same' : monthGap > 0 ? 'avalanche' : 'snowball';
    if (saved > 0) {
      summary = t('compare_saves', { interest: fmt(saved), finish, months: Math.abs(monthGap) });
    } else if (saved === 0 && monthGap === 0) {
      summary = t('compare_same');
    } else if (saved === 0) {
      summary = t('compare_months_only', { finish, months: Math.abs(monthGap) });
    }
  }

  return (
    <div>
      <h3 className="mb-2 font-semibold text-foreground">{t('compare_heading')}</h3>
      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full min-w-max text-sm tabular-nums">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('compare_method')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('result_debt_free')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('compare_months')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('result_interest')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, plan }) => {
              const name = t(`strategy_${key}`);
              return (
                <tr
                  key={key}
                  className={cn('border-t border-border/50', key === strategy && 'bg-muted/20')}
                >
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {key === strategy ? t('compare_current', { method: name }) : name}
                  </th>
                  {plan.status === 'ok' ? (
                    <>
                      <td className="px-4 py-2">{monthDate(plan.months)}</td>
                      <td className="px-4 py-2 text-right">{plan.months}</td>
                      <td className="px-4 py-2 text-right">{fmt(plan.totalInterest)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="px-4 py-2 text-foreground/70">
                      {t('compare_not_finished')}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {summary && <p className="mt-3 text-foreground/80">{summary}</p>}
    </div>
  );
}

function BalanceChart({
  snowball,
  avalanche,
  strategy,
  t,
}: {
  snowball: ScheduleMonth[];
  avalanche: ScheduleMonth[];
  strategy: Strategy;
  t: T;
}) {
  const width = 640;
  const height = 220;
  const pad = { top: 12, right: 12, bottom: 28, left: 12 };
  const start = snowball[0].balance + snowball[0].payment - snowball[0].interest;
  const months = Math.max(snowball.length, avalanche.length);
  const x = (month: number) => pad.left + (month / months) * (width - pad.left - pad.right);
  const y = (balance: number) => pad.top + (1 - balance / start) * (height - pad.top - pad.bottom);
  const path = (schedule: ScheduleMonth[]) =>
    [`M${x(0)},${y(start)}`, ...schedule.map((m) => `L${x(m.month)},${y(m.balance)}`)].join(' ');
  const ticks = Array.from(new Set([0, Math.round(months / 2), months]));
  const lines = [
    { key: 'snowball' as const, d: path(snowball) },
    { key: 'avalanche' as const, d: path(avalanche) },
  ];

  return (
    <figure>
      <h3 className="mb-2 font-semibold text-foreground">{t('chart_heading')}</h3>
      <div className="rounded-xl border border-border/70 bg-card p-3 sm:p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full text-foreground"
          role="img"
          aria-label={t('chart_label', {
            snowball: snowball.length,
            avalanche: avalanche.length,
          })}
        >
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            stroke="currentColor"
            strokeOpacity={0.25}
          />
          {ticks.map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={height - 8}
              fontSize={12}
              fill="currentColor"
              fillOpacity={0.6}
              textAnchor={tick === 0 ? 'start' : tick === months ? 'end' : 'middle'}
            >
              {tick}
            </text>
          ))}
          {lines.map((line) => (
            <path
              key={line.key}
              d={line.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={line.key === strategy ? 2.5 : 1.5}
              strokeOpacity={line.key === strategy ? 1 : 0.45}
              strokeDasharray={line.key === 'avalanche' ? '6 4' : undefined}
            />
          ))}
        </svg>
        <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground/70">
          {lines.map((line) => (
            <span key={line.key} className="inline-flex items-center gap-2">
              <svg width="24" height="6" aria-hidden className="text-foreground">
                <line
                  x1="0"
                  x2="24"
                  y1="3"
                  y2="3"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray={line.key === 'avalanche' ? '6 4' : undefined}
                />
              </svg>
              {t(`strategy_${line.key}`)}
            </span>
          ))}
          <span>{t('chart_axis', { months })}</span>
        </figcaption>
      </div>
    </figure>
  );
}
