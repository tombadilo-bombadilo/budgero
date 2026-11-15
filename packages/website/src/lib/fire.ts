/**
 * FIRE (financial independence, retire early) maths for the FIRE calculator.
 * Pure functions, no React.
 *
 * Everything is in today's money: the return is the real return (after
 * inflation) and the spending is in today's prices, so no inflation figure is
 * needed. The yearly return compounds monthly at the rate that gives exactly
 * that return over a year, (1 + r)^(1/12) - 1. Each month the balance first
 * grows, then the monthly contribution is added at the end of the month.
 *
 * Balances run in whole cents so the year-by-year table adds up to the
 * headline numbers.
 */

/** Projections stop here. Longer ones are reported, not simulated further. */
export const MAX_YEARS = 80;
const MAX_MONTHS = MAX_YEARS * 12;

export interface YearRow {
  /** 1 for the first twelve months from today. */
  year: number;
  /** Contributions added during the year. */
  contributed: number;
  /** Growth (or loss) during the year. */
  growth: number;
  /** Balance at the end of the year. */
  balance: number;
}

export type FireResult =
  /** The savings already cover the FIRE number. */
  | { status: 'reached' }
  /** No money goes in and nothing grows, so the balance never changes. */
  | { status: 'never'; reason: 'nothing' | 'flat' }
  /** With a negative return the balance levels off below the FIRE number. */
  | { status: 'never'; reason: 'ceiling'; ceiling: number }
  | { status: 'too-long'; balanceAfter: number }
  | {
      status: 'ok';
      /** Months from today until the balance first reaches the FIRE number. */
      months: number;
      /** Full years up to and including the year the number is reached. */
      years: YearRow[];
    };

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

/** Yearly spending divided by the withdrawal rate (a percentage). */
export function fireNumber(yearlySpending: number, withdrawalRate: number) {
  return yearlySpending / (withdrawalRate / 100);
}

/** The monthly rate that compounds to `yearlyReturn` percent over twelve months. */
export function monthlyRate(yearlyReturn: number) {
  return Math.pow(1 + yearlyReturn / 100, 1 / 12) - 1;
}

/**
 * The amount that, invested today with nothing added, grows to `target` in
 * `years` years at `yearlyReturn` percent a year.
 */
export function coastNumber(target: number, yearlyReturn: number, years: number) {
  return target / Math.pow(1 + yearlyReturn / 100, years);
}

/**
 * Month-by-month balances in cents, from today. Calls `visit` after each month
 * and stops when it returns true or after `months` months.
 */
function simulate(
  savings: number,
  monthly: number,
  yearlyReturn: number,
  months: number,
  visit: (month: number, balance: number, growth: number, contribution: number) => boolean
) {
  const rate = monthlyRate(yearlyReturn);
  const contribution = toCents(monthly);
  let balance = toCents(savings);
  for (let month = 1; month <= months; month++) {
    const growth = Math.round(balance * rate);
    balance += growth + contribution;
    if (visit(month, balance, growth, contribution)) return balance;
  }
  return balance;
}

/** Year-by-year balances for `years` years from today. */
export function project(
  savings: number,
  monthly: number,
  yearlyReturn: number,
  years: number
): YearRow[] {
  const rows: YearRow[] = [];
  let contributed = 0;
  let growth = 0;
  simulate(savings, monthly, yearlyReturn, years * 12, (month, balance, g, c) => {
    contributed += c;
    growth += g;
    if (month % 12 === 0) {
      rows.push({
        year: month / 12,
        contributed: fromCents(contributed),
        growth: fromCents(growth),
        balance: fromCents(balance),
      });
      contributed = 0;
      growth = 0;
    }
    return false;
  });
  return rows;
}

/**
 * When `savings` plus `monthly` contributions first reach `target`.
 * All amounts must be finite and not negative, and `yearlyReturn` above -100.
 */
export function planFire(
  savings: number,
  monthly: number,
  yearlyReturn: number,
  target: number
): FireResult {
  const targetCents = toCents(target);
  if (toCents(savings) >= targetCents) return { status: 'reached' };

  const contribution = toCents(monthly);
  if (contribution === 0) {
    if (toCents(savings) === 0) return { status: 'never', reason: 'nothing' };
    if (yearlyReturn <= 0) return { status: 'never', reason: 'flat' };
  } else if (yearlyReturn < 0) {
    // The balance settles where monthly losses equal the contribution.
    const ceiling = monthly / -monthlyRate(yearlyReturn);
    if (ceiling <= target) return { status: 'never', reason: 'ceiling', ceiling };
  }

  let reached = 0;
  const balanceAfter = simulate(savings, monthly, yearlyReturn, MAX_MONTHS, (month, balance) => {
    if (balance >= targetCents) reached = month;
    return reached > 0;
  });
  if (reached === 0) return { status: 'too-long', balanceAfter: fromCents(balanceAfter) };

  return {
    status: 'ok',
    months: reached,
    years: project(savings, monthly, yearlyReturn, Math.ceil(reached / 12)),
  };
}

/**
 * The first month in which the balance is at or above the Coast FIRE number
 * for that moment, which grows as the target age gets closer. Null if that
 * doesn't happen before `yearsToTarget` years from now.
 */
export function coastCrossing(
  savings: number,
  monthly: number,
  yearlyReturn: number,
  target: number,
  yearsToTarget: number
): number | null {
  let crossed: number | null = null;
  simulate(savings, monthly, yearlyReturn, Math.floor(yearsToTarget * 12), (month, balance) => {
    const needed = coastNumber(target, yearlyReturn, yearsToTarget - month / 12);
    if (balance >= toCents(needed)) crossed = month;
    return crossed !== null;
  });
  return crossed;
}
