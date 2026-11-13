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
import type { SyncedStateMergePatch } from '@shared/lib/synced-state';
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

/**
 * Earlier choices live in the budget's synced state (budgetScope, key
 * ACCOUNT_ROUTES_KEY), shared by every member and device of the workspace,
 * like rules. Value: a map of routeEntryKey(source) → { accountId, usedAt }.
 * The entry key is prefixed, so a source named __proto__ is a key like any
 * other. Entries are stored in key order, so usedAt (ms) says which are newest.
 */
export const ACCOUNT_ROUTES_KEY = 'importAccountRoutes';
/** Oldest choices are dropped beyond this, so the map cannot grow without bound. */
const MAX_REMEMBERED = 200;
/**
 * Longer sources (free-text names) are not remembered: 200 entries then stay
 * well under the synced value cap. IBANs and ACCTIDs are far shorter.
 */
const MAX_REMEMBERED_SOURCE = 120;

export interface StoredRoute {
  accountId: number;
  usedAt: number;
}

export function routeEntryKey(source: string): string | null {
  return source && source.length <= MAX_REMEMBERED_SOURCE ? `s:${source}` : null;
}

function storedRoutes(stored: unknown): [string, StoredRoute][] {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  return Object.entries(stored).filter((entry): entry is [string, StoredRoute] => {
    const [key, route] = entry as [string, Partial<StoredRoute> | null];
    return (
      key.startsWith('s:') &&
      Number.isInteger(route?.accountId) &&
      typeof route?.usedAt === 'number'
    );
  });
}

/** The stored map as source → account id. */
export function rememberedRoutesOf(stored: unknown): Record<string, number> {
  // No prototype: a source named __proto__ is a key like any other.
  const routes = Object.create(null) as Record<string, number>;
  for (const [key, route] of storedRoutes(stored)) routes[key.slice(2)] = route.accountId;
  return routes;
}

/** Adds `set` and drops the oldest entries beyond MAX_REMEMBERED; null when `set` is empty. */
function cappedPatch(
  stored: unknown,
  set: Record<string, StoredRoute>
): SyncedStateMergePatch | null {
  if (Object.keys(set).length === 0) return null;
  const before = new Map(storedRoutes(stored));
  const all = new Map(before);
  for (const [key, route] of Object.entries(set)) all.set(key, route);
  const dropped = [...all]
    .sort(([ka, a], [kb, b]) => a.usedAt - b.usedAt || (ka < kb ? -1 : 1))
    .slice(0, Math.max(0, all.size - MAX_REMEMBERED))
    .map(([key]) => key);
  const remove = dropped.filter((key) => before.has(key));
  for (const key of dropped) delete set[key];
  if (Object.keys(set).length === 0 && remove.length === 0) return null;
  return { ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { remove } : {}) };
}

/**
 * The merge patch that records `chosen` (source → account id) as used at
 * `now`. Null when there is nothing to remember.
 */
export function rememberRoutesPatch(
  stored: unknown,
  chosen: Record<string, number>,
  now: number
): SyncedStateMergePatch | null {
  const set: Record<string, StoredRoute> = {};
  for (const [source, accountId] of Object.entries(chosen)) {
    const key = routeEntryKey(source);
    if (key && Number.isInteger(accountId)) set[key] = { accountId, usedAt: now };
  }
  return cappedPatch(stored, set);
}

/** Where this device kept choices before they were synced (per space and budget). */
export const legacyRememberKeys = (spaceId: string, budgetId: number): string[] => [
  `budgero:import-account-routes:${encodeURIComponent(spaceId)}:${budgetId}`,
  // Older still, keyed by budget only; ids could leak between spaces, so never read.
  `budgero:import-account-routes:${budgetId}`,
];

/** This device's choices from before syncing, oldest first (account id only). */
export function readLegacyRememberedRoutes(spaceId: string, budgetId: number): [string, number][] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(legacyRememberKeys(spaceId, budgetId)[0]) ?? '{}'
    );
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
    return Object.entries(stored).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isInteger(entry[1])
    );
  } catch {
    return [];
  }
}

/**
 * The merge patch that adds the legacy choices the synced map lacks, in their
 * old order just before `now`. Null when it adds nothing.
 */
export function legacyRoutesPatch(
  stored: unknown,
  legacy: [string, number][],
  now: number
): SyncedStateMergePatch | null {
  const known = new Set(storedRoutes(stored).map(([key]) => key));
  const set: Record<string, StoredRoute> = {};
  legacy.forEach(([source, accountId], index) => {
    const key = routeEntryKey(source);
    if (key && !known.has(key)) set[key] = { accountId, usedAt: now - (legacy.length - index) };
  });
  return cappedPatch(stored, set);
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
