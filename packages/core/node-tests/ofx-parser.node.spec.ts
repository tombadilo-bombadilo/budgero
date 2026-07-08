import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseOfx, ofxToImportRows, looksLikeOfx, parseOfxDate } from '../src';

const FIXTURE_DIR = path.join(__dirname, 'test-data', 'import-fixtures');

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('parseOfx', () => {
  it('returns no statements for an empty <OFX></OFX> document', () => {
    // bank_small.ofx is `<OFX></OFX>` with a v1.x SGML header — covers the
    // "valid header, no body" edge case some banks emit when there are no
    // transactions in the requested window.
    const result = parseOfx(loadFixture('bank_small.ofx'));
    expect(result.statements).toEqual([]);
  });

  it('parses an OFX 1.x SGML bank statement with leaf-only tags', () => {
    // checking.ofx has the canonical SGML form: most leaf tags don't close.
    const result = parseOfx(loadFixture('checking.ofx'));

    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt.kind).toBe('bank');
    expect(stmt.accountId).toBe('1452687~7');
    expect(stmt.accountType).toBe('CHECKING');
    expect(stmt.currency).toBe('USD');
    expect(stmt.transactions.length).toBe(3);

    expect(stmt.transactions[0]).toMatchObject({
      date: '2011-03-31',
      amount: '0.01',
      type: 'credit',
      payee: 'DIVIDEND EARNED FOR PERIOD OF 03',
      fitid: '0000486',
    });
    expect(stmt.transactions[0].memo?.startsWith('DIVIDEND EARNED FOR PERIOD OF 03/01/2011')).toBe(
      true
    );

    expect(stmt.transactions[1]).toMatchObject({
      date: '2011-04-05',
      amount: '-34.51',
      type: 'debit',
      payee: 'AUTOMATIC WITHDRAWAL, ELECTRIC BILL',
      fitid: '0000487',
    });

    expect(stmt.transactions[2]).toMatchObject({
      date: '2011-04-07',
      amount: '-25.00',
      type: 'check',
      checkNum: '319',
      fitid: '0000488',
    });
  });

  it('parses a one-line compact OFX 1.x statement', () => {
    // bank_medium.ofx puts the entire body on a few long lines with no
    // whitespace between tags — the regex parser needs to handle that.
    const result = parseOfx(loadFixture('bank_medium.ofx'));

    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt.kind).toBe('bank');
    expect(stmt.accountId).toBe('12300 000012345678');
    expect(stmt.accountType).toBe('CHECKING');
    expect(stmt.currency).toBe('CAD');
    expect(stmt.transactions.length).toBe(3);

    expect(stmt.transactions[0]).toMatchObject({
      date: '2009-04-01',
      amount: '-6.60',
      type: 'pos',
      payee: "MCDONALD'S #112",
      fitid: '0000123456782009040100001',
    });
    expect(stmt.transactions[1]).toMatchObject({
      date: '2009-04-02',
      amount: '-316.67',
      type: 'check',
      checkNum: '0',
      payee: "Joe's Bald Hairstyles",
    });
    expect(stmt.transactions[2]).toMatchObject({
      date: '2009-04-03',
      amount: '-22.00',
      type: 'pos',
      payee: "CONNIE'S HAIR D",
    });
  });

  it('parses an OFX 2.x XML credit-card statement', () => {
    // anzcc.ofx is well-formed XML with <CCSTMTRS> instead of <STMTRS>.
    const result = parseOfx(loadFixture('anzcc.ofx'));

    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt.kind).toBe('creditcard');
    expect(stmt.accountId).toBe('1234123412341234');
    expect(stmt.accountType).toBeUndefined();
    expect(stmt.currency).toBe('AUD');
    expect(stmt.transactions).toEqual([
      {
        date: '2017-05-08',
        amount: '-5.50',
        type: 'debit',
        payee: undefined,
        memo: 'SOME MEMO',
        fitid: '201705080001',
        checkNum: undefined,
        currency: undefined,
      },
    ]);
  });

  it('parses multiple bank statements in one OFX file', () => {
    // multiple_accounts.ofx has two <STMTTRNRS> blocks with no transactions
    // — checking + savings. Confirms we surface both accounts and don't
    // collapse them.
    const result = parseOfx(loadFixture('multiple_accounts.ofx'));
    expect(result.statements.length).toBe(2);
    expect(result.statements[0]).toMatchObject({
      kind: 'bank',
      accountId: '9100',
      accountType: 'CHECKING',
      currency: 'USD',
    });
    expect(result.statements[1]).toMatchObject({
      kind: 'bank',
      accountId: '9200',
      accountType: 'SAVINGS',
      currency: 'USD',
    });
    expect(result.statements[0].transactions).toEqual([]);
    expect(result.statements[1].transactions).toEqual([]);
  });

  it('handles empty tags and per-transaction CURRENCY blocks', () => {
    // ofx-v102-empty-tags.ofx leaves CURDEF/ACCTTYPE/NAME etc. as
    // `<TAG></TAG>` and supplies the actual currency on the transaction
    // via <CURRENCY><CURSYM>AUD</CURSYM></CURRENCY>. The parser should
    // surface AUD as the per-row currency, not the empty CURDEF.
    const result = parseOfx(loadFixture('ofx-v102-empty-tags.ofx'));
    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt.accountId).toBe('12345678');
    expect(stmt.currency).toBeUndefined();
    expect(stmt.transactions.length).toBe(1);
    expect(stmt.transactions[0]).toMatchObject({
      date: '2018-05-07',
      amount: '12.34',
      type: 'credit',
      memo: 'CBA:Transfer',
      currency: 'AUD',
    });
  });

  it('returns no statements for an investment-only OFX (out of scope)', () => {
    // fidelity.ofx is an INVSTMTRS document. We don't import investments,
    // so the parser should return an empty result rather than crashing.
    const result = parseOfx(loadFixture('fidelity.ofx'));
    expect(result.statements).toEqual([]);
  });
});

describe('parseOfxDate', () => {
  it.each([
    ['20110331120000.000', '2011-03-31'],
    ['20090401122017.000[-5:EST]', '2009-04-01'],
    ['20180804093914:014', '2018-08-04'],
    ['20180507', '2018-05-07'],
  ])('parses %s → %s', (input, expected) => {
    expect(parseOfxDate(input)).toBe(expected);
  });
});

describe('looksLikeOfx', () => {
  it('detects v1.x and v2.x headers and bare <OFX>', () => {
    expect(looksLikeOfx('OFXHEADER:100\nDATA:OFXSGML\n')).toBe(true);
    expect(looksLikeOfx('<?xml version="1.0"?><?OFX OFXHEADER="200"?>')).toBe(true);
    expect(looksLikeOfx('<OFX><X></X></OFX>')).toBe(true);
    expect(looksLikeOfx('!Type:Bank\nD1/1/2020\nT1.00\n^\n')).toBe(false);
    expect(looksLikeOfx('Date,Amount\n')).toBe(false);
  });
});

describe('ofxToImportRows', () => {
  it('flattens a multi-statement OFX into per-row Account columns', () => {
    const parsed = parseOfx(loadFixture('checking.ofx'));
    const { headers, rows, currency, accountId } = ofxToImportRows(parsed);
    expect(headers).toContain('Date');
    expect(headers).toContain('Amount');
    expect(rows.length).toBe(3);
    expect(rows[0].Date).toBe('2011-03-31');
    expect(rows[0].Amount).toBe('0.01');
    expect(rows[0].Account).toBe('1452687~7');
    expect(currency).toBe('USD');
    expect(accountId).toBe('1452687~7');
  });

  it('preserves transaction order across multiple statements', () => {
    // Two statements with no transactions still yields zero rows; the
    // headers list and currency seed are still populated from CURDEF.
    const parsed = parseOfx(loadFixture('multiple_accounts.ofx'));
    const { rows, currency } = ofxToImportRows(parsed);
    expect(rows).toEqual([]);
    expect(currency).toBe('USD');
  });
});
