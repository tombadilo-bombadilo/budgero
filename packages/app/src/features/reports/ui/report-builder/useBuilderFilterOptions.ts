import { useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { useLabels } from '@entities/label/api/useLabels';
import { usePayees } from '@entities/payee/api/usePayees';
import type { BuilderOption } from './BuilderMultiSelect';

export interface BuilderFilterOptions {
  accounts: BuilderOption<number>[];
  categoryGroups: BuilderOption<number>[];
  categories: BuilderOption<number>[];
  payees: BuilderOption<string>[];
  labels: BuilderOption<number>[];
}

const byPosition = <T extends { Position?: number; Name: string }>(a: T, b: T) =>
  (a.Position ?? 0) - (b.Position ?? 0) || a.Name.localeCompare(b.Name);

/** Filter choices for the report builder, from the budget's existing data hooks. */
export function useBuilderFilterOptions(budgetId: number): BuilderFilterOptions {
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: groups = [] } = useCategoryGroups(budgetId);
  const { data: categories = [] } = useCategories(budgetId);
  const { labels } = useLabels(budgetId);
  const { data: payees = [] } = usePayees(budgetId);

  return useMemo(() => {
    const sortedGroups = [...groups].sort(byPosition);
    const groupNames = new Map(sortedGroups.map((group) => [group.ID, group.Name]));
    const groupOrder = new Map(sortedGroups.map((group, index) => [group.ID, index]));

    return {
      accounts: [...accounts]
        .filter((account) => !account.Deleted)
        .sort(byPosition)
        .map((account) => ({ value: account.ID, label: account.Name })),
      categoryGroups: sortedGroups.map((group) => ({ value: group.ID, label: group.Name })),
      categories: [...categories]
        .sort(
          (a, b) =>
            (groupOrder.get(a.CategoryGroupID) ?? 0) - (groupOrder.get(b.CategoryGroupID) ?? 0) ||
            byPosition(a, b)
        )
        .map((category) => ({
          value: category.ID,
          label: category.Name,
          group: groupNames.get(category.CategoryGroupID),
        })),
      payees: payees.map((name) => ({ value: name, label: name })),
      labels: [...labels]
        .sort((a, b) => a.Name.localeCompare(b.Name))
        .map((label) => ({ value: label.ID, label: label.Name })),
    };
  }, [accounts, groups, categories, labels, payees]);
}
