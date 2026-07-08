/**
 * OFX/QFX parser.
 *
 * Handles three flavors of the same wire format:
 *   - OFX 1.x (SGML — leaf tags don't close, container tags do)
 *   - OFX 2.x (well-formed XML)
 *   - QFX     (OFX with Quicken's <INTU.BID>/<INTU.USERID> extensions)
 *
 * We only extract what's needed to import transactions into a budget. The
 * full OFX schema covers investments, bill-pay, etc.; that's intentionally
 * out of scope. Bank (BANKMSGSRSV1) and credit card (CREDITCARDMSGSRSV1)
 * statements are supported.
 */
export type OfxAccountKind = 'bank' | 'creditcard';

export interface ParsedOfxTransaction {
  /** ISO date YYYY-MM-DD (time + TZ in the source are dropped). */
  date: string;
  /** Signed amount as written in the file, e.g. "-5.50". OFX is dot-decimal. */
  amount: string;
  /** OFX TRNTYPE: CREDIT / DEBIT / CHECK / POS / etc. Lower-cased here. */
  type?: string;
  payee?: string;
  memo?: string;
  fitid?: string;
  checkNum?: string;
  /** Per-transaction currency override (CURRENCY/CURSYM), if any. */
  currency?: string;
}

export interface ParsedOfxStatement {
  kind: OfxAccountKind;
  accountId?: string;
  /** CHECKING/SAVINGS/etc. for bank, undefined for credit cards. */
  accountType?: string;
  /** Statement-level CURDEF, fallback when a txn doesn't override. */
  currency?: string;
  transactions: ParsedOfxTransaction[];
}

export interface ParsedOfx {
  statements: ParsedOfxStatement[];
}

const STMTRS_RE = /<(STMTRS|CCSTMTRS)\b[^>]*>([\s\S]*?)<\/\1>/g;
const STMTTRN_RE = /<STMTTRN\b[^>]*>([\s\S]*?)<\/STMTTRN>/g;
// Field regex: capture an opening tag (not a closer, not a processing
// instruction) and the text up to the next `<`. This works for both SGML
// leaves (`<TRNAMT>-5.50`) and XML elements (`<TRNAMT>-5.50</TRNAMT>` —
// `[^<]*` stops at the closing `<`).
const FIELD_RE = /<([A-Za-z][A-Za-z0-9.]*)\b[^>]*>([^<]*)/g;

export function parseOfx(text: string): ParsedOfx {
  const body = stripOfxHeader(text);
  const statements: ParsedOfxStatement[] = [];

  STMTRS_RE.lastIndex = 0;
  let stmtMatch: RegExpExecArray | null;
  while ((stmtMatch = STMTRS_RE.exec(body)) !== null) {
    const wrapper = stmtMatch[1].toUpperCase();
    const inner = stmtMatch[2];
    const kind: OfxAccountKind = wrapper === 'CCSTMTRS' ? 'creditcard' : 'bank';

    const fields = extractFields(inner);
    const currency = first(fields, 'CURDEF');
    const accountId = first(fields, 'ACCTID');
    const accountType = first(fields, 'ACCTTYPE');

    const transactions: ParsedOfxTransaction[] = [];
    STMTTRN_RE.lastIndex = 0;
    let txnMatch: RegExpExecArray | null;
    while ((txnMatch = STMTTRN_RE.exec(inner)) !== null) {
      const txnFields = extractFields(txnMatch[1]);
      const dateRaw = first(txnFields, 'DTPOSTED');
      const amount = first(txnFields, 'TRNAMT');
      if (!dateRaw || amount === undefined) continue;

      transactions.push({
        date: parseOfxDate(dateRaw),
        amount: amount.trim(),
        type: lower(first(txnFields, 'TRNTYPE')),
        payee: first(txnFields, 'NAME') || first(txnFields, 'PAYEE'),
        memo: first(txnFields, 'MEMO'),
        fitid: first(txnFields, 'FITID'),
        checkNum: first(txnFields, 'CHECKNUM'),
        currency: first(txnFields, 'CURSYM'),
      });
    }

    statements.push({
      kind,
      accountId,
      accountType,
      currency,
      transactions,
    });
  }

  return { statements };
}

/**
 * Return true if `text` looks like an OFX/QFX document. Used by the upload
 * step to disambiguate when extension is missing or wrong.
 */
export function looksLikeOfx(text: string): boolean {
  return /OFXHEADER\s*[:=]\s*['"]?\d/i.test(text) || /<OFX\b/.test(text);
}

function stripOfxHeader(text: string): string {
  // Drop a leading BOM if present.
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // The body starts at the first <OFX> tag in both 1.x and 2.x.
  const idx = stripped.search(/<OFX\b/i);
  return idx >= 0 ? stripped.slice(idx) : stripped;
}

function extractFields(block: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(block)) !== null) {
    const name = m[1].toUpperCase();
    const value = m[2].trim();
    if (!value) continue;
    const list = out.get(name);
    if (list) list.push(value);
    else out.set(name, [value]);
  }
  return out;
}

function first(map: Map<string, string[]>, key: string): string | undefined {
  return map.get(key)?.[0];
}

function lower(s: string | undefined): string | undefined {
  return s == null ? undefined : s.toLowerCase();
}

/**
 * OFX dates: YYYYMMDD optionally followed by HHMMSS, then optional .SSS or
 * :SSS milliseconds, then optional [±N:TZ]. We just need the calendar date
 * — pull the first 8 digits.
 */
export function parseOfxDate(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return raw.trim();
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  return `${year}-${month}-${day}`;
}

/**
 * Flatten parsed OFX into the row shape the import wizard consumes.
 *
 * We use a fixed canonical header set so the configure step can auto-map
 * columns without the user picking anything. Multi-statement files (e.g.
 * checking + savings in one OFX) are merged into a single row list, with
 * the per-row Account column distinguishing them.
 */
export const OFX_HEADERS = [
  'Date',
  'Amount',
  'Payee',
  'Memo',
  'Type',
  'FITID',
  'CheckNum',
  'Account',
  'Currency',
] as const;

export interface OfxImportRows {
  headers: readonly string[];
  rows: Record<string, string>[];
  /** First non-empty CURDEF found, used to seed the import account currency. */
  currency?: string;
  /** First non-empty ACCTID found, used as a default account display name. */
  accountId?: string;
}

export function ofxToImportRows(parsed: ParsedOfx): OfxImportRows {
  const rows: Record<string, string>[] = [];
  let currency: string | undefined;
  let accountId: string | undefined;

  for (const stmt of parsed.statements) {
    if (!currency && stmt.currency) currency = stmt.currency;
    if (!accountId && stmt.accountId) accountId = stmt.accountId;
    for (const t of stmt.transactions) {
      rows.push({
        Date: t.date,
        Amount: t.amount,
        Payee: t.payee ?? '',
        Memo: t.memo ?? '',
        Type: t.type ?? '',
        FITID: t.fitid ?? '',
        CheckNum: t.checkNum ?? '',
        Account: stmt.accountId ?? '',
        Currency: t.currency ?? stmt.currency ?? '',
      });
    }
  }

  return { headers: OFX_HEADERS, rows, currency, accountId };
}
