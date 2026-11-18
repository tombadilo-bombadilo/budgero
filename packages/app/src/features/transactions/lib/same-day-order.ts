import type { GetTransactionsByAccountRow, SameDayTransactionOrder } from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import { extractDateKey } from '@shared/lib/date-utils';

const convertedDelta = (row: GetTransactionsByAccountRow) =>
  row.InflowConverted - row.OutflowConverted;
const nativeDelta = (row: GetTransactionsByAccountRow) =>
  (row.InflowNative ?? row.InflowConverted) - (row.OutflowNative ?? row.OutflowConverted);

/** Outflows first, then inflows; largest first within each. */
function compareByAmount(a: GetTransactionsByAccountRow, b: GetTransactionsByAccountRow) {
  const da = convertedDelta(a);
  const db = convertedDelta(b);
  const tierA = da < 0 ? 0 : da > 0 ? 1 : 2;
  const tierB = db < 0 ? 0 : db > 0 ? 1 : 2;
  if (tierA !== tierB) return tierA - tierB;
  return Math.abs(db) - Math.abs(da) || b.ID - a.ID;
}

/**
 * Latest time first. A row without a time counts as the start of its day
 * (below the timed rows); rows with the same time, or none, keep their
 * stored newest-entry-first order (higher ID first).
 */
function compareByTime(a: GetTransactionsByAccountRow, b: GetTransactionsByAccountRow) {
  const ta = a.Time ?? '';
  const tb = b.Time ?? '';
  if (ta !== tb) return ta < tb ? 1 : -1;
  return b.ID - a.ID;
}

/**
 * Re-derive running balances for a reordered day. Stored balances follow the
 * (date, id) order, so each account's latest row holds its end-of-day balance;
 * walking down the new order subtracts each row's own amount from there.
 */
function rebalance(day: GetTransactionsByAccountRow[], original: GetTransactionsByAccountRow[]) {
  const endOfDay = new Map<number, { converted: number | null; native: number | null }>();
  for (const row of original) {
    const accountId = row.AccountID ?? 0;
    if (endOfDay.has(accountId)) continue;
    const converted = Number(row.RunningBalanceConverted);
    const native = Number(row.RunningBalanceNative ?? row.RunningBalanceConverted);
    endOfDay.set(accountId, {
      converted: Number.isFinite(converted) ? converted : null,
      native: Number.isFinite(native) ? native : null,
    });
  }
  return day.map((row) => {
    const accountId = row.AccountID ?? 0;
    const balance = endOfDay.get(accountId);
    if (!balance || balance.converted === null || balance.native === null) return row;
    const next = {
      ...row,
      RunningBalanceConverted: asMilli(balance.converted),
      RunningBalanceNative: asMilli(balance.native),
    };
    endOfDay.set(accountId, {
      converted: balance.converted - convertedDelta(row),
      native: balance.native - nativeDelta(row),
    });
    return next;
  });
}

/**
 * Applies the same-day order preference to register rows already sorted by
 * date (newest first). 'newest' keeps the stored order, unless `byTime` (the
 * register shows times): then a day with timed rows runs latest time first.
 * 'amount' ignores times.
 */
export function orderWithinDays(
  rows: GetTransactionsByAccountRow[],
  order: SameDayTransactionOrder,
  byTime = false
): GetTransactionsByAccountRow[] {
  if ((order === 'newest' && !byTime) || rows.length < 2) return rows;
  const compare = order === 'amount' ? compareByAmount : compareByTime;
  const result: GetTransactionsByAccountRow[] = [];
  let start = 0;
  while (start < rows.length) {
    const key = extractDateKey(rows[start].Date);
    let end = start + 1;
    while (end < rows.length && extractDateKey(rows[end].Date) === key) end++;
    const day = rows.slice(start, end);
    const reorder = day.length > 1 && (order === 'amount' || day.some((row) => Boolean(row.Time)));
    result.push(...(reorder ? rebalance([...day].sort(compare), day) : day));
    start = end;
  }
  return result;
}
