/**
 * Reports' "today" is the user's local day, east and west of UTC, in the
 * analytics views and the AI SQL tool (never DuckDB's UTC CURRENT_DATE).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSqlToolDescription } from '@features/ai/lib/tools/query-sql';
import { getTodayISO } from '@shared/lib/date-utils';
import { reportingViewsSql } from './analytics-views';

/**
 * Node fixes its time zone at start-up (and this build has no zone data), so
 * the zone is mocked as a UTC offset: Date's local-day getters answer like a
 * device there.
 */
function mockUtcOffset(hours: number) {
  const shifted = (date: Date) => new Date(date.getTime() + hours * 3_600_000);
  vi.spyOn(Date.prototype, 'getFullYear').mockImplementation(function (this: Date) {
    return shifted(this).getUTCFullYear();
  });
  vi.spyOn(Date.prototype, 'getMonth').mockImplementation(function (this: Date) {
    return shifted(this).getUTCMonth();
  });
  vi.spyOn(Date.prototype, 'getDate').mockImplementation(function (this: Date) {
    return shifted(this).getUTCDate();
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([
  // 05:00 UTC on 11 Nov: already evening of the 11th at UTC+14, still the 10th at UTC-10.
  ['UTC+14 (Kiritimati)', 14, '2026-11-11'],
  ['UTC-10 (Honolulu)', -10, '2026-11-10'],
])('in %s', (_zone, offset, localDay) => {
  it('uses the local day', () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T05:00:00Z') });
    mockUtcOffset(offset);
    const today = getTodayISO();
    expect(today).toBe(localDay);
    const views = reportingViewsSql(today).join('\n');
    expect(views).toContain(`DATE '${localDay}'`);
    expect(views).not.toMatch(/CURRENT_DATE/);
    const prompt = buildSqlToolDescription(1);
    expect(prompt).toContain(`TODAY is '${localDay}'`);
    expect(prompt).not.toMatch(/strftime\(CURRENT_DATE/);
  });
});
