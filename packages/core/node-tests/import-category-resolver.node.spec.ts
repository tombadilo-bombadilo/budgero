import { describe, expect, it, vi } from 'vitest';
import {
  IMPORT_CATEGORIES_GROUP_NAME,
  createImportNameMaps,
  resolveImportCategoryId,
} from '../src/services/import/category-resolver.js';

describe('import category resolver', () => {
  it('reuses existing category by normalized name', async () => {
    const { categoryIdByName, categoryGroupIdByName } = createImportNameMaps({
      categories: [
        { ID: 1, Name: 'Income' },
        { ID: 2, Name: 'Uncategorized' },
        { ID: 3, Name: 'Groceries' },
      ],
      categoryGroups: [{ ID: 10, Name: 'Household' }],
    });

    const addCategoryGroup = vi.fn(async () => 100);
    const addCategory = vi.fn(async () => 200);

    const categoryId = await resolveImportCategoryId({
      columnCategory: 'Category',
      row: { Category: '  groceries ' },
      inflow: 0,
      incomeId: 1,
      uncategorizedId: 2,
      selectedBudgetId: 77,
      categoryIdByName,
      categoryGroupIdByName,
      addCategoryGroup,
      addCategory,
    });

    expect(categoryId).toBe(3);
    expect(addCategoryGroup).not.toHaveBeenCalled();
    expect(addCategory).not.toHaveBeenCalled();
  });

  it('creates import group once and categories once per unique name across rows', async () => {
    const { categoryIdByName, categoryGroupIdByName } = createImportNameMaps({
      categories: [
        { ID: 1, Name: 'Income' },
        { ID: 2, Name: 'Uncategorized' },
      ],
      categoryGroups: [],
    });

    const createdIdsByName = new Map<string, number>([
      ['Food', 101],
      ['Rent', 102],
    ]);
    const addCategoryGroup = vi.fn(async () => 55);
    const addCategory = vi.fn(
      async ({ name }: { name: string }) => createdIdsByName.get(name) ?? 0
    );

    const inputs = ['Food', 'Food', 'Rent', ' rent '];
    const resolvedIds: number[] = [];

    for (const value of inputs) {
      resolvedIds.push(
        await resolveImportCategoryId({
          columnCategory: 'Category',
          row: { Category: value },
          inflow: 0,
          incomeId: 1,
          uncategorizedId: 2,
          selectedBudgetId: 77,
          categoryIdByName,
          categoryGroupIdByName,
          addCategoryGroup,
          addCategory,
        })
      );
    }

    expect(addCategoryGroup).toHaveBeenCalledTimes(1);
    expect(addCategoryGroup).toHaveBeenCalledWith({
      name: IMPORT_CATEGORIES_GROUP_NAME,
      budgetId: 77,
    });
    expect(addCategory).toHaveBeenCalledTimes(2);
    expect(addCategory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'Food', groupId: 55, budgetId: 77 })
    );
    expect(addCategory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'Rent', groupId: 55, budgetId: 77 })
    );
    expect(resolvedIds).toEqual([101, 101, 102, 102]);
  });

  it('falls back without creating when budget is missing', async () => {
    const { categoryIdByName, categoryGroupIdByName } = createImportNameMaps({
      categories: [],
      categoryGroups: [],
    });

    const addCategoryGroup = vi.fn(async () => 55);
    const addCategory = vi.fn(async () => 101);

    const categoryId = await resolveImportCategoryId({
      columnCategory: 'Category',
      row: { Category: 'Food' },
      inflow: 0,
      incomeId: 1,
      uncategorizedId: 2,
      selectedBudgetId: undefined,
      categoryIdByName,
      categoryGroupIdByName,
      addCategoryGroup,
      addCategory,
    });

    expect(categoryId).toBe(2);
    expect(addCategoryGroup).not.toHaveBeenCalled();
    expect(addCategory).not.toHaveBeenCalled();
  });

  it('falls back when category creation fails', async () => {
    const { categoryIdByName, categoryGroupIdByName } = createImportNameMaps({
      categories: [],
      categoryGroups: [],
    });

    const addCategoryGroup = vi.fn(async () => 55);
    const addCategory = vi.fn(async () => {
      throw new Error('failed');
    });

    const categoryId = await resolveImportCategoryId({
      columnCategory: 'Category',
      row: { Category: 'Food' },
      inflow: 0,
      incomeId: 1,
      uncategorizedId: 2,
      selectedBudgetId: 77,
      categoryIdByName,
      categoryGroupIdByName,
      addCategoryGroup,
      addCategory,
    });

    expect(categoryId).toBe(2);
    expect(addCategoryGroup).toHaveBeenCalledTimes(1);
    expect(addCategory).toHaveBeenCalledTimes(1);
  });
});
