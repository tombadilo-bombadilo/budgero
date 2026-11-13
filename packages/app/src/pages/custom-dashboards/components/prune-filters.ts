import type { DashboardFilters } from '@features/reports/lib/question';

/**
 * Drops selected accounts / category groups that no longer exist. An empty
 * list of existing ids means "not loaded yet" and prunes nothing. Returns the
 * same object when there is nothing to drop.
 */
export function pruneDashboardFilters(
  filters: DashboardFilters,
  existing: { accounts: readonly number[]; categoryGroups: readonly number[] }
): DashboardFilters {
  const keep = (selected: number[] | undefined, ids: readonly number[]) => {
    if (!selected?.length || ids.length === 0) return selected;
    const known = new Set(ids);
    const kept = selected.filter((id) => known.has(id));
    return kept.length === selected.length ? selected : kept;
  };
  const accounts = keep(filters.accounts, existing.accounts);
  const categoryGroups = keep(filters.categoryGroups, existing.categoryGroups);
  if (accounts === filters.accounts && categoryGroups === filters.categoryGroups) return filters;
  const next: DashboardFilters = { ...filters };
  if (accounts?.length) next.accounts = accounts;
  else delete next.accounts;
  if (categoryGroups?.length) next.categoryGroups = categoryGroups;
  else delete next.categoryGroups;
  return next;
}
