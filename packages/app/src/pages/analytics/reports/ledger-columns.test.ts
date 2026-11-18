import { DEFAULT_LEDGER_COLUMNS, ledgerAverage, parseLedgerColumns } from './ledger-columns';

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
