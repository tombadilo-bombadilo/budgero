/**
 * Debt payoff maths for the debt payoff calculator. Pure functions, no React.
 *
 * Model: every month each debt first gets interest of APR / 12 on its balance
 * (rounded to the cent), then its minimum payment. Whatever is left of the
 * monthly budget (the extra amount plus the minimums of debts already paid
 * off) goes to the first unpaid debt in strategy order, then the next one if
 * that debt is cleared. A payment never exceeds what is owed.
 *
 * All arithmetic runs in whole cents so results don't drift.
 */

export type Strategy = 'snowball' | 'avalanche';

export interface Debt {
  name: string;
  /** Current balance, in currency units. */
  balance: number;
  /** Annual percentage rate, e.g. 19.9 for 19.9%. */
  apr: number;
  /** Minimum monthly payment, in currency units. */
  minPayment: number;
}

/** Fifty years. Plans that take longer are reported, not simulated further. */
export const MAX_MONTHS = 600;

export interface DebtMonth {
  payment: number;
  interest: number;
  balance: number;
}

export interface ScheduleMonth {
  month: number;
  payment: number;
  interest: number;
  balance: number;
  debts: DebtMonth[];
}

export interface PayoffEvent {
  /** Index into the debts passed in. */
  index: number;
  name: string;
  month: number;
}

/** A debt whose minimum payment is smaller than its first month of interest. */
export interface MinimumShortfall {
  index: number;
  name: string;
  interest: number;
  minPayment: number;
  shortBy: number;
}

export type PlanResult =
  | { status: 'empty' }
  | { status: 'no-payment'; balance: number }
  | {
      status: 'never';
      /** Total of minimums plus extra. */
      monthlyPayment: number;
      /** Interest added in the first month across all debts. */
      monthlyInterest: number;
      /** How much the payment is below the interest. 0 means it only covers it. */
      shortBy: number;
    }
  | { status: 'too-long'; balanceAfter: number; totalInterest: number }
  | {
      status: 'ok';
      months: number;
      totalInterest: number;
      totalPaid: number;
      payoffOrder: PayoffEvent[];
      schedule: ScheduleMonth[];
    };

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

/** Interest for one month on a balance in cents, rounded to the cent. */
const monthlyInterest = (balanceCents: number, apr: number) =>
  Math.round((balanceCents * apr) / 1200);

/** True when a debt can take part in a plan: finite, not negative, something owed. */
export function isPlannable(debt: Debt) {
  return (
    Number.isFinite(debt.balance) &&
    Number.isFinite(debt.apr) &&
    Number.isFinite(debt.minPayment) &&
    debt.apr >= 0 &&
    debt.minPayment >= 0 &&
    toCents(debt.balance) > 0
  );
}

/**
 * The order in which a strategy targets debts with its extra money, as indexes.
 * Snowball: smallest balance first (ties: higher APR, then input order).
 * Avalanche: highest APR first (ties: smaller balance, then input order).
 */
export function strategyOrder(debts: Debt[], strategy: Strategy): number[] {
  const indexes = debts.map((_, index) => index);
  return indexes.sort((a, b) => {
    const A = debts[a];
    const B = debts[b];
    const byBalance = A.balance - B.balance;
    const byApr = B.apr - A.apr;
    if (strategy === 'snowball') return byBalance || byApr || a - b;
    return byApr || byBalance || a - b;
  });
}

/** Debts whose minimum payment doesn't cover their first month of interest. */
export function minimumShortfalls(debts: Debt[]): MinimumShortfall[] {
  const out: MinimumShortfall[] = [];
  debts.forEach((debt, index) => {
    if (!isPlannable(debt)) return;
    const interest = monthlyInterest(toCents(debt.balance), debt.apr);
    const min = toCents(debt.minPayment);
    if (interest > 0 && min <= interest) {
      out.push({
        index,
        name: debt.name,
        interest: fromCents(interest),
        minPayment: fromCents(min),
        shortBy: fromCents(interest - min),
      });
    }
  });
  return out;
}

/**
 * Simulates paying off `debts` with `extra` on top of the minimums.
 * Debts that aren't plannable (see isPlannable) must be filtered out by the
 * caller; passing them in is treated as an empty plan for those rows.
 */
export function planPayoff(debts: Debt[], extra: number, strategy: Strategy): PlanResult {
  const active = debts
    .map((debt, index) => ({ debt, index }))
    .filter(({ debt }) => isPlannable(debt));
  if (active.length === 0) return { status: 'empty' };

  const extraCents = Number.isFinite(extra) && extra > 0 ? toCents(extra) : 0;
  const balances = active.map(({ debt }) => toCents(debt.balance));
  const mins = active.map(({ debt }) => toCents(debt.minPayment));
  const aprs = active.map(({ debt }) => debt.apr);
  const budget = extraCents + mins.reduce((sum, min) => sum + min, 0);
  const startBalance = balances.reduce((sum, b) => sum + b, 0);

  if (budget === 0) return { status: 'no-payment', balance: fromCents(startBalance) };

  const firstInterest = balances.reduce((sum, b, i) => sum + monthlyInterest(b, aprs[i]), 0);
  if (budget <= firstInterest) {
    return {
      status: 'never',
      monthlyPayment: fromCents(budget),
      monthlyInterest: fromCents(firstInterest),
      shortBy: fromCents(firstInterest - budget),
    };
  }

  const order = strategyOrder(
    active.map(({ debt }) => debt),
    strategy
  );
  const schedule: ScheduleMonth[] = [];
  const payoffOrder: PayoffEvent[] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const interest = balances.map((b, i) => (b > 0 ? monthlyInterest(b, aprs[i]) : 0));
    const paid = balances.map(() => 0);
    let available = budget;

    for (let i = 0; i < balances.length; i++) {
      balances[i] += interest[i];
      if (balances[i] === 0) continue;
      const pay = Math.min(mins[i], balances[i], available);
      paid[i] += pay;
      balances[i] -= pay;
      available -= pay;
    }

    for (const i of order) {
      if (available === 0) break;
      if (balances[i] === 0) continue;
      const pay = Math.min(available, balances[i]);
      paid[i] += pay;
      balances[i] -= pay;
      available -= pay;
    }

    const monthInterest = interest.reduce((sum, x) => sum + x, 0);
    const monthPaid = paid.reduce((sum, x) => sum + x, 0);
    totalInterest += monthInterest;
    totalPaid += monthPaid;

    // Debts cleared this month, listed in the order the strategy targets them.
    for (const i of order) {
      if (
        balances[i] === 0 &&
        paid[i] > 0 &&
        !payoffOrder.some((e) => e.index === active[i].index)
      ) {
        payoffOrder.push({ index: active[i].index, name: active[i].debt.name, month });
      }
    }

    const remaining = balances.reduce((sum, b) => sum + b, 0);
    schedule.push({
      month,
      payment: fromCents(monthPaid),
      interest: fromCents(monthInterest),
      balance: fromCents(remaining),
      debts: balances.map((b, i) => ({
        payment: fromCents(paid[i]),
        interest: fromCents(interest[i]),
        balance: fromCents(b),
      })),
    });

    if (remaining === 0) {
      return {
        status: 'ok',
        months: month,
        totalInterest: fromCents(totalInterest),
        totalPaid: fromCents(totalPaid),
        payoffOrder,
        schedule,
      };
    }
  }

  return {
    status: 'too-long',
    balanceAfter: schedule[schedule.length - 1].balance,
    totalInterest: fromCents(totalInterest),
  };
}

/**
 * Reads a number typed by a person. Accepts plain digits with either `.` or
 * `,` as the decimal separator, and ignores spaces, apostrophes and grouping
 * separators. `decimalSeparator` (the visitor's locale) decides the ambiguous
 * case of a single separator followed by exactly three digits, like "1,250".
 * Returns NaN for anything that isn't a number, and null for an empty field.
 */
export function parseAmount(text: string, decimalSeparator: '.' | ',' = '.'): number | null {
  const cleaned = text.replace(/[\s  ']/g, '').replace(/%$/, '');
  if (cleaned === '') return null;
  if (!/^-?[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return Number.NaN;

  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;

  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = body.split(sep).length - 1;
    const digitsAfter = body.length - body.lastIndexOf(sep) - 1;
    if (count > 1)
      decimal = null; // "1.000.000": grouping only
    else if (digitsAfter === 3) decimal = sep === decimalSeparator ? sep : null;
    else decimal = sep;
  }

  const group = decimal === '.' ? ',' : decimal === ',' ? '.' : null;
  let normalized = body;
  if (group) normalized = normalized.split(group).join('');
  if (decimal === null) normalized = normalized.replace(/[.,]/g, '');
  else {
    // Grouping must not appear after the decimal separator ("1.5,3").
    const [whole, fraction, ...rest] = normalized.split(decimal);
    if (rest.length > 0 || (fraction ?? '').includes(group ?? '\0')) return Number.NaN;
    normalized = `${whole}.${fraction}`;
  }
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === '.') return Number.NaN;
  const value = Number(normalized);
  return negative ? -value : value;
}
