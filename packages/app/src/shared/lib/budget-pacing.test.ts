import { describe, expect, it } from 'vitest';
import { calculateDailyAllowance } from './budget-pacing';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15, 30);

describe('calculateDailyAllowance', () => {
  it('spreads what is left over the remaining days, today included', () => {
    // 80,000 goal, 50,000 spent, Oct 20 -> 12 days left (20..31)
    expect(calculateDailyAllowance(80_000_000, 50_000_000, '2026-10', day(2026, 10, 20))).toEqual({
      perDay: 2_500_000,
      daysLeft: 12,
      remaining: 30_000_000,
    });
  });

  it('gives the whole remainder on the last day', () => {
    expect(calculateDailyAllowance(1_000_000, 400_000, '2026-10', day(2026, 10, 31))).toMatchObject(
      {
        perDay: 600_000,
        daysLeft: 1,
      }
    );
  });

  it('floors to whole milli units so the goal is never exceeded', () => {
    expect(calculateDailyAllowance(1_000, 0, '2026-02', day(2026, 2, 1))!.perDay).toBe(35); // 1000 / 28
  });

  it('is zero once spending reaches or passes the goal', () => {
    expect(calculateDailyAllowance(80_000_000, 98_102_580, '2026-10', day(2026, 10, 5))).toEqual({
      perDay: 0,
      daysLeft: 27,
      remaining: -18_102_580,
    });
    expect(calculateDailyAllowance(1_000, 1_000, '2026-10', day(2026, 10, 5))!.perDay).toBe(0);
  });

  it('uses every day of a future month', () => {
    expect(calculateDailyAllowance(30_000, 0, '2026-11', day(2026, 10, 20))).toMatchObject({
      perDay: 1_000,
      daysLeft: 30,
    });
    expect(calculateDailyAllowance(31_000, 0, '2027-01', day(2026, 12, 31))!.daysLeft).toBe(31);
  });

  it('returns null for a past month or without a goal', () => {
    expect(calculateDailyAllowance(80_000_000, 0, '2026-07', day(2026, 10, 20))).toBeNull();
    expect(calculateDailyAllowance(80_000_000, 0, '2025-12', day(2026, 1, 1))).toBeNull();
    expect(calculateDailyAllowance(undefined, 0, '2026-10', day(2026, 10, 20))).toBeNull();
    expect(calculateDailyAllowance(0, 0, '2026-10', day(2026, 10, 20))).toBeNull();
  });
});
