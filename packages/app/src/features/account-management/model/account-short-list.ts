/**
 * The accounts a sidebar section shows while it is collapsed ("Show Less").
 * The user can pin accounts to that short list; a section with pinned
 * accounts shows exactly those, a section without keeps the automatic pick.
 */
export const ACCOUNT_SHORT_LIST_KEY = 'accountShortList';

/** Stored value: a set of account ids, {id: true} (synced state, merge). */
export type StoredAccountShortList = Record<string, true>;

export function parseAccountShortList(value: unknown): ReadonlySet<number> {
  const ids = new Set<number>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ids;
  for (const [key, flag] of Object.entries(value)) {
    const id = Number(key);
    if (flag === true && Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/**
 * The collapsed list of one section: its pinned accounts in list order, or
 * `fallback(list)` when none of them is pinned.
 */
export function pickShortList<T extends { ID: number }>(
  list: T[],
  pinnedIds: ReadonlySet<number>,
  fallback: (list: T[]) => T[]
): T[] {
  const pinned = list.filter((account) => pinnedIds.has(account.ID));
  return pinned.length > 0 ? pinned : fallback(list);
}
