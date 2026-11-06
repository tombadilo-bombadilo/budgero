/**
 * Where each account in an imported file goes. A file can hold several
 * accounts (an OFX with a current account and a card, a QIF from Quicken, a
 * CSV with an Account column); each source value is routed to an existing
 * account, a new one, or skipped.
 */
import type { AccountRoute } from '../model/types';

export interface SourceAccount {
  /** The value in the file's Account column (an account name, ACCTID or IBAN). */
  source: string;
  rows: number;
  /** Currency the file states for these rows (OFX/CAMT), if any. */
  currency?: string;
}

interface AccountLike {
  ID: number;
  Name: string;
}

/** -1 is the legacy single "Import Account"; each new source account gets its own id below it. */
const FIRST_PLACEHOLDER = -100;

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
    entry.currency ??= row.Currency || undefined;
    bySource.set(source, entry);
  }
  return [...bySource.values()];
}

/** The temporary account id the preview uses for a "new account" source. */
export function placeholderIdFor(source: string, sources: SourceAccount[]): number {
  const index = sources.findIndex((s) => s.source === source);
  return FIRST_PLACEHOLDER - Math.max(index, 0);
}

export function isNewAccountPlaceholder(accountId: number): boolean {
  return accountId <= FIRST_PLACEHOLDER;
}

function matchByName(source: string, accounts: AccountLike[]): AccountLike | undefined {
  const matches = accounts.filter((a) => a.Name.trim().toLowerCase() === source.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

const rememberKey = (budgetId: number) => `budgero:import-account-routes:${budgetId}`;

/** Earlier choices on this device, by source value (account id only). */
export function readRememberedRoutes(budgetId: number): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(rememberKey(budgetId)) ?? '{}') as Record<
      string,
      number
    >;
  } catch {
    return {};
  }
}

export function rememberRoutes(budgetId: number, chosen: Record<string, number>): void {
  if (Object.keys(chosen).length === 0) return;
  try {
    const next = { ...readRememberedRoutes(budgetId), ...chosen };
    localStorage.setItem(rememberKey(budgetId), JSON.stringify(next));
  } catch {
    /* storage blocked: the next import asks again */
  }
}

/**
 * The starting choice for each source: an account with the same name, else
 * the one picked for it last time, else a new account named after it.
 */
export function defaultRoutes(
  sources: SourceAccount[],
  accounts: AccountLike[],
  remembered: Record<string, number>,
  current: Record<string, AccountRoute> = {}
): Record<string, AccountRoute> {
  const routes: Record<string, AccountRoute> = {};
  for (const { source } of sources) {
    const kept = current[source];
    if (kept && (kept.kind !== 'existing' || accounts.some((a) => a.ID === kept.accountId))) {
      routes[source] = kept;
      continue;
    }
    const named = matchByName(source, accounts);
    const known = accounts.find((a) => a.ID === remembered[source]);
    const account = named ?? known;
    routes[source] = account
      ? { kind: 'existing', accountId: account.ID }
      : { kind: 'new', name: source };
  }
  return routes;
}
