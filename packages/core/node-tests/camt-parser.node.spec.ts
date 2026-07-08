import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCamt, camtToImportRows, looksLikeCamt } from '../src';

const FIXTURE_DIR = path.join(__dirname, 'test-data', 'import-fixtures');

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('parseCamt', () => {
  it('parses a v02 statement with mixed CRDT/DBIT and a batched entry', () => {
    // bankstatementparser fixture: 3 entries, one CRDT with Dbtr name, one
    // DBIT batched payment (no party info), one CRDT with FX details.
    // Account uses <Othr><Id> (no IBAN), no <Acct><Ccy> — currency must
    // be derived from entry-level <Amt Ccy="SEK">.
    const result = parseCamt(loadFixture('camt053-v02-bankstatementparser.xml'));

    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt.accountId).toBe('50000000054910000003');
    expect(stmt.currency).toBeUndefined(); // no <Acct><Ccy> in this fixture
    expect(stmt.schemaVersion).toBe('camt.053.001.02');
    expect(stmt.transactions.length).toBe(3);

    expect(stmt.transactions[0]).toEqual({
      date: '2010-10-18',
      amount: '105678.50',
      currency: 'SEK',
      payee: 'MUELLER',
      memo: undefined,
      reference: 'MUELL/FINP/RA12345',
    });

    // Batched DBIT entry — no payee (no Cdtr/Dbtr block), reference falls
    // back to AcctSvcrRef because there's no EndToEndId, amount goes
    // negative because of CdtDbtInd=DBIT.
    expect(stmt.transactions[1]).toEqual({
      date: '2010-10-18',
      amount: '-200000',
      currency: 'SEK',
      payee: undefined,
      memo: undefined,
      reference: 'AAAASESS-FP-ACCR-01',
    });

    // Third entry has nested <CntrValAmt><Amt Ccy="EUR"> inside NtryDtls.
    // The parser must NOT pick that up as the entry currency — we strip
    // NtryDtls before reading entry-level Amt.
    expect(stmt.transactions[2]).toMatchObject({
      date: '2010-10-18',
      amount: '30000',
      currency: 'SEK',
      reference: 'AAAASS1085FINPSS',
    });
  });

  it('parses a Goldman-Sachs-style v02 with full RmtInf/RltdPties details', () => {
    // GS fixture: 15 entries with full TxDtls. We spot-check the first
    // two (one CRDT with RmtInf/Ustrd, one DBIT with Cdtr/Nm) and assert
    // the total count.
    const result = parseCamt(loadFixture('camt053-v02-gs.xml'));
    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt.accountId).toBe('DD01100056869');
    expect(stmt.currency).toBe('USD');
    expect(stmt.schemaVersion).toBe('camt.053.001.02');
    expect(stmt.transactions.length).toBe(15);

    expect(stmt.transactions[0]).toMatchObject({
      date: '2023-10-01',
      amount: '10.00',
      currency: 'USD',
      memo: 'Sample Unstructured Remittance 123',
      reference: 'GSGWGDNCTAHQM8',
    });

    expect(stmt.transactions[1]).toMatchObject({
      date: '2023-10-01',
      amount: '-10.00',
      currency: 'USD',
      payee: 'GS Bank USA',
    });
  });

  it('parses a v07 file wrapped in <message><AppHdr> with no entries', () => {
    // prowide fixture: AppHdr + Document wrapper, namespaced under
    // urn:iso:std:iso:20022:tech:xsd:camt.053.001.07. Statement has only
    // balances, no Ntry blocks — should yield 1 statement with 0 txns
    // (the upload step rejects this with "no transactions found").
    const result = parseCamt(loadFixture('camt053-v07-prowide.xml'));
    expect(result.statements.length).toBe(1);
    expect(result.statements[0]).toMatchObject({
      accountId: '2345234534',
      currency: 'USD',
      schemaVersion: 'camt.053.001.07',
      transactions: [],
    });
  });

  it('strips namespace prefixes on element names', () => {
    // Some banks/serializers emit CAMT with a non-default namespace prefix
    // (`<n0:Ntry>`). The parser must normalize before scanning, otherwise
    // every Ntry would be invisible.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<n0:Document xmlns:n0="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
  <n0:BkToCstmrStmt>
    <n0:Stmt>
      <n0:Acct>
        <n0:Id><n0:IBAN>DE89370400440532013000</n0:IBAN></n0:Id>
        <n0:Ccy>EUR</n0:Ccy>
      </n0:Acct>
      <n0:Ntry>
        <n0:Amt Ccy="EUR">42.50</n0:Amt>
        <n0:CdtDbtInd>DBIT</n0:CdtDbtInd>
        <n0:BookgDt><n0:Dt>2024-03-15</n0:Dt></n0:BookgDt>
        <n0:NtryDtls>
          <n0:TxDtls>
            <n0:Refs><n0:EndToEndId>NOTPROVIDED</n0:EndToEndId></n0:Refs>
            <n0:RltdPties><n0:Cdtr><n0:Nm>SUPERMARKT GMBH</n0:Nm></n0:Cdtr></n0:RltdPties>
            <n0:RmtInf><n0:Ustrd>Wocheneinkauf</n0:Ustrd></n0:RmtInf>
          </n0:TxDtls>
        </n0:NtryDtls>
      </n0:Ntry>
    </n0:Stmt>
  </n0:BkToCstmrStmt>
</n0:Document>`;
    const result = parseCamt(xml);
    expect(result.statements.length).toBe(1);
    expect(result.statements[0].accountId).toBe('DE89370400440532013000');
    expect(result.statements[0].currency).toBe('EUR');
    expect(result.statements[0].schemaVersion).toBe('camt.053.001.04');
    expect(result.statements[0].transactions).toEqual([
      {
        date: '2024-03-15',
        amount: '-42.50',
        currency: 'EUR',
        payee: 'SUPERMARKT GMBH',
        memo: 'Wocheneinkauf',
        reference: 'NOTPROVIDED',
      },
    ]);
  });

  it('falls back from BookgDt to ValDt when booking date is missing', () => {
    const xml = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>DE00</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">1.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <ValDt><Dt>2024-04-01</Dt></ValDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
    const result = parseCamt(xml);
    expect(result.statements[0].transactions[0].date).toBe('2024-04-01');
  });

  it('skips entries that have no usable date or amount', () => {
    // An <Ntry> without <Amt> or without any date should be dropped, not
    // imported as a zero-amount or undated row.
    const xml = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>DE00</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2024-04-01</Dt></BookgDt>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">5.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">10.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2024-04-02</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
    const result = parseCamt(xml);
    expect(result.statements[0].transactions.length).toBe(1);
    expect(result.statements[0].transactions[0].date).toBe('2024-04-02');
  });
});

describe('looksLikeCamt', () => {
  it('recognizes camt.053 schema URN and bare BkToCstmrStmt', () => {
    expect(looksLikeCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">')).toBe(
      true
    );
    expect(looksLikeCamt('<BkToCstmrStmt>')).toBe(true);
    expect(looksLikeCamt('OFXHEADER:100')).toBe(false);
    expect(looksLikeCamt('Date,Amount\n')).toBe(false);
    expect(looksLikeCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">')).toBe(
      false
    );
  });
});

describe('camtToImportRows', () => {
  it('flattens entries and seeds currency from entries when statement has none', () => {
    // bankstatementparser fixture has no <Acct><Ccy>, so the seeded
    // currency must come from the first entry's <Amt Ccy="SEK">.
    const parsed = parseCamt(loadFixture('camt053-v02-bankstatementparser.xml'));
    const { headers, rows, currency, accountId } = camtToImportRows(parsed);
    expect(headers).toContain('Date');
    expect(headers).toContain('Reference');
    expect(rows.length).toBe(3);
    expect(rows[0].Date).toBe('2010-10-18');
    expect(rows[0].Amount).toBe('105678.50');
    expect(rows[0].Currency).toBe('SEK');
    expect(rows[0].Account).toBe('50000000054910000003');
    expect(currency).toBe('SEK');
    expect(accountId).toBe('50000000054910000003');
  });

  it('seeds from <Acct><Ccy> when present', () => {
    const parsed = parseCamt(loadFixture('camt053-v02-gs.xml'));
    const { currency, accountId, rows } = camtToImportRows(parsed);
    expect(currency).toBe('USD');
    expect(accountId).toBe('DD01100056869');
    expect(rows.length).toBe(15);
  });

  it('returns zero rows for a balance-only statement', () => {
    const parsed = parseCamt(loadFixture('camt053-v07-prowide.xml'));
    const { rows, currency } = camtToImportRows(parsed);
    expect(rows).toEqual([]);
    expect(currency).toBe('USD');
  });
});
