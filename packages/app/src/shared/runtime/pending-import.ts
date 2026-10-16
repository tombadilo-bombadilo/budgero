/**
 * Out-of-band imports (YNAB) write a whole budget straight into the local DB,
 * outside the mutation log, and hold snapshot uploads until the user accepts
 * it. If the tab dies before that, the local DB file may already contain the
 * half-written budget while nothing in memory remembers it. This durable
 * marker lets the next start remove it before anything can upload it.
 */

const STORAGE_KEY = 'budgero_pending_import_v1';

export interface PendingImport {
  spaceId: string;
  budgetId: number;
  /** Must still match, so a later budget that reused the ID is never touched. */
  name: string;
}

/** Imports running in this page: their budgets are not leftovers. */
const live = new Set<string>();

const liveKey = (spaceId: string, budgetId: number) => `${spaceId}:${budgetId}`;

function read(): PendingImport[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is PendingImport =>
            !!entry &&
            typeof entry.spaceId === 'string' &&
            typeof entry.budgetId === 'number' &&
            typeof entry.name === 'string'
        )
      : [];
  } catch {
    return [];
  }
}

function write(entries: PendingImport[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (entries.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* no-op: best effort, the in-page path still cleans up */
  }
}

export function markPendingImport(entry: PendingImport): void {
  live.add(liveKey(entry.spaceId, entry.budgetId));
  write([
    ...read().filter((e) => !(e.spaceId === entry.spaceId && e.budgetId === entry.budgetId)),
    entry,
  ]);
}

export function clearPendingImport(spaceId: string, budgetId: number): void {
  live.delete(liveKey(spaceId, budgetId));
  write(read().filter((e) => !(e.spaceId === spaceId && e.budgetId === budgetId)));
}

/**
 * Remove budgets left by imports that were interrupted in an earlier page
 * (never accepted, never uploaded). Returns the removed budget IDs.
 */
export function discardInterruptedImports(
  spaceId: string,
  budgets: {
    getAllBudgets(): { ID: number; Name: string; SpaceID: string }[];
    deleteBudget(id: number): void;
  }
): number[] {
  const leftovers = read().filter(
    (e) => e.spaceId === spaceId && !live.has(liveKey(e.spaceId, e.budgetId))
  );
  if (leftovers.length === 0) return [];
  const existing = budgets.getAllBudgets();
  const removed: number[] = [];
  for (const entry of leftovers) {
    const budget = existing.find((b) => b.ID === entry.budgetId);
    if (budget && budget.Name === entry.name && budget.SpaceID === entry.spaceId) {
      budgets.deleteBudget(entry.budgetId);
      removed.push(entry.budgetId);
    }
    clearPendingImport(entry.spaceId, entry.budgetId);
  }
  return removed;
}
