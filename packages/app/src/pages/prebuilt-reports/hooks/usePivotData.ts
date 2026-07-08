import { useMemo } from 'react';
import { eachMonthOfInterval, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { Category, CategoryGroup, CategoryTotalsByPeriodRow } from '@budgero/core/browser';

const OTHER_GROUP_ID = -1;
export const MAX_MONTHS = 24; // Limit to 24 months to prevent performance issues

export interface MonthDefinition {
  key: string;
  label: string;
  start: string;
  end: string;
}

export interface CategoryRowData {
  id: number | null;
  name: string;
  groupId: number;
  groupName: string;
  monthValues: Record<string, number>;
  total: number;
}

export interface GroupRowData {
  groupId: number;
  groupName: string;
  categories: CategoryRowData[];
  monthTotals: Record<string, number>;
  total: number;
}

interface UsePivotDataArgs {
  dateRange: DateRange | undefined;
  categories: Category[];
  categoryGroups: CategoryGroup[];
  categoryTotals: CategoryTotalsByPeriodRow[] | undefined;
  selectedCategoryIds: number[];
}

/** Builds the category-pivot table's month columns, group rows, and totals. */
export function usePivotData({
  dateRange,
  categories,
  categoryGroups,
  categoryTotals,
  selectedCategoryIds,
}: UsePivotDataArgs) {
  const { months, isTruncated } = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) {
      return { months: [], isTruncated: false };
    }
    const firstMonth = startOfMonth(dateRange.from);
    const lastMonth = startOfMonth(dateRange.to);
    const allMonths = eachMonthOfInterval({ start: firstMonth, end: lastMonth });

    const truncated = allMonths.length > MAX_MONTHS;
    const monthsToUse = truncated ? allMonths.slice(-MAX_MONTHS) : allMonths;

    const monthDefs: MonthDefinition[] = monthsToUse.map((monthDate) => {
      const key = format(monthDate, 'yyyy-MM');
      const start = format(monthDate, 'yyyy-MM-01');
      const end = format(endOfMonth(monthDate), 'yyyy-MM-dd');
      return {
        key,
        label: format(monthDate, 'MMM yyyy'),
        start,
        end,
      };
    });

    return { months: monthDefs, isTruncated: truncated };
  }, [dateRange]);

  const groupLookup = useMemo(() => {
    const map = new Map<number, { ID: number; Name: string }>();
    categoryGroups.forEach((group) => {
      map.set(group.ID, { ID: group.ID, Name: group.Name });
    });
    map.set(OTHER_GROUP_ID, { ID: OTHER_GROUP_ID, Name: 'Other categories' });
    return map;
  }, [categoryGroups]);

  const totalsByCategory = useMemo(() => {
    const map = new Map<number, Map<string, number>>();
    (categoryTotals ?? []).forEach((row) => {
      if (row.CategoryGroupName === 'Transfers') return;
      const categoryKey = row.CategoryID ?? OTHER_GROUP_ID;
      const monthKey = row.PeriodStart
        ? format(parseISO(row.PeriodStart), 'yyyy-MM')
        : row.Period || '';
      if (!monthKey) return;
      if (!map.has(categoryKey)) {
        map.set(categoryKey, new Map());
      }
      const monthMap = map.get(categoryKey);
      if (!monthMap) return;
      const current = monthMap.get(monthKey) ?? 0;
      const income = row.TotalIncome ?? 0;
      const outflow = row.TotalOutflow ?? 0;
      monthMap.set(monthKey, current + (income - outflow));
    });
    return map;
  }, [categoryTotals]);

  const baseCategories = useMemo(() => {
    const transferGroupId = categoryGroups.find((g) => g.Name === 'Transfers')?.ID;
    const list: { id: number | null; name: string; groupId: number }[] = categories
      .filter((category) => category.CategoryGroupID !== transferGroupId)
      .map((category) => ({
        id: category.ID,
        name: category.Name,
        groupId: category.CategoryGroupID ?? OTHER_GROUP_ID,
      }));
    if (totalsByCategory.has(OTHER_GROUP_ID)) {
      list.push({ id: null, name: 'Uncategorized', groupId: OTHER_GROUP_ID });
    }
    return list;
  }, [categories, categoryGroups, totalsByCategory]);

  const filteredCategories = useMemo(() => {
    if (!selectedCategoryIds.length) return baseCategories;
    return baseCategories.filter((category) => {
      if (category.id === null) return false;
      return selectedCategoryIds.includes(category.id);
    });
  }, [baseCategories, selectedCategoryIds]);

  const categoryRows = useMemo<CategoryRowData[]>(() => {
    return filteredCategories
      .map((category) => {
        const monthMap = totalsByCategory.get(category.id ?? OTHER_GROUP_ID) ?? new Map();
        const monthValues: Record<string, number> = {};
        let total = 0;

        months.forEach((month) => {
          const value = monthMap.get(month.key) ?? 0;
          monthValues[month.key] = value;
          total += value;
        });

        const group = groupLookup.get(category.groupId) ??
          groupLookup.get(OTHER_GROUP_ID) ?? { ID: OTHER_GROUP_ID, Name: 'Other categories' };

        return {
          id: category.id,
          name: category.name,
          groupId: group.ID,
          groupName: group.Name,
          monthValues,
          total,
        };
      })
      .sort((a, b) => {
        if (a.groupName === b.groupName) {
          return a.name.localeCompare(b.name);
        }
        return a.groupName.localeCompare(b.groupName);
      });
  }, [filteredCategories, months, totalsByCategory, groupLookup]);

  const { groupRows, columnTotals, overallTotals } = useMemo(() => {
    const groups = new Map<number, GroupRowData>();
    const columnMap = new Map<string, number>();

    categoryRows.forEach((row) => {
      if (!groups.has(row.groupId)) {
        groups.set(row.groupId, {
          groupId: row.groupId,
          groupName: row.groupName,
          categories: [],
          monthTotals: {},
          total: 0,
        });
      }
      const group = groups.get(row.groupId);
      if (!group) return;
      group.categories.push(row);

      months.forEach((month) => {
        const groupValue = group.monthTotals[month.key] ?? 0;
        const rowValue = row.monthValues[month.key] ?? 0;
        group.monthTotals[month.key] = groupValue + rowValue;

        const columnValue = columnMap.get(month.key) ?? 0;
        columnMap.set(month.key, columnValue + rowValue);
      });

      group.total += row.total;
    });

    const groupRowsArray = Array.from(groups.values()).sort((a, b) => {
      const aIncome = a.groupName === 'Income';
      const bIncome = b.groupName === 'Income';
      if (aIncome && !bIncome) return -1;
      if (bIncome && !aIncome) return 1;
      return a.groupName.localeCompare(b.groupName);
    });

    const overallTotalsValue = Array.from(columnMap.values()).reduce(
      (acc, value) => acc + value,
      0
    );

    return {
      groupRows: groupRowsArray,
      columnTotals: columnMap,
      overallTotals: overallTotalsValue,
    };
  }, [categoryRows, months]);

  return { months, isTruncated, groupRows, columnTotals, overallTotals };
}
