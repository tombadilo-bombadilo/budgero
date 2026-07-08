import { describe, it, expect } from 'vitest';
import { decodeImportText, parseOfx, parseCamt, parseQif } from '../src';

/**
 * Encode a JS string as Windows-1252 bytes. Each char with codepoint < 256
 * maps to that byte; this is true for the Latin-1 subset we exercise here
 * (ÜüÄäÖöß and the punctuation/letters bank statements actually contain).
 * Anything outside that range would silently lose data, but our test
 * inputs stay within Latin-1 by construction.
 */
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255) {
      throw new Error(`latin1Bytes test helper given a non-Latin-1 char: U+${code.toString(16)}`);
    }
    out[i] = code;
  }
  return out;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('decodeImportText', () => {
  it('strips the UTF-8 BOM', () => {
    const buf = concat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8Bytes('hello'));
    const r = decodeImportText(buf);
    expect(r.text).toBe('hello');
    expect(r.encoding).toBe('utf-8');
  });

  it('keeps a clean UTF-8 file as UTF-8 even without a declaration', () => {
    const r = decodeImportText(utf8Bytes('café — naïve'));
    expect(r.text).toBe('café — naïve');
    expect(r.encoding).toBe('utf-8');
  });

  it('decodes an OFX 1.x file declaring CHARSET:1252 as Windows-1252', () => {
    // The header is plain ASCII; the body uses byte 0xDC for Ü, which is
    // invalid as a stand-alone UTF-8 byte. A naive UTF-8 read would
    // mangle this; the helper must honor the CHARSET header.
    const header =
      'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n';
    const body = '<OFX><NAME>M\xdcLLER</OFX>'; // 0xDC = Ü in Windows-1252
    const buf = concat(utf8Bytes(header), latin1Bytes(body));
    const r = decodeImportText(buf);
    expect(r.encoding).toBe('windows-1252');
    expect(r.declared).toBe('windows-1252');
    expect(r.text).toContain('MÜLLER');
  });

  it('decodes XML declaring encoding="ISO-8859-1"', () => {
    const xmlDecl = '<?xml version="1.0" encoding="ISO-8859-1"?>\n';
    const body = '<root>Caf\xe9</root>'; // 0xE9 = é in Latin-1
    const buf = concat(utf8Bytes(xmlDecl), latin1Bytes(body));
    const r = decodeImportText(buf);
    expect(r.encoding).toBe('iso-8859-1');
    expect(r.text).toContain('Café');
  });

  it('falls back to Windows-1252 when bytes are invalid UTF-8 and no declaration is present', () => {
    // Bare 0xC4 0xDC bytes aren't a valid UTF-8 sequence (continuation
    // byte without lead). With no declaration, strict UTF-8 throws and
    // we should land on Windows-1252.
    const buf = new Uint8Array([0x41, 0xc4, 0xdc, 0x42]); // A Ä Ü B
    const r = decodeImportText(buf);
    expect(r.encoding).toBe('windows-1252');
    expect(r.declared).toBeUndefined();
    expect(r.text).toBe('AÄÜB');
  });

  it('treats CHARSET:NONE as "no declaration" and uses UTF-8 when valid', () => {
    // OFX 1.x files that pair ENCODING:UTF-8 with CHARSET:NONE are common
    // in modern exports. The helper should ignore CHARSET:NONE and pick
    // up the ENCODING line instead.
    const header =
      'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:NONE\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n';
    const body = '<OFX><NAME>café</OFX>';
    const buf = utf8Bytes(header + body);
    const r = decodeImportText(buf);
    expect(r.encoding).toBe('utf-8');
    expect(r.text).toContain('café');
  });
});

describe('parser integration with decodeImportText', () => {
  it('parses a Windows-1252 OFX 1.x payee correctly through the helper', () => {
    const header =
      'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n';
    const body = `<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>EUR<BANKACCTFROM><ACCTID>DE89<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240315<TRNAMT>-12.34<FITID>1<NAME>B\xc4CKER M\xdcLLER<MEMO>Br\xf6tchen</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const buf = concat(utf8Bytes(header), latin1Bytes(body));
    const { text } = decodeImportText(buf);
    const parsed = parseOfx(text);
    expect(parsed.statements[0].transactions[0].payee).toBe('BÄCKER MÜLLER');
    expect(parsed.statements[0].transactions[0].memo).toBe('Brötchen');
  });

  it('parses a Latin-1 CAMT.053 payee correctly through the helper', () => {
    const xmlDecl = '<?xml version="1.0" encoding="ISO-8859-1"?>\n';
    const body = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
<BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>DE89370400440532013000</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Ntry>
<Amt Ccy="EUR">42.50</Amt>
<CdtDbtInd>DBIT</CdtDbtInd>
<BookgDt><Dt>2024-03-15</Dt></BookgDt>
<NtryDtls><TxDtls>
<RltdPties><Cdtr><Nm>B\xc4CKEREI \xc9TOILE</Nm></Cdtr></RltdPties>
<RmtInf><Ustrd>Wocheneinkauf f\xfcr Familie</Ustrd></RmtInf>
</TxDtls></NtryDtls>
</Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const buf = concat(utf8Bytes(xmlDecl), latin1Bytes(body));
    const { text } = decodeImportText(buf);
    const parsed = parseCamt(text);
    expect(parsed.statements[0].transactions[0].payee).toBe('BÄCKEREI ÉTOILE');
    expect(parsed.statements[0].transactions[0].memo).toBe('Wocheneinkauf für Familie');
  });

  it('parses a Windows-1252 QIF (no declaration) via the UTF-8-strict fallback', () => {
    const body = `!Type:Bank
D03/15/2024
T-12.34
PB\xc4CKER M\xdcLLER
MBr\xf6tchen
^
`;
    const { text, encoding } = decodeImportText(latin1Bytes(body));
    expect(encoding).toBe('windows-1252');
    const parsed = parseQif(text);
    expect(parsed.sections[0].transactions[0].payee).toBe('BÄCKER MÜLLER');
    expect(parsed.sections[0].transactions[0].memo).toBe('Brötchen');
  });
});
