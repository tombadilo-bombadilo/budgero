import { formatDateISO } from '@shared/lib/date-utils';

/**
 * A monthly interest rate (fraction): one rate for the whole plan, or a
 * function of the month index when the account has scheduled rate changes
 * (see monthlyRateFn in core).
 */
export type MonthlyRate = number | ((monthIndex: number) => number);

const rateFn = (r: MonthlyRate): ((monthIndex: number) => number) =>
  typeof r === 'number' ? () => r : r;

/**
 * A balance this many times the start one is treated as never paid off. With
 * a per-month rate a payment that loses to one month's interest can still
 * win once the rate falls, so the loop decides; this stops a losing plan
 * long before the month cap (and before its rows reach absurd amounts).
 */
const DIVERGED_FACTOR = 10;

const MAX_PAYOFF_MONTHS = 360 * 5; // 30 years safety cap

export interface PayoffSummary {
  months: number | null;
  totalPaid?: number;
  interestPaid?: number;
}

/**
 * Fixed-payment payoff summary with no per-month rows — the fast path used
 * by the compact simulator. Closed-form at 0% APR; iterative otherwise.
 * `epsilon` guards the "fully paid" float comparison; callers keep their own
 * value rather than sharing one across sites with different precision needs.
 */
export function simulatePayoffSummary(
  Lstart: number,
  rMonthly: MonthlyRate,
  payment: number,
  epsilon = 1e-9
): PayoffSummary {
  let L = Lstart;
  if (L <= 0 || payment <= 0) return { months: 0, totalPaid: 0, interestPaid: 0 };
  const rate = rateFn(rMonthly);
  // If interest-only and payment can't reduce principal (one fixed rate only:
  // a rate that changes later may still let the payment win)
  if (typeof rMonthly === 'number' && rMonthly > 0 && payment <= L * rMonthly) {
    return { months: null };
  }
  // Zero interest simple case
  if (typeof rMonthly === 'number' && rMonthly <= 0) {
    const months = Math.ceil(L / payment);
    const totalPaid = (months - 1) * payment + (L - (months - 1) * payment);
    return { months, totalPaid, interestPaid: 0 };
  }
  let months = 0;
  let totalPaid = 0;
  while (L > 0 && months < MAX_PAYOFF_MONTHS) {
    const interest = L * rate(months);
    months++;
    const due = L + interest;
    const pay = Math.min(payment, due);
    totalPaid += pay;
    L = due - pay;
    if (pay >= due - epsilon) break; // paid off this month
    if (L > Lstart * DIVERGED_FACTOR) return { months: null };
  }
  if (months >= MAX_PAYOFF_MONTHS) return { months: null };
  const interestPaid = Math.max(0, totalPaid - Lstart);
  return { months, totalPaid, interestPaid };
}

export interface PayoffScheduleRow {
  i: number;
  dateISO: string;
  label: string;
  payment: number;
  interest: number;
  principal: number;
  remaining: number;
}

export interface PayoffSchedule extends PayoffSummary {
  rows: PayoffScheduleRow[];
}

/**
 * Full amortization schedule (per-month rows + totals), supporting a
 * recurring extra monthly payment and a one-time extra applied to the first
 * month. `epsilon` guards the "balance cleared" float comparison.
 */
export function buildPayoffSchedule(
  Lstart: number,
  rMonthly: MonthlyRate,
  basePayment: number,
  extraMonthly: number,
  oneTimeExtra: number,
  epsilon = 1e-7
): PayoffSchedule {
  const rows: PayoffScheduleRow[] = [];
  let L = Lstart;
  if (L <= 0 || basePayment <= 0) return { rows, months: 0, totalPaid: 0, interestPaid: 0 };
  const rate = rateFn(rMonthly);
  // Too low for one fixed rate; a changing rate is left to the loop (see simulatePayoffSummary).
  if (typeof rMonthly === 'number' && rMonthly > 0 && basePayment + extraMonthly <= L * rMonthly) {
    return { rows, months: null };
  }

  const start = new Date();
  let months = 0;
  let totalPaid = 0;
  while (L > 0 && months < MAX_PAYOFF_MONTHS) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + months);
    const interest = Math.max(0, L * rate(months));
    const planned = basePayment + extraMonthly + (months === 0 ? oneTimeExtra : 0);
    const due = L + interest;
    const pay = Math.min(planned, due);
    const principal = Math.max(0, pay - interest);
    const remaining = Math.max(0, due - pay);

    totalPaid += pay;
    rows.push({
      i: months + 1,
      dateISO: formatDateISO(d),
      label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
      payment: pay,
      interest,
      principal,
      remaining,
    });

    L = remaining;
    months++;
    if (remaining <= epsilon) break;
    if (L > Lstart * DIVERGED_FACTOR) return { rows: [], months: null };
  }
  // Never paid off: no rows, as when the payment is too low up front.
  if (months >= MAX_PAYOFF_MONTHS) return { rows: [], months: null };
  const interestPaid = Math.max(0, totalPaid - Lstart);
  return { rows, months, totalPaid, interestPaid };
}
