/**
 * Where each account in an imported file goes. A file can hold several
 * accounts (an OFX with a current account and a card, a QIF from Quicken, a
 * CSV with an Account column); each source value is routed to an existing
 * account, a new one, or skipped.
 *
 * importConfig.accountRoutes holds only what the user picked. Everything else
 * is derived here by planAccountRoutes, which the panel, the preview and the
 * import all call, so they cannot disagree.
 */
import { AccountTypeEnum, isCryptoCurrency } from '@budgero/core/browser';
import type { AccountRoute } from '../model/types';

export interface SourceAccount {
  /** The value in the file's Account column (an account name, ACCTID or IBAN). */
  source: string;
  rows: number;
  /** Currency the file states for these rows (OFX/CAMT, or a Currency column), if any. */
  currency?: string;
  /** Budgero account type the file states (QIF `!Type:` sections), if any. */
  type?: string;
}

export interface RoutableAccount {
  ID: number;
  Name: string;
  Currency?: string;
  Archived?: boolean;
}

/** -1 is the legacy single "Import Account"; each new source account gets its own id below it. */
const FIRST_PLACEHOLDER = -100;
/** The single "Import Account" for rows that name no account. */
export const IMPORT_ACCOUNT_PLACEHOLDER = -1;

/** Ids the preview uses for accounts that do not exist yet. Never stored. */
export function isPlaceholderAccountId(accountId: number): boolean {
  return accountId === IMPORT_ACCOUNT_PLACEHOLDER || accountId <= FIRST_PLACEHOLDER;
}

/** Names that differ only by case, spacing or Unicode form are the same account. */
export function accountNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A currency code as accounts store it, or undefined when the value is not one. */
export function currencyCodeOf(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  if (!code) return undefined;
  const fiat = fiatCodes();
  // Without Intl.supportedValuesOf (older browsers), any ISO-shaped code counts.
  const isFiat = fiat.size > 0 ? fiat.has(code) : /^[A-Z]{3}$/.test(code);
  return isFiat || isCryptoCurrency(code) ? code : undefined;
}

let knownFiat: Set<string> | undefined;
function fiatCodes(): Set<string> {
  if (!knownFiat) {
    try {
      const intl = Intl as unknown as { supportedValuesOf?: (key: 'currency') => string[] };
      knownFiat = new Set(intl.supportedValuesOf?.('currency') ?? []);
    } catch {
      knownFiat = new Set();
    }
  }
  return knownFiat;
}

const ACCOUNT_TYPES = new Set<string | undefined>(Object.values(AccountTypeEnum));

export function sourceAccountsOf(
  rows: Record<string, string>[],
  column: string | undefined
): SourceAccount[] {
  if (!column) return [];
  const bySource = new Map<string, SourceAccount>();
  const statedFor = new Set<string>();
  for (const row of rows) {
    const source = row[column]?.trim();
    if (!source) continue;
    const entry = bySource.get(source) ?? { source, rows: 0 };
    entry.rows += 1;
    // The account's own currency (OFX CURDEF) wins over a row's: one card
    // payment abroad does not make a USD statement a EUR account.
    const stated = currencyCodeOf(row.AccountCurrency);
    if (stated && !statedFor.has(source)) {
      entry.currency = stated;
      statedFor.add(source);
    }
    const currency = entry.currency ?? currencyCodeOf(row.Currency);
    if (currency) entry.currency = currency;
    if (!entry.type && ACCOUNT_TYPES.has(row.AccountType)) entry.type = row.AccountType;
    bySource.set(source, entry);
  }
  return [...bySource.values()];
}

/** Account ids belong to one budget in one space (as in last-used-storage.ts). */
const rememberKey = (spaceId: string | null, budgetId: number): string | null =>
  spaceId && Number.isInteger(budgetId) && budgetId > 0
    ? `budgero:import-account-routes:${encodeURIComponent(spaceId)}:${budgetId}`
    : null;
/** Before routes were keyed by space; ids could leak between spaces, so never read. */
const legacyRememberKey = (budgetId: number) => `budgero:import-account-routes:${budgetId}`;
/** Oldest choices are dropped beyond this, so the list cannot grow without bound. */
const MAX_REMEMBERED = 200;

/** Earlier choices on this device, by source value (account id only). */
export function readRememberedRoutes(
  spaceId: string | null,
  budgetId: number
): Record<string, number> {
  const key = rememberKey(spaceId, budgetId);
  if (!key) return {};
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(([, id]) => typeof id === 'number' && Number.isInteger(id))
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function rememberRoutes(
  spaceId: string | null,
  budgetId: number,
  chosen: Record<string, number>
): void {
  const key = rememberKey(spaceId, budgetId);
  if (!key || Object.keys(chosen).length === 0) return;
  try {
    // Re-insert what was just chosen so it is the newest.
    const merged = new Map(Object.entries(readRememberedRoutes(spaceId, budgetId)));
    for (const [source, id] of Object.entries(chosen)) {
      merged.delete(source);
      merged.set(source, id);
    }
    const kept = [...merged].slice(-MAX_REMEMBERED);
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
    localStorage.removeItem(legacyRememberKey(budgetId));
  } catch {
    /* storage blocked: the next import asks again */
  }
}

const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.getOwnPropertyDescriptor(record, key)?.value as T | undefined;

/**
 * The route for each source: what the user picked (unless that account is
 * gone), else the one open account with the same name, else the open account
 * picked for it last time. Otherwise:
 * - a name that only matches an archived account, or several accounts: unset
 *   (the user picks);
 * - the only account in the file: the account already chosen in the dialog
 *   (`fallbackAccountId`), else unset. An IBAN or ACCTID is rarely a good name
 *   for a new account;
 * - one of several accounts in the file: a new account named after it.
 */
export function defaultRoutes(
  sources: SourceAccount[],
  accounts: RoutableAccount[],
  remembered: Record<string, number>,
  chosen: Record<string, AccountRoute> = {},
  fallbackAccountId?: number | null
): Record<string, AccountRoute | undefined> {
  const open = accounts.filter((a) => !a.Archived);
  const fallback = accounts.find((a) => a.ID === fallbackAccountId);
  const routes = Object.create(null) as Record<string, AccountRoute | undefined>;
  for (const { source } of sources) {
    const kept = own(chosen, source);
    if (kept && (kept.kind !== 'existing' || accounts.some((a) => a.ID === kept.accountId))) {
      routes[source] = kept;
      continue;
    }
    const sameName = accounts.filter((a) => accountNameKey(a.Name) === accountNameKey(source));
    const openSameName = sameName.filter((a) => !a.Archived);
    const named = openSameName.length === 1 ? openSameName[0] : undefined;
    const known = open.find((a) => a.ID === own(remembered, source));
    const account = named ?? known;
    if (account) routes[source] = { kind: 'existing', accountId: account.ID };
    else if (sameName.length > 0) routes[source] = undefined;
    else if (sources.length === 1)
      routes[source] = fallback ? { kind: 'existing', accountId: fallback.ID } : undefined;
    else routes[source] = { kind: 'new', name: source };
  }
  return routes;
}

export type RouteTarget =
  | { kind: 'unset' }
  | { kind: 'skip' }
  | { kind: 'existing'; accountId: number }
  | { kind: 'new'; placeholderId: number; name: string; currency: string; type?: string };

/**
 * Why a source cannot be imported as routed:
 * - pick: no account chosen yet;
 * - name-taken: the new account's name is already an account in the budget;
 * - currency: it shares a new account with a source in another currency.
 */
export type RouteProblem = 'pick' | 'name-taken' | 'currency';

export interface NewAccountPlan {
  placeholderId: number;
  name: string;
  currency: string;
  /** Account type the file states for it (QIF), else Checking. */
  type?: string;
  /** The sources that go into it (several when they were given the same name). */
  sources: string[];
}

export interface AccountRoutePlan {
  sources: SourceAccount[];
  routes: Record<string, AccountRoute | undefined>;
  targets: Map<string, RouteTarget>;
  newAccounts: NewAccountPlan[];
  problems: Map<string, RouteProblem>;
}

interface PlanOptions {
  rows: Record<string, string>[];
  column: string | undefined;
  accounts: RoutableAccount[];
  remembered?: Record<string, number>;
  /** importConfig.accountRoutes: the user's own picks. */
  chosen?: Record<string, AccountRoute>;
  /** Currency of a new account when the file states none for it. */
  newAccountCurrency: string;
  /** The account chosen in the dialog (importConfig.defaultAccountId). */
  fallbackAccountId?: number | null;
}

export function planAccountRoutes({
  rows,
  column,
  accounts,
  remembered = {},
  chosen = {},
  newAccountCurrency,
  fallbackAccountId,
}: PlanOptions): AccountRoutePlan {
  const sources = sourceAccountsOf(rows, column);
  const routes = defaultRoutes(sources, accounts, remembered, chosen, fallbackAccountId);
  const takenNames = new Set(accounts.map((a) => accountNameKey(a.Name)));
  const targets = new Map<string, RouteTarget>();
  const problems = new Map<string, RouteProblem>();
  const newByName = new Map<string, NewAccountPlan>();

  sources.forEach(({ source, currency, type }, index) => {
    const route = routes[source];
    if (!route) {
      targets.set(source, { kind: 'unset' });
      problems.set(source, 'pick');
      return;
    }
    if (route.kind !== 'new') {
      targets.set(source, route);
      return;
    }
    const name = route.name.trim().replace(/\s+/g, ' ') || source;
    const key = accountNameKey(name);
    let account = newByName.get(key);
    if (!account) {
      account = {
        placeholderId: FIRST_PLACEHOLDER - index,
        name,
        currency: currency ?? newAccountCurrency,
        ...(type ? { type } : {}),
        sources: [],
      };
      newByName.set(key, account);
    }
    account.sources.push(source);
    if (takenNames.has(key)) problems.set(source, 'name-taken');
    else if (currency && currency !== account.currency) problems.set(source, 'currency');
    targets.set(source, {
      kind: 'new',
      placeholderId: account.placeholderId,
      name: account.name,
      currency: account.currency,
      ...(account.type ? { type: account.type } : {}),
    });
  });

  return { sources, routes, targets, newAccounts: [...newByName.values()], problems };
}
