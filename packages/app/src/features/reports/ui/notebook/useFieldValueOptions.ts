import { useCallback, useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { useLabels } from '@entities/label/api/useLabels';
import { usePayees } from '@entities/payee/api/usePayees';
import type { ValueKind } from '@features/reports/lib/question';

export interface ValueOption<TValue extends string | number = string | number> {
  value: TValue;
  label: string;
  /** Optional group heading (e.g. the category group of a category). */
  group?: string;
}

export type FieldValueOptions = (kind: ValueKind) => ValueOption[];

const byPosition = <T extends { Position?: number; Name: string }>(a: T, b: T) =>
  (a.Position ?? 0) - (b.Position ?? 0) || a.Name.localeCompare(b.Name);

const distinctSorted = (values: (string | null | undefined)[]) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));

/**
 * The budget's actual values for filter pickers (categories, accounts, payees,
 * labels, account types, currencies), from the existing data hooks.
 */
export function useFieldValueOptions(budgetId: number): FieldValueOptions {
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: groups = [] } = useCategoryGroups(budgetId);
  const { data: categories = [] } = useCategories(budgetId);
  const { labels } = useLabels(budgetId);
  const { data: payees = [] } = usePayees(budgetId);

  const options = useMemo(() => {
    const sortedGroups = [...groups].sort(byPosition);
    const groupNames = new Map(sortedGroups.map((group) => [group.ID, group.Name]));
    const groupOrder = new Map(sortedGroups.map((group, index) => [group.ID, index]));
    const liveAccounts = [...accounts].filter((account) => !account.Deleted).sort(byPosition);

    return {
      account: liveAccounts.map((account) => ({ value: account.ID, label: account.Name })),
      categoryGroup: sortedGroups.map((group) => ({ value: group.ID, label: group.Name })),
      category: [...categories]
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
      payee: payees.map((name) => ({ value: name, label: name })),
      label: [...labels]
        .sort((a, b) => a.Name.localeCompare(b.Name))
        .map((label) => ({ value: label.ID, label: label.Name })),
      accountType: distinctSorted(liveAccounts.map((account) => account.Type)),
      currency: distinctSorted(liveAccounts.map((account) => account.Currency)),
      memo: [],
    } satisfies Record<ValueKind, ValueOption[]>;
  }, [accounts, groups, categories, labels, payees]);

  return useCallback((kind: ValueKind) => options[kind], [options]);
}
