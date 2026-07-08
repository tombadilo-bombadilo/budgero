import { formatDateISO } from '@shared/lib/date-utils';

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
  rMonthly: number,
  payment: number,
  epsilon = 1e-9
): PayoffSummary {
  let L = Lstart;
  if (L <= 0 || payment <= 0) return { months: 0, totalPaid: 0, interestPaid: 0 };
  // If interest-only and payment can't reduce principal
  if (rMonthly > 0 && payment <= L * rMonthly) return { months: null };
  // Zero interest simple case
  if (rMonthly <= 0) {
    const months = Math.ceil(L / payment);
    const totalPaid = (months - 1) * payment + (L - (months - 1) * payment);
    return { months, totalPaid, interestPaid: 0 };
  }
  let months = 0;
  let totalPaid = 0;
  while (L > 0 && months < MAX_PAYOFF_MONTHS) {
    months++;
    const interest = L * rMonthly;
    const due = L + interest;
    const pay = Math.min(payment, due);
    totalPaid += pay;
    L = due - pay;
    if (pay >= due - epsilon) break; // paid off this month
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
  rMonthly: number,
  basePayment: number,
  extraMonthly: number,
  oneTimeExtra: number,
  epsilon = 1e-7
): PayoffSchedule {
  const rows: PayoffScheduleRow[] = [];
  let L = Lstart;
  if (L <= 0 || basePayment <= 0) return { rows, months: 0, totalPaid: 0, interestPaid: 0 };
  if (rMonthly > 0 && basePayment + extraMonthly <= L * rMonthly) return { rows, months: null };

  const start = new Date();
  let months = 0;
  let totalPaid = 0;
  while (L > 0 && months < MAX_PAYOFF_MONTHS) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + months);
    const interest = Math.max(0, L * rMonthly);
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
  }
  if (months >= MAX_PAYOFF_MONTHS) return { rows, months: null };
  const interestPaid = Math.max(0, totalPaid - Lstart);
  return { rows, months, totalPaid, interestPaid };
}
