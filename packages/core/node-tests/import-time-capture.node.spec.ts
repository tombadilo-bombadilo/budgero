import { describe, expect, it } from 'vitest';
import {
  applyBankFeedSettings,
  camtToImportRows,
  DEFAULT_BANK_FEED_SETTINGS,
  fromSimpleFINTransaction,
  ofxToImportRows,
  parseCamt,
  parseOfx,
  type BankTransaction,
} from '../src';
import { detectColumnMapping, parseImportTime } from '../src/services/import/parsing.js';
import { planImportRows, type ImportRowParseConfig } from '../src/services/import/row-planner.js';
import { parseOfxTime } from '../src/services/import/ofx-parser.js';

const ISO: ImportRowParseConfig = {
  thousandSeparator: ',',
  decimalSeparator: '.',
  dateFormat: 'YYYY-MM-DD',
};

const ofx = (dates: string[]) => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><ACCTID>1</BANKACCTFROM>
<BANKTRANLIST>${dates
  .map(
    (date, i) =>
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${date}<TRNAMT>-1.00<FITID>${i}<NAME>Shop</STMTTRN>`
  )
  .join('')}</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('import time capture', () => {
  it('reads time cells and timestamps in date cells, skipping placeholders', () => {
    expect(parseImportTime('14:30')).toBe('14:30');
    expect(parseImportTime('2:05 PM')).toBe('14:05');
    expect(parseImportTime('12:15 AM')).toBe('00:15');
    expect(parseImportTime('00:00:00')).toBeNull();
    expect(parseImportTime('12:00:00')).toBeNull();
    expect(parseImportTime('later')).toBeNull();
    expect(parseImportTime('31/01/2024 09:45', true)).toBe('09:45');
    expect(parseImportTime('2024-01-31T18:20:00Z', true)).toBe('18:20');
    expect(parseImportTime('2024-01-31', true)).toBeNull();
    expect(parseImportTime('2024-01-31 00:00:00', true)).toBeNull();
  });

  it('OFX keeps DTPOSTED times, not placeholders', () => {
    expect(parseOfxTime('20260304143012.000[-5:EST]')).toBe('14:30');
    expect(parseOfxTime('20260304000000')).toBeNull();
    expect(parseOfxTime('20260304120000')).toBeNull();
    expect(parseOfxTime('20260304')).toBeNull();
    const { rows, headers } = ofxToImportRows(
      parseOfx(ofx(['20260304143012', '20260305', '20260306120000']))
    );
    expect(headers).toContain('Time');
    expect(rows.map((row) => [row.Date, row.Time])).toEqual([
      ['2026-03-04', '14:30'],
      ['2026-03-05', ''],
      ['2026-03-06', ''],
    ]);
    const plans = planImportRows(rows, detectColumnMapping([...headers]), ISO);
    expect(plans.map((plan) => plan.time)).toEqual(['14:30', null, null]);
  });

  it('CAMT keeps a booking DtTm time, not a plain Dt', () => {
    const entry = (date: string) => `<Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <BookgDt>${date}</BookgDt></Ntry>`;
    const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>DE1</IBAN></Id><Ccy>EUR</Ccy></Acct>
      ${entry('<DtTm>2026-03-04T08:15:00+01:00</DtTm>')}
      ${entry('<Dt>2026-03-05</Dt>')}
      ${entry('<DtTm>2026-03-06T00:00:00</DtTm>')}
    </Stmt></BkToCstmrStmt></Document>`;
    const { rows } = camtToImportRows(parseCamt(xml));
    expect(rows.map((row) => [row.Date, row.Time])).toEqual([
      ['2026-03-04', '08:15'],
      ['2026-03-05', ''],
      ['2026-03-06', ''],
    ]);
  });

  it('CSV: a Time column or a date-time Date column; dates unchanged', () => {
    const mapping = detectColumnMapping(['Date', 'Time', 'Amount', 'Payee']);
    expect(mapping.time).toBe('Time');
    expect(detectColumnMapping(['Date/Time', 'Amount']).time).toBeUndefined();
    const plans = planImportRows(
      [
        { Date: '2026-03-04', Time: '07:05', Amount: '-1', Payee: 'A' },
        { Date: '2026-03-04', Time: '', Amount: '-1', Payee: 'B' },
      ],
      mapping,
      ISO
    );
    expect(plans.map((plan) => [plan.date, plan.time])).toEqual([
      ['2026-03-04', '07:05'],
      ['2026-03-04', null],
    ]);
    const stamped = planImportRows(
      [{ When: '2026-03-04 21:40:10', Amount: '-1' }],
      { date: 'When', amount: 'Amount' },
      ISO
    );
    expect([stamped[0].date, stamped[0].time]).toEqual(['2026-03-04', '21:40']);
  });

  it('bank feeds: the time follows the chosen date field', () => {
    const tx: BankTransaction = {
      id: '1',
      date: '2026-03-04',
      time: '09:00',
      amount: -1000,
      payee: 'Shop',
      memo: '',
      pending: false,
      fields: {
        bookingDate: '2026-03-04',
        bookingTime: '09:00',
        valueDate: '2026-03-05',
        transactionDate: '2026-03-03',
        transactionTime: '22:10',
      },
    };
    const apply = (date: 'auto' | 'booking' | 'transaction' | 'value') =>
      applyBankFeedSettings(tx, { ...DEFAULT_BANK_FEED_SETTINGS, date });
    expect(apply('auto').time).toBe('09:00');
    expect(apply('transaction')).toMatchObject({ date: '2026-03-03', time: '22:10' });
    expect(apply('value').date).toBe('2026-03-05');
    expect(apply('value').time).toBeUndefined();
  });

  it('SimpleFIN: placeholder midnight/noon UTC timestamps carry no time', () => {
    const base = { id: 'a', amount: '-1.00', description: 'Shop' };
    const noon = Date.UTC(2026, 2, 4, 12, 0, 0) / 1000;
    expect(fromSimpleFINTransaction({ ...base, posted: noon }).time).toBeUndefined();
    const midnight = Date.UTC(2026, 2, 4, 0, 0, 0) / 1000;
    expect(fromSimpleFINTransaction({ ...base, posted: midnight }).time).toBeUndefined();
    const real = Date.UTC(2026, 2, 4, 15, 42, 7) / 1000;
    expect(fromSimpleFINTransaction({ ...base, posted: real }).time).toMatch(/^\d{2}:42$/);
  });
});
