/**
 * CAMT.053 (ISO 20022) bank statement parser.
 *
 * CAMT.053 is the dominant European bank export format under PSD2. It's
 * well-formed XML, but with enough structural variation across versions
 * (v02, v04, v06, v07, v08+) and bank dialects that we treat the schema
 * leniently: we scan for the tags we need rather than walking a strict
 * tree.
 *
 * Scope:
 *   - Statement-level metadata: account ID/IBAN + currency.
 *   - One row per <Ntry> (booked entry). Batched entries with multiple
 *     <TxDtls> are intentionally collapsed to their parent — that matches
 *     what users see on their statement.
 *   - Sign convention: <CdtDbtInd>DBIT</CdtDbtInd> ⇒ negative amount,
 *     CRDT ⇒ positive. This matches our other parsers (debit = outflow).
 *   - Counter-party name: <Dbtr><Nm> for CRDT (someone paid us),
 *     <Cdtr><Nm> for DBIT (we paid someone).
 *   - Memo: first non-empty <RmtInf><Ustrd>, falling back to
 *     <AddtlNtryInf>.
 *
 * Out of scope: pacs.* payment messages, camt.052 intraday, camt.054
 * notifications, balance-summary-only reports (handled — produces a
 * statement with zero transactions, the upload step rejects it).
 */
export interface ParsedCamtTransaction {
  /** Booking date (preferred) or value date, ISO YYYY-MM-DD. */
  date: string;
  /** Signed amount string. Negative when CdtDbtInd=DBIT. */
  amount: string;
  /** Per-entry currency from <Amt Ccy="..."> attribute. */
  currency: string;
  /** Counter-party name; selection depends on credit/debit direction. */
  payee?: string;
  /** Free-text remittance info. */
  memo?: string;
  /** EndToEndId (preferred) or AcctSvcrRef. */
  reference?: string;
}

export interface ParsedCamtStatement {
  /** Account identifier — IBAN if present, else <Othr><Id>. */
  accountId?: string;
  /** Statement-level <Acct><Ccy>. */
  currency?: string;
  /** Schema version (e.g. "camt.053.001.02") if discoverable. */
  schemaVersion?: string;
  transactions: ParsedCamtTransaction[];
}

export interface ParsedCamt {
  statements: ParsedCamtStatement[];
}

const NS_STRIP_RE = /<(\/?)[A-Za-z][\w.-]*:([A-Za-z])/g;
const STMT_RE = /<Stmt\b[^>]*>([\s\S]*?)<\/Stmt>/g;
const NTRY_RE = /<Ntry\b[^>]*>([\s\S]*?)<\/Ntry>/g;
const NTRY_DTLS_RE = /<NtryDtls\b[^>]*>[\s\S]*?<\/NtryDtls>/g;
const SCHEMA_RE = /urn:iso:std:iso:20022:tech:xsd:(camt\.053\.\d{3}\.\d{2})/;

export function parseCamt(text: string): ParsedCamt {
  const stripped = stripNamespacePrefixes(stripBom(text));
  const schemaVersion = stripped.match(SCHEMA_RE)?.[1];
  const statements: ParsedCamtStatement[] = [];

  STMT_RE.lastIndex = 0;
  let stmtMatch: RegExpExecArray | null;
  while ((stmtMatch = STMT_RE.exec(stripped)) !== null) {
    const stmt = stmtMatch[1];
    statements.push({
      accountId: extractAccountId(stmt),
      currency: extractStmtCurrency(stmt),
      schemaVersion,
      transactions: extractEntries(stmt),
    });
  }

  return { statements };
}

/**
 * Cheap content sniff for the upload step. CAMT files don't have a
 * filename convention (banks use .xml), so we fingerprint by the schema
 * URN or the unmistakable <BkToCstmrStmt> root.
 */
export function looksLikeCamt(text: string): boolean {
  return /urn:iso:std:iso:20022:tech:xsd:camt\.053/.test(text) || /<BkToCstmrStmt\b/.test(text);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Drop namespace prefixes from element names so downstream regex can match
 * `<Ntry>` whether the source emitted `<Ntry>`, `<ns:Ntry>`, or `<n0:Ntry>`.
 * Attributes are left alone — we read them by name (`Ccy="EUR"`), and that
 * name is namespace-free in CAMT.
 */
function stripNamespacePrefixes(xml: string): string {
  return xml.replace(NS_STRIP_RE, '<$1$2');
}

function extractAccountId(stmt: string): string | undefined {
  const acct = firstBlock(stmt, 'Acct');
  if (!acct) return undefined;
  // IBAN is the canonical European identifier; <Othr><Id> is the fallback
  // many US banks (and Goldman Sachs in our fixture) use.
  return firstText(acct, 'IBAN') ?? firstText(acct, 'Id');
}

function extractStmtCurrency(stmt: string): string | undefined {
  const acct = firstBlock(stmt, 'Acct');
  if (!acct) return undefined;
  return firstText(acct, 'Ccy');
}

function extractEntries(stmt: string): ParsedCamtTransaction[] {
  const entries: ParsedCamtTransaction[] = [];
  NTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NTRY_RE.exec(stmt)) !== null) {
    const txn = parseEntry(m[1]);
    if (txn) entries.push(txn);
  }
  return entries;
}

function parseEntry(entry: string): ParsedCamtTransaction | null {
  // Entry-level Amt and CdtDbtInd live OUTSIDE NtryDtls. Strip the
  // NtryDtls subtree first so we don't accidentally pick up nested
  // TxDtls amounts (which can be in a different currency for FX entries).
  const entryHead = entry.replace(NTRY_DTLS_RE, '');
  const amtAttr = firstAttrAndText(entryHead, 'Amt', 'Ccy');
  if (!amtAttr) return null;

  const cdtDbt = firstText(entryHead, 'CdtDbtInd')?.toUpperCase();
  const isDebit = cdtDbt === 'DBIT';
  const rawAmount = amtAttr.text.trim();
  if (!rawAmount) return null;
  const signedAmount = isDebit && !rawAmount.startsWith('-') ? `-${rawAmount}` : rawAmount;

  const date = extractDate(entry, 'BookgDt') ?? extractDate(entry, 'ValDt') ?? '';
  if (!date) return null;

  // Memo + payee + reference live inside NtryDtls/TxDtls. Look across
  // the whole entry — first non-empty wins. For batched entries with
  // many TxDtls, we get the first one's details, which is consistent
  // with most consumer-bank renderings.
  const memo =
    findFirstNonEmpty(entry, 'Ustrd') ?? findFirstNonEmpty(entry, 'AddtlNtryInf') ?? undefined;

  const payeeBlockTag = isDebit ? 'Cdtr' : 'Dbtr';
  const payee = (() => {
    const block = firstBlock(entry, payeeBlockTag);
    if (!block) return undefined;
    return firstText(block, 'Nm');
  })();

  const reference =
    findFirstNonEmpty(entry, 'EndToEndId') ?? findFirstNonEmpty(entry, 'AcctSvcrRef') ?? undefined;

  return {
    date,
    amount: signedAmount,
    currency: amtAttr.attr,
    payee,
    memo,
    reference,
  };
}

/**
 * CAMT date elements are always wrapped: <BookgDt><Dt>YYYY-MM-DD</Dt></BookgDt>
 * or <BookgDt><DtTm>YYYY-MM-DDThh:mm:ss</DtTm></BookgDt>. We accept either
 * and slice to YYYY-MM-DD.
 */
function extractDate(entry: string, wrapperTag: string): string | undefined {
  const wrapper = firstBlock(entry, wrapperTag);
  if (!wrapper) return undefined;
  const raw = firstText(wrapper, 'Dt') ?? firstText(wrapper, 'DtTm');
  if (!raw) return undefined;
  // Strip time portion. CAMT dates are ISO-8601 calendar order so the
  // first 10 chars are always YYYY-MM-DD.
  return raw.slice(0, 10);
}

function firstBlock(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  return xml.match(re)?.[1];
}

function firstText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`);
  const m = xml.match(re);
  if (!m) return undefined;
  const t = m[1].trim();
  return t.length > 0 ? t : undefined;
}

function firstAttrAndText(
  xml: string,
  tag: string,
  attr: string
): { attr: string; text: string } | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>([^<]*)</${tag}>`);
  const m = xml.match(re);
  if (!m) return undefined;
  return { attr: m[1], text: m[2] };
}

/**
 * Iterate every `<tag>text</tag>` occurrence and return the first
 * non-empty trimmed text. Used for tags that can appear at multiple
 * nesting depths (Ustrd, EndToEndId, AcctSvcrRef): we want any value, and
 * the first occurrence corresponds to the primary TxDtls in batch entries.
 */
function findFirstNonEmpty(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = m[1].trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

export const CAMT_HEADERS = [
  'Date',
  'Amount',
  'Payee',
  'Memo',
  'Reference',
  'Account',
  'Currency',
] as const;

export interface CamtImportRows {
  headers: readonly string[];
  rows: Record<string, string>[];
  /** First non-empty statement currency, used to seed the import account. */
  currency?: string;
  /** First non-empty IBAN/account-id, surfaced as account default. */
  accountId?: string;
}

export function camtToImportRows(parsed: ParsedCamt): CamtImportRows {
  const rows: Record<string, string>[] = [];
  let currency: string | undefined;
  let accountId: string | undefined;

  for (const stmt of parsed.statements) {
    if (!currency && stmt.currency) currency = stmt.currency;
    if (!accountId && stmt.accountId) accountId = stmt.accountId;
    for (const t of stmt.transactions) {
      // Some banks omit <Acct><Ccy> and only declare currency on each
      // entry's <Amt Ccy="..."> attribute — fall back so the wizard can
      // still pre-fill the import account currency.
      if (!currency && t.currency) currency = t.currency;
      rows.push({
        Date: t.date,
        Amount: t.amount,
        Payee: t.payee ?? '',
        Memo: t.memo ?? '',
        Reference: t.reference ?? '',
        Account: stmt.accountId ?? '',
        Currency: t.currency || stmt.currency || '',
      });
    }
  }

  return { headers: CAMT_HEADERS, rows, currency, accountId };
}
