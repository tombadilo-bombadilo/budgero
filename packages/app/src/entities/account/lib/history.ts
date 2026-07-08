import { eachDayOfInterval, format, parseISO, isAfter, isBefore } from 'date-fns';

/** Minimal transaction shape needed for balance-history math (amounts in integer milliunits). */
export interface HistoryTransaction {
  Date: string;
  Inflow?: number | null;
  Outflow?: number | null;
}

export interface DailyBalancePoint {
  date: string;
  /** Integer milliunits — sums of stored amounts stay exact, no rounding needed. */
  balance: number;
}

/**
 * Compute the daily running balance over [start, end].
 *
 * Transactions dated before `start` are folded into the opening balance;
 * the rest are applied day by day. Input order does not matter.
 */
export function computeDailyBalances(
  transactions: HistoryTransaction[],
  start: Date,
  end: Date
): DailyBalancePoint[] {
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime()
  );
  const dates = eachDayOfInterval({ start, end });

  // Opening balance: everything before the window.
  let currentBalance = sorted
    .filter((tx) => isBefore(parseISO(tx.Date), start))
    .reduce((acc, tx) => acc + (tx.Inflow || 0) - (tx.Outflow || 0), 0);

  const history: DailyBalancePoint[] = [];
  let transactionIndex = 0;

  for (const date of dates) {
    // Apply all transactions up to and including this date.
    while (
      transactionIndex < sorted.length &&
      !isAfter(parseISO(sorted[transactionIndex].Date), date)
    ) {
      const tx = sorted[transactionIndex];
      if (!isBefore(parseISO(tx.Date), start)) {
        currentBalance += (tx.Inflow || 0) - (tx.Outflow || 0);
      }
      transactionIndex++;
    }

    history.push({
      date: format(date, 'yyyy-MM-dd'),
      balance: currentBalance,
    });
  }

  return history;
}

/** Group transactions by their `AccountId`. */
export function groupTransactionsByAccount<T extends { AccountId: number }>(
  transactions: T[]
): Map<number, T[]> {
  const byAccount = new Map<number, T[]>();
  for (const transaction of transactions) {
    const list = byAccount.get(transaction.AccountId);
    if (list) {
      list.push(transaction);
    } else {
      byAccount.set(transaction.AccountId, [transaction]);
    }
  }
  return byAccount;
}
