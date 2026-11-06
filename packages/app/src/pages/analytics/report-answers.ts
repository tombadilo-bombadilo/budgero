import { plural, t } from '@lingui/core/macro';
/**
 * Answer sentences: every report heading is a question, and directly under
 * it sits ONE plain-language sentence that answers it with the key number
 * inline. Pure functions over data the reports already compute; formatting
 * is injected so privacy masking and currency stay consistent with the page.
 */

import type { InsightFormat } from './insights';
import type { NetWorthPoint } from './analytics-model';

export type AnswerFormat = InsightFormat;

/** Share of a total as a whole percent; '<1%' for slivers. */
export function formatShare(amount: number, total: number): string {
  if (total <= 0 || amount <= 0) return '0%';
  const share = (amount / total) * 100;
  if (share < 1) return '<1%';
  return `${Math.round(share)}%`;
}

function percent(value: number): string {
  return String(Math.round(value));
}

export interface SpendingAnswerInput {
  /** Total spending in the period (milliunits). */
  total: number;
  /** First month of the period (YYYY-MM), or null when the axis is empty. */
  firstMonth: string | null;
  /** Largest entry of the chosen dimension with its share (0..1). */
  top: { name: string; share: number } | null;
}

export function spendingAnswer(input: SpendingAnswerInput, fmt: AnswerFormat): string {
  if (input.total <= 0) return t`Nothing was spent in this period.`;
  const amount = fmt.money(input.total);
  const since = input.firstMonth ? fmt.monthLabel(input.firstMonth) : null;
  if (input.top && input.top.share > 0) {
    const { name } = input.top;
    const share = percent(input.top.share * 100);
    return since
      ? t`You spent ${amount} since ${since} — ${name} took the most (${share}%).`
      : t`You spent ${amount} — ${name} took the most (${share}%).`;
  }
  return since ? t`You spent ${amount} since ${since}.` : t`You spent ${amount}.`;
}

export function wealthAnswer(points: NetWorthPoint[], fmt: AnswerFormat): string {
  const last = points.at(-1);
  if (!last || points.every((point) => point.assets === 0 && point.debt === 0)) {
    return t`There are no account balances in this period yet.`;
  }
  const current = fmt.money(last.netWorth);
  const first = points[0];
  if (points.length < 2) return t`Your net worth is ${current}.`;
  const change = last.netWorth - first.netWorth;
  const since = fmt.monthLabel(first.monthKey);
  const diff = fmt.money(Math.abs(change));
  if (change > 0) return t`Your net worth grew ${diff} since ${since}, to ${current}.`;
  if (change < 0) return t`Your net worth fell ${diff} since ${since}, to ${current}.`;
  return t`Your net worth held steady at ${current} since ${since}.`;
}

export interface FlowTotals {
  income: number;
  spending: number;
}

export function inOutAnswer(totals: FlowTotals, fmt: AnswerFormat): string {
  const { income, spending } = totals;
  if (income === 0 && spending === 0) return t`No money came in or went out in this period.`;
  if (income <= 0) {
    const spent = fmt.money(spending);
    return t`${spent} went out and no income came in.`;
  }
  const net = income - spending;
  const incomeText = fmt.money(income);
  if (net >= 0) {
    const kept = fmt.money(net);
    const rate = percent((net / income) * 100);
    return t`Yes — you kept ${kept} of the ${incomeText} that came in (${rate}% of income).`;
  }
  const over = fmt.money(-net);
  const rate = percent((-net / income) * 100);
  return t`Not quite — you spent ${over} more than the ${incomeText} that came in (${rate}% over).`;
}

export function flowAnswer(totals: FlowTotals, fmt: AnswerFormat): string {
  const { income, spending } = totals;
  if (income <= 0 && spending <= 0) return t`No income or spending to map in this period.`;
  const spent = fmt.money(spending);
  if (income <= 0) return t`${spent} went out with no income — all of it came from savings.`;
  const incomeText = fmt.money(income);
  const net = income - spending;
  if (net >= 0) {
    const rate = percent((net / income) * 100);
    return t`${incomeText} came in and ${spent} went out — you kept ${rate}%.`;
  }
  const gap = fmt.money(-net);
  return t`${incomeText} came in and ${spent} went out — ${gap} came from savings.`;
}

export interface PlanAnswerInput {
  assigned: number;
  spent: number;
}

export function planAnswer(input: PlanAnswerInput, fmt: AnswerFormat): string {
  const { assigned, spent } = input;
  if (assigned === 0 && spent === 0) return t`Nothing was assigned in this period yet.`;
  const spentText = fmt.money(spent);
  const assignedText = fmt.money(assigned);
  const slack = assigned - spent;
  if (slack >= 0) {
    const left = fmt.money(slack);
    return t`Yes — you spent ${spentText} of the ${assignedText} you assigned, and ${left} stayed in the plan.`;
  }
  const over = fmt.money(-slack);
  return t`Not quite — you spent ${over} more than the ${assignedText} you assigned.`;
}

export interface ScenarioAnswerInput {
  /** Balance at the end of the charted horizon (milliunits). */
  endBalance: number;
  horizon: number;
  /** First month the balance goes negative, if it ever does. */
  breakMonthKey: string | null;
  /** True when the break happens after the charted horizon. */
  breakBeyondChart: boolean;
}

export function scenarioAnswer(input: ScenarioAnswerInput, fmt: AnswerFormat): string {
  const end = fmt.money(input.endBalance);
  if (input.breakMonthKey && !input.breakBeyondChart) {
    const month = fmt.monthLabel(input.breakMonthKey);
    return t`Under this scenario your money runs out in ${month}.`;
  }
  if (input.breakMonthKey) {
    const month = fmt.monthLabel(input.breakMonthKey);
    return plural(input.horizon, {
      one: `In # month you would have ${end} left, but the money runs out in ${month}.`,
      other: `In # months you would have ${end} left, but the money runs out in ${month}.`,
    });
  }
  return plural(input.horizon, {
    one: `In # month you would have ${end} — the money lasts.`,
    other: `In # months you would have ${end} — the money lasts.`,
  });
}

export interface LedgerAnswerInput {
  /** Net income minus expense across every category (milliunits). */
  net: number;
  hasActivity: boolean;
}

export function ledgerAnswer(input: LedgerAnswerInput, fmt: AnswerFormat): string {
  if (!input.hasActivity) return t`No category activity in this period.`;
  const amount = fmt.money(Math.abs(input.net));
  if (input.net >= 0) return t`Across every category you came out ${amount} ahead.`;
  return t`Across every category you spent ${amount} more than came in.`;
}
