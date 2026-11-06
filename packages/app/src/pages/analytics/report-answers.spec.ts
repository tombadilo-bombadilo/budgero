import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@lingui/core';
import { messages as germanMessages } from '@/locales/de/messages.mjs';
import {
  flowAnswer,
  formatShare,
  inOutAnswer,
  ledgerAnswer,
  planAnswer,
  scenarioAnswer,
  spendingAnswer,
  wealthAnswer,
} from './report-answers';

const fmt = {
  money: (milli: number) => `€${milli / 1000}`,
  monthLabel: (monthKey: string) => `M${monthKey}`,
};

const point = (monthKey: string, netWorth: number) => ({
  monthKey,
  assets: Math.max(netWorth, 0),
  debt: Math.max(-netWorth, 0),
  netWorth,
});

describe('report answers', () => {
  afterEach(() => i18n.activate('en'));

  it('names the spending total and the biggest entry', () => {
    expect(
      spendingAnswer(
        { total: 2_340_000, firstMonth: '2025-11', top: { name: 'Groceries', share: 0.243 } },
        fmt
      )
    ).toBe('You spent €2340 since M2025-11 — Groceries took the most (24%).');
    expect(spendingAnswer({ total: 5_000, firstMonth: null, top: null }, fmt)).toBe(
      'You spent €5.'
    );
    expect(spendingAnswer({ total: 0, firstMonth: '2026-01', top: null }, fmt)).toBe(
      'Nothing was spent in this period.'
    );
  });

  it('describes net worth movement in both directions', () => {
    expect(wealthAnswer([point('2026-05', 1_000_000), point('2026-10', 2_200_000)], fmt)).toBe(
      'Your net worth grew €1200 since M2026-05, to €2200.'
    );
    expect(wealthAnswer([point('2026-05', 2_000_000), point('2026-10', 1_500_000)], fmt)).toBe(
      'Your net worth fell €500 since M2026-05, to €1500.'
    );
    expect(wealthAnswer([point('2026-05', 1_000), point('2026-10', 1_000)], fmt)).toBe(
      'Your net worth held steady at €1 since M2026-05.'
    );
    expect(wealthAnswer([point('2026-10', 0)], fmt)).toBe(
      'There are no account balances in this period yet.'
    );
  });

  it('answers "within our means" with yes or not quite', () => {
    expect(inOutAnswer({ income: 4_000_000, spending: 3_000_000 }, fmt)).toBe(
      'Yes — you kept €1000 of the €4000 that came in (25% of income).'
    );
    expect(inOutAnswer({ income: 2_000_000, spending: 2_500_000 }, fmt)).toBe(
      'Not quite — you spent €500 more than the €2000 that came in (25% over).'
    );
    expect(inOutAnswer({ income: 0, spending: 10_000 }, fmt)).toBe(
      '€10 went out and no income came in.'
    );
  });

  it('summarises the money map flow', () => {
    expect(flowAnswer({ income: 1_000_000, spending: 400_000 }, fmt)).toBe(
      '€1000 came in and €400 went out — you kept 60%.'
    );
    expect(flowAnswer({ income: 1_000_000, spending: 1_200_000 }, fmt)).toBe(
      '€1000 came in and €1200 went out — €200 came from savings.'
    );
    expect(flowAnswer({ income: 0, spending: 0 }, fmt)).toBe(
      'No income or spending to map in this period.'
    );
  });

  it('says whether the plan held', () => {
    expect(planAnswer({ assigned: 3_000_000, spent: 2_500_000 }, fmt)).toBe(
      'Yes — you spent €2500 of the €3000 you assigned, and €500 stayed in the plan.'
    );
    expect(planAnswer({ assigned: 1_000_000, spent: 1_300_000 }, fmt)).toBe(
      'Not quite — you spent €300 more than the €1000 you assigned.'
    );
  });

  it('projects the scenario outcome', () => {
    const base = {
      endBalance: 9_000_000,
      horizon: 12,
      breakMonthKey: null,
      breakBeyondChart: false,
    };
    expect(scenarioAnswer(base, fmt)).toBe('In 12 months you would have €9000 — the money lasts.');
    expect(scenarioAnswer({ ...base, breakMonthKey: '2027-03' }, fmt)).toBe(
      'Under this scenario your money runs out in M2027-03.'
    );
    expect(scenarioAnswer({ ...base, breakMonthKey: '2029-03', breakBeyondChart: true }, fmt)).toBe(
      'In 12 months you would have €9000 left, but the money runs out in M2029-03.'
    );
  });

  it('nets out the ledger', () => {
    expect(ledgerAnswer({ net: 120_000, hasActivity: true }, fmt)).toBe(
      'Across every category you came out €120 ahead.'
    );
    expect(ledgerAnswer({ net: -120_000, hasActivity: true }, fmt)).toBe(
      'Across every category you spent €120 more than came in.'
    );
  });

  it('formats shares with a floor for slivers', () => {
    expect(formatShare(1, 1_000)).toBe('<1%');
    expect(formatShare(250, 1_000)).toBe('25%');
    expect(formatShare(0, 1_000)).toBe('0%');
    expect(formatShare(10, 0)).toBe('0%');
  });

  it('translates every sentence without English leaking through (de)', () => {
    i18n.load('de', germanMessages);
    i18n.activate('de');
    const sentences = [
      spendingAnswer({ total: 1_000, firstMonth: '2026-01', top: { name: 'X', share: 0.5 } }, fmt),
      wealthAnswer([point('2026-05', 1_000), point('2026-10', 2_000)], fmt),
      inOutAnswer({ income: 2_000, spending: 1_000 }, fmt),
      flowAnswer({ income: 2_000, spending: 1_000 }, fmt),
      planAnswer({ assigned: 2_000, spent: 1_000 }, fmt),
      scenarioAnswer(
        { endBalance: 1_000, horizon: 24, breakMonthKey: null, breakBeyondChart: false },
        fmt
      ),
      ledgerAnswer({ net: 1_000, hasActivity: true }, fmt),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\b(You|Your|spent|came in|went out|months?)\b/);
    }
    expect(sentences[5]).toContain('24');
  });
});
