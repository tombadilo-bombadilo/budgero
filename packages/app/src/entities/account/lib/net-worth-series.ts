import type { Account, BalanceHistoryRow } from '@budgero/core/browser';
import {
  eachDayOfInterval,
  eachMonthOfInterval,
  isAfter,
  isBefore,
  parseISO,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { formatDate as format } from '@shared/lib/date-format';
import { LIABILITY_ACCOUNT_TYPES } from '@entities/account/model/accountTypes';
import {
  computeDailyBalances,
  groupTransactionsByAccount,
  type HistoryTransaction,
} from '@entities/account/lib/history';

// The two account-page series (daily net worth, monthly asset/liability mix).
// The math is unchanged from when the hooks folded every transaction of the
// budget; they now feed it per-day / per-month aggregates of the same rows
// (`getBalanceHistoryRows`), which give the same sums on every date.

export type HistoryLedgerRow = HistoryTransaction & { AccountId: number };

type SeriesAccount = Pick<Account, 'ID' | 'Type' | 'BalanceNative' | 'BalanceConverted'>;

export interface NetWorthPoint {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

/** All amounts are integer milliunits (sums of stored transaction amounts). */
export interface MonthlyAssetPoint {
  month: string; // YYYY-MM format
  label: string; // Display label like "Jan '24"
  // Assets
  cash: number;
  investments: number;
  crypto: number;
  retirement: number;
  realEstate: number;
  otherAssets: number;
  // Liabilities (stored as positive values for stacking)
  credit: number;
  loans: number;
  // Totals
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface RevaluationLedgerRow {
  AccountID: number;
  Date: string;
  DeltaConverted: number;
}

const ACCOUNT_TYPE_CATEGORY: Record<string, string> = {
  Checking: 'cash',
  Savings: 'cash',
  Cash: 'cash',
  Credit: 'credit',
  Loan: 'loans',
  Mortgage: 'loans',
  'Real Estate': 'realEstate',
  'Other Asset': 'otherAssets',
  Investment: 'investments',
  Crypto: 'crypto',
  Retirement: 'retirement',
};

/** Aggregated rows in the shape the series math reads (net as the inflow). */
export function balanceRowsToLedger(rows: BalanceHistoryRow[]): HistoryLedgerRow[] {
  return rows.map((row) => ({
    AccountId: row.AccountId,
    Date: row.Date,
    InflowConverted: row.Net,
    OutflowConverted: 0,
  }));
}

/** First day (yyyy-MM-dd) of the daily net-worth window for `periodMonths`. */
export function netWorthWindowStart(periodMonths: number, now = new Date()): string {
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - periodMonths);
  return format(startDate, 'yyyy-MM-dd');
}

/** First day (yyyy-MM-dd) of the monthly asset window for `months`. */
export function monthlyAssetWindowStart(months: number, now = new Date()): string {
  return format(subMonths(startOfMonth(now), months - 1), 'yyyy-MM-dd');
}

/**
 * Daily net worth over the last `periodMonths` months: each account's balance
 * on each day (today: its stored balance), liabilities as absolute values.
 */
export function buildNetWorthHistory(
  accounts: SeriesAccount[],
  allTransactions: HistoryLedgerRow[],
  periodMonths: number
): NetWorthPoint[] {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - periodMonths);

  const transactionsByAccount = groupTransactionsByAccount(allTransactions);

  const accountHistories = new Map<number, { date: string; balance: number }[]>();

  for (const account of accounts) {
    const accountTransactions = transactionsByAccount.get(account.ID) || [];

    const sortedTransactions = [...accountTransactions].sort(
      (a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime()
    );

    const earliestTxDate =
      sortedTransactions.length > 0 ? parseISO(sortedTransactions[0].Date) : endDate;

    // Only calculate history from the start of our period OR the first transaction, whichever is later
    const accountStartDate = isAfter(startDate, earliestTxDate) ? startDate : earliestTxDate;

    // If the account has no transactions in our time period, skip it or use current balance only for today
    if (isAfter(accountStartDate, endDate) || sortedTransactions.length === 0) {
      // Account has no transactions in our period - only show current balance for today if it exists
      if (account.BalanceNative !== null && account.BalanceNative !== undefined) {
        accountHistories.set(account.ID, [
          {
            date: format(endDate, 'yyyy-MM-dd'),
            balance: account.BalanceConverted ?? account.BalanceNative ?? 0,
          },
        ]);
      }
      continue;
    }

    accountHistories.set(
      account.ID,
      computeDailyBalances(sortedTransactions, accountStartDate, endDate)
    );
  }

  const dates = eachDayOfInterval({ start: startDate, end: endDate });

  const netWorthHistory: NetWorthPoint[] = dates.map((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    let totalAssets = 0;
    let totalLiabilities = 0;

    for (const account of accounts) {
      const accountHistory = accountHistories.get(account.ID);
      const balancePoint = accountHistory?.find((point) => point.date === dateStr);

      if (balancePoint) {
        const currentAccountBalance = account.BalanceConverted ?? account.BalanceNative ?? 0;
        const calculatedBalance = balancePoint.balance;

        // If this is today's date, use the account's converted balance
        // Otherwise use the calculated historical balance (which may need conversion applied)
        const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
        const balance = isToday ? currentAccountBalance : calculatedBalance;

        const isLiability = LIABILITY_ACCOUNT_TYPES.has(account.Type || '');

        if (isLiability) {
          totalLiabilities += Math.abs(balance);
        } else {
          totalAssets += balance;
        }
      }
    }

    return {
      date: dateStr,
      netWorth: totalAssets - totalLiabilities,
      totalAssets,
      totalLiabilities,
    };
  });

  return netWorthHistory.filter((point) => point.totalAssets > 0 || point.totalLiabilities > 0);
}

/**
 * Month-end balances by asset/liability class for the last `months` months,
 * with the revaluation journal applied on the day each row landed.
 */
export function buildMonthlyAssetHistory(
  accounts: SeriesAccount[],
  allTransactions: HistoryLedgerRow[],
  revaluations: RevaluationLedgerRow[],
  months: number
): MonthlyAssetPoint[] {
  const endDate = new Date();
  const startDate = subMonths(startOfMonth(endDate), months - 1);

  const monthDates = eachMonthOfInterval({ start: startDate, end: endDate });

  const transactionsByAccount = groupTransactionsByAccount(allTransactions);

  const revaluationsByAccount = new Map<number, { Date: string; DeltaConverted: number }[]>();
  for (const row of revaluations) {
    const list = revaluationsByAccount.get(row.AccountID);
    if (list) list.push(row);
    else revaluationsByAccount.set(row.AccountID, [row]);
  }

  const getAccountBalanceAtEndOfMonth = (accountId: number, monthEnd: Date): number => {
    const accountTransactions = transactionsByAccount.get(accountId) || [];

    // Sum all transactions up to and including this month. Amounts are
    // integer milliunits, so the sum is exact — no rounding needed.
    const flows = accountTransactions
      .filter((tx) => !isBefore(monthEnd, parseISO(tx.Date)))
      .reduce((acc, tx) => acc + (tx.InflowConverted || 0) - (tx.OutflowConverted || 0), 0);

    // Transactions carry write-time rates; the revaluation journal trues the
    // converted balance to market rates, stepping on the day each row landed.
    const revalued = (revaluationsByAccount.get(accountId) || [])
      .filter((row) => !isBefore(monthEnd, parseISO(row.Date)))
      .reduce((acc, row) => acc + row.DeltaConverted, 0);

    return flows + revalued;
  };

  const monthlyData: MonthlyAssetPoint[] = monthDates.map((monthDate) => {
    const monthStr = format(monthDate, 'yyyy-MM');
    const monthLabel = format(monthDate, "MMM ''yy");

    const nextMonth = new Date(monthDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(0); // Last day of current month

    const categoryTotals: Record<string, number> = {
      cash: 0,
      investments: 0,
      crypto: 0,
      retirement: 0,
      realEstate: 0,
      otherAssets: 0,
      credit: 0,
      loans: 0,
    };

    for (const account of accounts) {
      const category = ACCOUNT_TYPE_CATEGORY[account.Type || ''] || 'otherAssets';
      const balance = getAccountBalanceAtEndOfMonth(account.ID, nextMonth);

      // For liabilities, store as positive for chart stacking
      if (LIABILITY_ACCOUNT_TYPES.has(account.Type || '')) {
        categoryTotals[category] += Math.abs(balance);
      } else {
        categoryTotals[category] += balance;
      }
    }

    const totalAssets =
      categoryTotals.cash +
      categoryTotals.investments +
      categoryTotals.crypto +
      categoryTotals.retirement +
      categoryTotals.realEstate +
      categoryTotals.otherAssets;

    const totalLiabilities = categoryTotals.credit + categoryTotals.loans;

    return {
      month: monthStr,
      label: monthLabel,
      cash: categoryTotals.cash,
      investments: categoryTotals.investments,
      crypto: categoryTotals.crypto,
      retirement: categoryTotals.retirement,
      realEstate: categoryTotals.realEstate,
      otherAssets: categoryTotals.otherAssets,
      credit: categoryTotals.credit,
      loans: categoryTotals.loans,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    };
  });

  return monthlyData.filter((point) => point.totalAssets > 0 || point.totalLiabilities > 0);
}
