import {
  DEFAULT_LEDGER_COLUMNS,
  ledgerAverage,
  ledgerAverageStep,
  parseLedgerColumns,
} from './ledger-columns';

it('averages over every shown month, quiet months counting as zero', () => {
  // 30.00 spent in one month of three → 10.00 per month.
  expect(ledgerAverage(-30_000, 3)).toBe(-10_000);
  expect(ledgerAverage(10_000, 3)).toBe(3_333);
  expect(ledgerAverage(5_000, 0)).toBe(0);
});

it('falls back to the defaults for missing or malformed settings', () => {
  expect(parseLedgerColumns(undefined)).toEqual(DEFAULT_LEDGER_COLUMNS);
  expect(parseLedgerColumns({ summaryFirst: true })).toEqual({ average: true, summaryFirst: true });
  expect(parseLedgerColumns({ average: 'no', summaryFirst: 1 })).toEqual(DEFAULT_LEDGER_COLUMNS);
});

it('never returns a negative zero, even for a tiny negative total', () => {
  expect(Object.is(ledgerAverage(-1, 3), 0)).toBe(true);
  // -0.01 over 3 months is -0.0033, under half a cent: 0, not "-0.00".
  expect(Object.is(ledgerAverage(-10, 3, ledgerAverageStep(2)), 0)).toBe(true);
  expect(ledgerAverage(-20, 3, ledgerAverageStep(2))).toBe(-10);
  expect(Object.is(ledgerAverage(-400, 3, ledgerAverageStep(0)), 0)).toBe(true);
});

it('rounds to the smallest amount the currency shows', () => {
  expect(ledgerAverageStep(2)).toBe(10);
  expect(ledgerAverageStep(0)).toBe(1000);
  expect(ledgerAverageStep(8)).toBe(1);
  expect(ledgerAverage(10_000, 3, 10)).toBe(3_330);
});
