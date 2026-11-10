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
import { isCryptoCurrency } from '@budgero/core/browser';
import type { AccountRoute } from '../model/types';

export interface SourceAccount {
  /** The value in the file's Account column (an account name, ACCTID or IBAN). */
  source: string;
  rows: number;
  /** Currency the file states for these rows (OFX/CAMT, or a Currency column), if any. */
  currency?: string;
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

export function sourceAccountsOf(
  rows: Record<string, string>[],
  column: string | undefined
): SourceAccount[] {
  if (!column) return [];
  const bySource = new Map<string, SourceAccount>();
  for (const row of rows) {
    const source = row[column]?.trim();
    if (!source) continue;
    const entry = bySource.get(source) ?? { source, rows: 0 };
    entry.rows += 1;
    const currency = entry.currency ?? currencyCodeOf(row.Currency);
    if (currency) entry.currency = currency;
    bySource.set(source, entry);
  }
  return [...bySource.values()];
}

const rememberKey = (budgetId: number) => `budgero:import-account-routes:${budgetId}`;
/** Oldest choices are dropped beyond this, so the list cannot grow without bound. */
const MAX_REMEMBERED = 200;

/** Earlier choices on this device, by source value (account id only). */
export function readRememberedRoutes(budgetId: number): Record<string, number> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(rememberKey(budgetId)) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(([, id]) => typeof id === 'number' && Number.isInteger(id))
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function rememberRoutes(budgetId: number, chosen: Record<string, number>): void {
  if (Object.keys(chosen).length === 0) return;
  try {
    // Re-insert what was just chosen so it is the newest.
    const merged = new Map(Object.entries(readRememberedRoutes(budgetId)));
    for (const [source, id] of Object.entries(chosen)) {
      merged.delete(source);
      merged.set(source, id);
    }
    const kept = [...merged].slice(-MAX_REMEMBERED);
    localStorage.setItem(rememberKey(budgetId), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage blocked: the next import asks again */
  }
}

const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.getOwnPropertyDescriptor(record, key)?.value as T | undefined;

/**
 * The route for each source: what the user picked (unless that account is
 * gone), else an open account with the same name, else the open account
 * picked for it last time, else a new account named after it.
 */
export function defaultRoutes(
  sources: SourceAccount[],
  accounts: RoutableAccount[],
  remembered: Record<string, number>,
  chosen: Record<string, AccountRoute> = {}
): Record<string, AccountRoute> {
  const open = accounts.filter((a) => !a.Archived);
  const routes: Record<string, AccountRoute> = Object.create(null) as Record<string, AccountRoute>;
  for (const { source } of sources) {
    const kept = own(chosen, source);
    if (kept && (kept.kind !== 'existing' || accounts.some((a) => a.ID === kept.accountId))) {
      routes[source] = kept;
      continue;
    }
    const sameName = open.filter((a) => accountNameKey(a.Name) === accountNameKey(source));
    const named = sameName.length === 1 ? sameName[0] : undefined;
    const known = open.find((a) => a.ID === own(remembered, source));
    const account = named ?? known;
    routes[source] = account
      ? { kind: 'existing', accountId: account.ID }
      : { kind: 'new', name: source };
  }
  return routes;
}

export type RouteTarget =
  | { kind: 'skip' }
  | { kind: 'existing'; accountId: number }
  | { kind: 'new'; placeholderId: number; name: string; currency: string };

/**
 * Why a source cannot be imported as routed:
 * - name-taken: the new account's name is already an account in the budget;
 * - currency: it shares a new account with a source in another currency.
 */
export type RouteProblem = 'name-taken' | 'currency';

export interface NewAccountPlan {
  placeholderId: number;
  name: string;
  currency: string;
  /** The sources that go into it (several when they were given the same name). */
  sources: string[];
}

export interface AccountRoutePlan {
  sources: SourceAccount[];
  routes: Record<string, AccountRoute>;
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
}

export function planAccountRoutes({
  rows,
  column,
  accounts,
  remembered = {},
  chosen = {},
  newAccountCurrency,
}: PlanOptions): AccountRoutePlan {
  const sources = sourceAccountsOf(rows, column);
  const routes = defaultRoutes(sources, accounts, remembered, chosen);
  const takenNames = new Set(accounts.map((a) => accountNameKey(a.Name)));
  const targets = new Map<string, RouteTarget>();
  const problems = new Map<string, RouteProblem>();
  const newByName = new Map<string, NewAccountPlan>();

  sources.forEach(({ source, currency }, index) => {
    const route = routes[source];
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
    });
  });

  return { sources, routes, targets, newAccounts: [...newByName.values()], problems };
}
