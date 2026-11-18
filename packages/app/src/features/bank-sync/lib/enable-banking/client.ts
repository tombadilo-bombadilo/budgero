import { t } from '@lingui/core/macro';
import {
  ENABLE_BANKING_API_URL,
  fromDecimalString,
  timeFromIsoDateTime,
  type BankTransaction,
  type EnableBankingSession,
  type EnableBankingSessionAccount,
} from '@budgero/core/browser';
import { signEnableBankingJwt, type EnableBankingCredentials } from './jwt';
import { openTunnel, resetTunnel } from './tunnel';

export const ENABLE_BANKING_CONTROL_PANEL_URL = 'https://enablebanking.com/cp/applications';

/** Enable Banking API payloads — https://enablebanking.com/docs/api/reference/ */
export interface EnableBankingApplication {
  name: string;
  kid?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  redirect_urls?: string[];
  active?: boolean;
  countries?: string[];
}

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  psu_types?: string[];
  /** Seconds. */
  maximum_consent_validity?: number;
  beta?: boolean;
  sandbox?: unknown;
}

interface Amount {
  amount: string;
  currency: string;
}

interface SessionAccount {
  uid: string;
  identification_hash?: string;
  identification_hashes?: string[];
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  details?: string;
  product?: string;
  currency?: string;
}

interface SessionResponse {
  session_id: string;
  accounts: SessionAccount[];
  aspsp: { name: string; country: string };
  access?: { valid_until?: string };
}

export interface EnableBankingBalance {
  name?: string;
  balance_amount: Amount;
  balance_type?: string;
  reference_date?: string;
  last_change_date_time?: string;
}

export interface EnableBankingTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: Amount;
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  remittance_information?: string[] | null;
  note?: string | null;
  bank_transaction_code?: { description?: string | null } | null;
}

interface TransactionsPage {
  transactions?: EnableBankingTransaction[];
  continuation_key?: string | null;
}

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'EnableBankingError';
  }

  /**
   * The bank revoked or expired consent; only a new authorization helps.
   * Banks word this differently, so any 401/403 or session error counts.
   */
  get needsReauthorization(): boolean {
    const code = (this.code ?? '').toUpperCase();
    return (
      this.status === 401 ||
      this.status === 403 ||
      /SESSION/.test(code) ||
      (this.status >= 400 && this.status < 500 && /session|expired/i.test(this.message))
    );
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Marks the fetch as user-present so banks don't count it against background limits. */
  psu?: boolean;
}

export async function enableBankingRequest<T>(
  credentials: EnableBankingCredentials,
  path: string,
  { method = 'GET', body, query, psu = false }: RequestOptions = {}
): Promise<T> {
  const jwt = await signEnableBankingJwt(credentials);
  const url = new URL(path, ENABLE_BANKING_API_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response | undefined;
  // One retry with a fresh ticket: a restarted server rejects the cached one.
  for (let attempt = 0; !response; attempt++) {
    try {
      const tunnel = await openTunnel();
      if (psu) {
        headers['Psu-User-Agent'] = navigator.userAgent;
        if (tunnel.clientIp) headers['Psu-Ip-Address'] = tunnel.clientIp;
      }
      response = await tunnel.fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      resetTunnel();
      if (attempt === 0) continue;
      console.warn('[EnableBanking] Tunnel request failed', error);
      throw new EnableBankingError(
        t`Couldn't reach Enable Banking through the Budgero relay. Check your connection and try again.`,
        0
      );
    }
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON error body */
  }
  if (response.status === 429) {
    throw new EnableBankingError(
      t`Your bank limits how often its data can be read. Try again in a few hours.`,
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }
  if (!response.ok) {
    const payload = (json ?? {}) as { message?: string; error?: string; detail?: unknown };
    const detail = typeof payload.detail === 'string' ? ` ${payload.detail}` : '';
    const message = payload.message
      ? `${payload.message}${detail}`
      : t`Enable Banking request failed (${response.status}).`;
    throw new EnableBankingError(message, response.status, payload.error);
  }
  return json as T;
}

export function getApplication(credentials: EnableBankingCredentials) {
  return enableBankingRequest<EnableBankingApplication>(credentials, '/application');
}

export async function listAspsps(credentials: EnableBankingCredentials, country: string) {
  const result = await enableBankingRequest<{ aspsps: Aspsp[] }>(credentials, '/aspsps', {
    query: { country, psu_type: 'personal' },
  });
  return (result.aspsps ?? []).sort((a, b) => a.name.localeCompare(b.name));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CONSENT_DAYS = 180;

/** Asks for the longest consent the bank allows, capped at 180 days. */
/** Banks that don't state a limit may reject long consents; 90 days is safe everywhere. */
const DEFAULT_CONSENT_DAYS = 90;

export function consentValidUntil(
  aspsp: Pick<Aspsp, 'maximum_consent_validity'>,
  now = Date.now()
) {
  const maxMs = aspsp.maximum_consent_validity
    ? aspsp.maximum_consent_validity * 1000
    : DEFAULT_CONSENT_DAYS * DAY_MS;
  return new Date(now + Math.min(maxMs, MAX_CONSENT_DAYS * DAY_MS) - 60 * 60 * 1000).toISOString();
}

export function startAuthorization(
  credentials: EnableBankingCredentials,
  input: { aspsp: Aspsp; redirectUrl: string; state: string }
) {
  return enableBankingRequest<{ url: string; authorization_id?: string }>(credentials, '/auth', {
    method: 'POST',
    body: {
      access: { valid_until: consentValidUntil(input.aspsp) },
      aspsp: { name: input.aspsp.name, country: input.aspsp.country },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: 'personal',
    },
  });
}

function toSessionAccount(account: SessionAccount): EnableBankingSessionAccount {
  const iban = account.account_id?.iban ?? undefined;
  const label =
    account.name || account.product || account.details || iban || account.uid.slice(0, 8);
  return {
    uid: account.uid,
    hash: account.identification_hash || account.identification_hashes?.[0] || account.uid,
    name: label,
    currency: (account.currency ?? '').toUpperCase(),
    ...(iban ? { iban } : {}),
  };
}

export async function createSession(
  credentials: EnableBankingCredentials,
  code: string,
  now = new Date()
): Promise<EnableBankingSession> {
  const session = await enableBankingRequest<SessionResponse>(credentials, '/sessions', {
    method: 'POST',
    body: { code },
  });
  return {
    sessionId: session.session_id,
    aspsp: { name: session.aspsp.name, country: session.aspsp.country },
    validUntil: session.access?.valid_until ?? new Date(now.getTime() + 90 * DAY_MS).toISOString(),
    accounts: (session.accounts ?? []).map(toSessionAccount),
    createdAt: now.toISOString(),
  };
}

export function deleteSession(credentials: EnableBankingCredentials, sessionId: string) {
  return enableBankingRequest<unknown>(credentials, `/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

/**
 * Interim booked (ITBD) includes today's bookings, which Budgero has already
 * imported; closing booked (CLBD) is usually yesterday's and would lag.
 */
const BALANCE_PREFERENCE = ['ITBD', 'CLBD', 'XPCD', 'ITAV', 'CLAV', 'OPBD', 'PRCD', 'FWAV'];

export function pickBalance(balances: EnableBankingBalance[]): EnableBankingBalance | null {
  for (const type of BALANCE_PREFERENCE) {
    const match = balances.find((balance) => balance.balance_type === type);
    if (match) return match;
  }
  return balances[0] ?? null;
}

export async function getBalance(credentials: EnableBankingCredentials, uid: string) {
  const result = await enableBankingRequest<{ balances?: EnableBankingBalance[] }>(
    credentials,
    `/accounts/${encodeURIComponent(uid)}/balances`,
    { psu: true }
  );
  const balance = pickBalance(result.balances ?? []);
  if (!balance) return null;
  const day = balance.reference_date ?? balance.last_change_date_time?.slice(0, 10) ?? null;
  return {
    amount: fromDecimalString(balance.balance_amount.amount.replace(/^\+/, '')),
    currency: balance.balance_amount.currency,
    date: balance.last_change_date_time ?? (day ? `${day}T12:00:00Z` : new Date().toISOString()),
    /** The bank's own calendar day for the balance, free of timezone shifts. */
    day,
  };
}

const MAX_PAGES = 200;

export async function getTransactions(
  credentials: EnableBankingCredentials,
  uid: string,
  dateFrom: string,
  { longest = false }: { longest?: boolean } = {}
): Promise<EnableBankingTransaction[]> {
  const rows: EnableBankingTransaction[] = [];
  let continuationKey: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await enableBankingRequest<TransactionsPage>(
      credentials,
      `/accounts/${encodeURIComponent(uid)}/transactions`,
      {
        psu: true,
        query: {
          date_from: dateFrom,
          strategy: longest ? 'longest' : undefined,
          continuation_key: continuationKey,
        },
      }
    );
    rows.push(...(result.transactions ?? []));
    if (!result.continuation_key || result.continuation_key === continuationKey) break;
    continuationKey = result.continuation_key;
  }
  return rows;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** FNV-1a; only used to name rows the bank sent without any reference. */
function fingerprint(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

// SEPA / ISO 20022 structured remittance prefixes (e.g. `SVWZ+Rechnung 42`),
// common at German and Austrian banks. They're clearing-system metadata, not
// text people want to read. An allowlist, so merchant tokens like `BMW+` stay.
const SEPA_PREFIX =
  /^(?:EREF|KREF|MREF|CRED|DBTR|CDTR|SVWZ|SVCL|PURP|RTRN|REJT|REFE|SDVA|INDA|NTAV|ULTC|ULTD|ULTB|ABWA|ABWE|IBAN|BIC|COAM|OAMT|REMI|SQTP|ROC)\+/;

export function cleanRemittance(lines: string[] | null | undefined): string {
  return clean(
    (lines ?? [])
      .map((line) => line.trim().replace(SEPA_PREFIX, '').trim())
      .filter(Boolean)
      .join(' ')
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PENDING_STATUSES = new Set(['PDNG', 'HOLD']);

function isoDay(value: string | null | undefined): string | undefined {
  const day = value?.slice(0, 10);
  return day && ISO_DATE.test(day) ? day : undefined;
}

/**
 * Maps Enable Banking rows to neutral bank rows. Amounts arrive unsigned with
 * a CRDT/DBIT indicator. Rows without an entry reference get a content
 * fingerprint plus an occurrence counter, so two identical coffees on the same
 * day stay two rows. Rows with no usable date or amount are skipped rather
 * than failing the whole account, and cancelled, rejected, scheduled or
 * informational rows never become transactions.
 */
export function toBankTransactions(rows: EnableBankingTransaction[]): BankTransaction[] {
  const seen = new Map<string, number>();
  const result: BankTransaction[] = [];
  for (const row of rows) {
    const status = row.status ?? 'BOOK';
    if (status !== 'BOOK' && !PENDING_STATUSES.has(status)) continue;
    const bookingDate = isoDay(row.booking_date);
    const valueDate = isoDay(row.value_date);
    const transactionDate = isoDay(row.transaction_date);
    const date = bookingDate ?? valueDate ?? transactionDate;
    // Some banks send these as date-times; keep a real time with its date.
    const bookingTime = bookingDate ? timeFromIsoDateTime(row.booking_date) : null;
    const valueTime = valueDate ? timeFromIsoDateTime(row.value_date) : null;
    const transactionTime = transactionDate ? timeFromIsoDateTime(row.transaction_date) : null;
    const time = bookingDate ? bookingTime : valueDate ? valueTime : transactionTime;
    const rawAmount = row.transaction_amount?.amount?.trim() ?? '';
    if (!date || !/^[+-]?\d+(\.\d+)?$/.test(rawAmount)) continue;

    const magnitude = Math.abs(fromDecimalString(rawAmount.replace(/^[+-]/, '')));
    const debit =
      row.credit_debit_indicator === 'DBIT' ||
      (!row.credit_debit_indicator && rawAmount.startsWith('-'));
    const amount = debit ? -magnitude : magnitude;
    const remittance = cleanRemittance(row.remittance_information);
    // Banks name the other side as creditor on debits and debtor on credits, but
    // some (Enable Banking's Mock ASPSP among them) only ever fill one of the two.
    const counterparty =
      clean(debit ? row.creditor?.name : row.debtor?.name) ||
      clean(debit ? row.debtor?.name : row.creditor?.name);
    const fallback = clean(row.note) || clean(row.bank_transaction_code?.description);
    const payee = counterparty || remittance || fallback;
    const memo = counterparty ? remittance || fallback : remittance ? fallback : '';

    // entry_reference is stable across sessions. transaction_id isn't (Enable
    // Banking may change it between fetches), so it's never used as an ID.
    let id = clean(row.entry_reference);
    if (!id) {
      const base = fingerprint(JSON.stringify([date, amount, payee, memo, row.value_date ?? '']));
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      id = `fp:${base}:${n}`;
    }
    result.push({
      id,
      date,
      ...(time ? { time } : {}),
      amount,
      payee: payee.slice(0, 200),
      memo: memo === payee ? '' : memo,
      pending: PENDING_STATUSES.has(status),
      fields: {
        counterparty: counterparty || undefined,
        description: remittance || fallback || undefined,
        bookingDate,
        transactionDate,
        valueDate,
        ...(bookingTime ? { bookingTime } : {}),
        ...(transactionTime ? { transactionTime } : {}),
        ...(valueTime ? { valueTime } : {}),
      },
    });
  }
  return result;
}
