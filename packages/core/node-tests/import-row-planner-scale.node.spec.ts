import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCurrencyScale } from '../src/currencies/index.js';
import { detectColumnMapping, parseDelimitedText } from '../src/services/import/parsing.js';
import { planImportRows, type ImportRowParseConfig } from '../src/services/import/row-planner.js';

const FIXTURE_DIR = path.join(__dirname, 'test-data', 'import-fixtures');

const DOT: ImportRowParseConfig = {
  thousandSeparator: ',',
  decimalSeparator: '.',
  dateFormat: 'YYYY-MM-DD',
};
const COMMA: ImportRowParseConfig = {
  thousandSeparator: '.',
  decimalSeparator: ',',
  dateFormat: 'YYYY-MM-DD',
};

const btc = () => getCurrencyScale('BTC');

describe('planImportRows at the destination account scale', () => {
  const { rows } = parseDelimitedText(
    [
      'Date,Payee,Amount,Memo',
      '2026-10-01,Exchange,0.025,Buy',
      '2026-10-02,Network fee,-0.0000085,Fee',
      '2026-10-03,Coffee shop,-0.0035,Coffee',
      '2026-10-04,Dust,0.00000001,One sat',
      '2026-10-05,Max precision,1.23456789,',
    ].join('\n')
  );
  const mapping = detectColumnMapping(Object.keys(rows[0]));

  it('stores BTC amounts in sats', () => {
    const plans = planImportRows(rows, mapping, DOT, btc);
    expect(plans.map((p) => [p.inflow, p.outflow])).toEqual([
      [2_500_000, 0],
      [0, 850],
      [0, 350_000],
      [1, 0],
      [123_456_789, 0],
    ]);
    expect(plans.every((p) => p.status === 'ready')).toBe(true);
  });

  it('reads European decimal commas for crypto too', () => {
    const { rows: euRows } = parseDelimitedText(
      'Date;Payee;Amount;Memo\n2026-10-03;Coffee shop;-0,0035;Coffee\n2026-10-04;Exchange;1.000,5;Buy'
    );
    const plans = planImportRows(euRows, detectColumnMapping(Object.keys(euRows[0])), COMMA, btc);
    expect(plans.map((p) => [p.inflow, p.outflow])).toEqual([
      [0, 350_000],
      [100_050_000_000, 0],
    ]);
  });

  it('uses inflow/outflow columns at the account scale', () => {
    const { rows: split } = parseDelimitedText(
      'Date,Payee,Inflow,Outflow\n2026-10-01,A,0.5,\n2026-10-02,B,,0.0001'
    );
    const plans = planImportRows(
      split,
      { date: 'Date', payee: 'Payee', inflow: 'Inflow', outflow: 'Outflow' },
      DOT,
      btc
    );
    expect(plans.map((p) => [p.inflow, p.outflow])).toEqual([
      [50_000_000, 0],
      [0, 10_000],
    ]);
  });

  it('can mix scales per row (one file, a BTC and a USD account)', () => {
    const { rows: mixed } = parseDelimitedText(
      'Date,Payee,Amount,Account\n2026-10-01,Salary,2500.50,Checking\n2026-10-02,Fee,-0.0000085,Wallet'
    );
    const plans = planImportRows(
      mixed,
      { date: 'Date', payee: 'Payee', amount: 'Amount', account: 'Account' },
      DOT,
      (row) => getCurrencyScale(row.Account === 'Wallet' ? 'BTC' : 'USD')
    );
    expect(plans.map((p) => [p.inflow, p.outflow])).toEqual([
      [2_500_500, 0],
      [0, 850],
    ]);
  });
});

describe('fiat imports are unchanged', () => {
  const fixtures: [string, ImportRowParseConfig][] = [
    ['us-bank-mixed.csv', { ...DOT, dateFormat: 'MM/DD/YYYY' }],
    ['uk-bank-paid-in-out.csv', { ...DOT, dateFormat: 'DD/MM/YYYY' }],
    ['sample-german-bank.csv', { ...COMMA, dateFormat: 'DD.MM.YYYY' }],
    ['messy-dates-categories.csv', { ...DOT, dateFormat: 'MM/DD/YYYY' }],
  ];

  for (const [name, config] of fixtures) {
    it(`${name}: same plan with or without a fiat scale`, () => {
      const { rows } = parseDelimitedText(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
      const mapping = detectColumnMapping(Object.keys(rows[0]));
      const before = planImportRows(rows, mapping, config);
      expect(before.length).toBeGreaterThan(0);
      for (const currency of ['USD', 'EUR', 'JPY', 'RSD']) {
        expect(planImportRows(rows, mapping, config, () => getCurrencyScale(currency))).toEqual(
          before
        );
      }
    });
  }

  it('still turns a decimal into milliunits', () => {
    const { rows } = parseDelimitedText(
      'Date,Payee,Amount\n2026-10-01,Shop,-12.345\n2026-10-02,Pay,1000'
    );
    const plans = planImportRows(rows, detectColumnMapping(Object.keys(rows[0])), DOT, () =>
      getCurrencyScale('EUR')
    );
    expect(plans.map((p) => [p.inflow, p.outflow])).toEqual([
      [0, 12_345],
      [1_000_000, 0],
    ]);
  });
});
