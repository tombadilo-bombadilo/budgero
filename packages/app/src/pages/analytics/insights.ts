/**
 * Insight sentences: plain-language findings computed from the report
 * models. Each builder returns at most three short sentences, best first;
 * an empty array means "nothing worth saying" (never pad). Formatting is
 * injected so masking/currency stay consistent with the page.
 */

import type {
  MonthlyFlowPoint,
  NetWorthPoint,
  PlanVsReality,
  TrendSeries,
} from './analytics-model';
import type { LinearForecast } from './forecast';

export interface Insight {
  /** 'good' | 'warn' | 'neutral' — drives the marker color only. */
  tone: 'good' | 'warn' | 'neutral';
  text: string;
}

export interface InsightFormat {
  money: (milli: number) => string;
  monthLabel: (monthKey: string) => string;
}

export function wealthInsights(
  points: NetWorthPoint[],
  forecast: LinearForecast | null,
  fmt: InsightFormat
): Insight[] {
  const insights: Insight[] = [];
  if (points.length < 2) return insights;
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.netWorth - first.netWorth;
  const perMonth = Math.round(change / (points.length - 1));
  if (change !== 0) {
    insights.push({
      tone: change > 0 ? 'good' : 'warn',
      text: `Net worth ${change > 0 ? 'grew' : 'fell'} ${fmt.money(Math.abs(change))} since ${fmt.monthLabel(first.monthKey)} — about ${fmt.money(Math.abs(perMonth))}/month.`,
    });
  }
  if (last.debt > 0 && points.length >= 2) {
    const debtChange = last.debt - first.debt;
    if (Math.abs(debtChange) > 0) {
      insights.push({
        tone: debtChange < 0 ? 'good' : 'warn',
        text: `Debt is ${debtChange < 0 ? 'down' : 'up'} ${fmt.money(Math.abs(debtChange))} over the period.`,
      });
    }
  }
  if (forecast) {
    if (forecast.pValue < 0.05) {
      insights.push({
        tone: forecast.slope >= 0 ? 'good' : 'warn',
        text: `The trend is statistically solid (p = ${formatP(forecast.pValue)}, R² = ${forecast.rSquared.toFixed(2)}): ${fmt.money(Math.round(Math.abs(forecast.slope)))}/month ${forecast.slope >= 0 ? 'upward' : 'downward'}.`,
      });
    } else {
      insights.push({
        tone: 'neutral',
        text: `No statistically reliable trend yet (p = ${formatP(forecast.pValue)}) — the forecast band is honest about that.`,
      });
    }
  }
  return insights.slice(0, 3);
}

export function inOutInsights(
  points: MonthlyFlowPoint[],
  savingsTargetPct: number | null,
  fmt: InsightFormat
): Insight[] {
  const insights: Insight[] = [];
  const withIncome = points.filter((point) => point.income > 0);
  if (withIncome.length === 0) return insights;
  const totalIncome = points.reduce((sum, point) => sum + point.income, 0);
  const totalNet = points.reduce((sum, point) => sum + point.net, 0);
  const rate = totalIncome > 0 ? totalNet / totalIncome : 0;
  insights.push({
    tone: rate >= 0.1 ? 'good' : rate >= 0 ? 'neutral' : 'warn',
    text:
      rate >= 0
        ? `You kept ${(rate * 100).toFixed(0)}% of income over this period.`
        : `You spent ${Math.abs(rate * 100).toFixed(0)}% more than you earned over this period.`,
  });
  if (savingsTargetPct !== null && totalIncome > 0) {
    const hit = withIncome.filter(
      (point) => point.income > 0 && point.net / point.income >= savingsTargetPct / 100
    ).length;
    insights.push({
      tone: hit >= withIncome.length / 2 ? 'good' : 'warn',
      text: `Savings target of ${savingsTargetPct}% was met in ${hit} of ${withIncome.length} months.`,
    });
  }
  const negativeMonths = points.filter((point) => point.net < 0);
  if (negativeMonths.length > 0 && negativeMonths.length <= points.length / 2) {
    const worst = negativeMonths.reduce((a, b) => (a.net < b.net ? a : b));
    insights.push({
      tone: 'warn',
      text: `${negativeMonths.length} negative ${negativeMonths.length === 1 ? 'month' : 'months'}; the deepest was ${fmt.monthLabel(worst.monthKey)} (${fmt.money(worst.net)}).`,
    });
  }
  return insights.slice(0, 3);
}

export function spendingInsights(series: TrendSeries[], fmt: InsightFormat): Insight[] {
  const insights: Insight[] = [];
  const real = series.filter((entry) => entry.key !== 'other');
  if (real.length === 0) return insights;
  const total = series.reduce((sum, entry) => sum + entry.total, 0);
  const top = real[0];
  if (total > 0) {
    insights.push({
      tone: 'neutral',
      text: `${top.name} leads at ${((top.total / total) * 100).toFixed(0)}% of spending (${fmt.money(top.total)}).`,
    });
  }
  // Momentum: compare each series' last-3-month average to its prior average.
  const monthCount = top.values.length;
  if (monthCount >= 6) {
    let best: { name: string; ratio: number } | null = null;
    for (const entry of real) {
      const recent = average(entry.values.slice(-3));
      const before = average(entry.values.slice(0, -3));
      if (before > 0 && recent > before * 1.25 && (!best || recent / before > best.ratio)) {
        best = { name: entry.name, ratio: recent / before };
      }
    }
    if (best) {
      insights.push({
        tone: 'warn',
        text: `${best.name} is accelerating — recent months run ${Math.round((best.ratio - 1) * 100)}% above its earlier average.`,
      });
    }
  }
  return insights.slice(0, 3);
}

export function planInsights(plan: PlanVsReality, fmt: InsightFormat): Insight[] {
  const insights: Insight[] = [];
  if (plan.totalAssigned <= 0) return insights;
  const usage = plan.totalSpent / plan.totalAssigned;
  insights.push({
    tone: usage <= 1 ? 'good' : 'warn',
    text:
      usage <= 1
        ? `Spending ran at ${(usage * 100).toFixed(0)}% of plan — ${fmt.money(plan.totalAssigned - plan.totalSpent)} of assigned money went unspent.`
        : `Spending overran the plan by ${fmt.money(plan.totalSpent - plan.totalAssigned)} (${(usage * 100).toFixed(0)}% of assigned).`,
  });
  insights.push({
    tone: plan.monthsOnPlan >= 0.5 ? 'good' : 'warn',
    text: `${Math.round(plan.monthsOnPlan * 100)}% of months closed within plan.`,
  });
  // A habitual overspender beats a one-off blowout as the third finding.
  const chronic = [...plan.categories]
    .filter((row) => row.chronic)
    .sort(
      (a, b) =>
        b.monthsOver / b.monthsWithPlan - a.monthsOver / a.monthsWithPlan ||
        b.monthsOver - a.monthsOver
    )[0];
  if (chronic) {
    insights.push({
      tone: 'warn',
      text: `${chronic.name} runs over its assignment almost every month — ${chronic.monthsOver} of ${chronic.monthsWithPlan} planned months. The assignment may be set too low.`,
    });
  } else {
    const leak = plan.categories.find(
      (row) => row.usage !== null && row.usage > 1.2 && row.spent - row.assigned > 0
    );
    if (leak) {
      insights.push({
        tone: 'warn',
        text: `Biggest leak: ${leak.name}, ${fmt.money(leak.spent - leak.assigned)} over its assignment.`,
      });
    }
  }
  return insights.slice(0, 3);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function formatP(p: number): string {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}
