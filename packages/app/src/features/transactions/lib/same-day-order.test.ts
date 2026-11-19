import { describe, expect, it } from 'vitest';
import { asMilli } from '@shared/lib/currency/milli';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { orderWithinDays } from './same-day-order';

function row(ID: number, Date: string, amount: number, runningBalance: number) {
  return {
    ID,
    Date,
    AccountID: 1,
    InflowConverted: asMilli(Math.max(amount, 0)),
    OutflowConverted: asMilli(Math.max(-amount, 0)),
    RunningBalanceConverted: asMilli(runningBalance),
    RunningBalanceNative: asMilli(runningBalance),
  } as GetTransactionsByAccountRow;
}

// Stored order: date desc, id desc. Balance before Oct 2 was 1000.
const rows = [
  row(4, '2026-10-02', -10, 1290),
  row(3, '2026-10-02', 500, 1300),
  row(2, '2026-10-02', -200, 800),
  row(1, '2026-10-01', 1000, 1000),
];

describe('orderWithinDays', () => {
  it('keeps the stored order for newest-first', () => {
    expect(orderWithinDays(rows, 'newest')).toBe(rows);
  });

  it('puts outflows then inflows first, largest first, and re-derives balances', () => {
    const ordered = orderWithinDays(rows, 'amount');
    expect(ordered.map((r) => r.ID)).toEqual([2, 4, 3, 1]);
    // End of Oct 2 stays 1290; each row below subtracts the row above it.
    expect(ordered.map((r) => r.RunningBalanceConverted)).toEqual([1290, 1490, 1500, 1000]);
  });

  describe('with times shown', () => {
    const timed = (r: GetTransactionsByAccountRow, Time: string | null) => ({ ...r, Time });
    // Oct 2: #4 at 08:00, #3 untimed, #2 at 19:30.
    const withTimes = [
      timed(rows[0], '08:00'),
      timed(rows[1], null),
      timed(rows[2], '19:30'),
      rows[3],
    ];

    it('orders a day latest time first, untimed rows at the start of the day', () => {
      const ordered = orderWithinDays(withTimes, 'newest', true);
      expect(ordered.map((r) => r.ID)).toEqual([2, 4, 3, 1]);
      expect(ordered.map((r) => r.RunningBalanceConverted)).toEqual([1290, 1490, 1500, 1000]);
    });

    it('keeps the stored order when times are hidden or a day has none', () => {
      expect(orderWithinDays(withTimes, 'newest')).toBe(withTimes);
      expect(orderWithinDays(rows, 'newest', true)).toEqual(rows);
    });

    it('ties on the same time keep newest entry first', () => {
      const same = [timed(rows[0], '10:00'), timed(rows[1], '10:00'), timed(rows[2], '11:00')];
      expect(orderWithinDays(same, 'newest', true).map((r) => r.ID)).toEqual([2, 4, 3]);
    });

    it('amount order ignores times', () => {
      expect(orderWithinDays(withTimes, 'amount', true).map((r) => r.ID)).toEqual([2, 4, 3, 1]);
      const ordered = orderWithinDays(
        [timed(rows[0], '23:00'), timed(rows[1], '01:00'), timed(rows[2], '12:30')],
        'amount',
        true
      );
      expect(ordered.map((r) => r.ID)).toEqual([2, 4, 3]);
    });
  });
});
