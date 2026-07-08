export const IMPORT_CATEGORIES_GROUP_NAME = 'Import Categories';

type NameEntity = {
  ID: number;
  Name: string;
};

export type AddImportCategoryGroup = (input: { name: string; budgetId: number }) => Promise<number>;

export type AddImportCategory = (input: {
  name: string;
  groupId: number;
  budgetId: number;
  note: string;
}) => Promise<number>;

export interface ResolveImportCategoryIdParams {
  columnCategory?: string;
  row: Record<string, string>;
  inflow: number;
  incomeId: number;
  uncategorizedId: number;
  selectedBudgetId?: number;
  categoryIdByName: Map<string, number>;
  categoryGroupIdByName: Map<string, number>;
  addCategoryGroup: AddImportCategoryGroup;
  addCategory: AddImportCategory;
  onCategoryCreated?: (categoryId: number) => void;
}

export function normalizeImportName(value: string): string {
  return value.trim().toLowerCase();
}

export function createImportNameMap(
  items: NameEntity[] | undefined,
  normalizeName: (value: string) => string = normalizeImportName
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items ?? []) {
    map.set(normalizeName(item.Name), item.ID);
  }
  return map;
}

export function createImportNameMaps(params: {
  categories: NameEntity[] | undefined;
  categoryGroups: NameEntity[] | undefined;
  normalizeName?: (value: string) => string;
}): {
  categoryIdByName: Map<string, number>;
  categoryGroupIdByName: Map<string, number>;
} {
  const normalizeName = params.normalizeName ?? normalizeImportName;
  return {
    categoryIdByName: createImportNameMap(params.categories, normalizeName),
    categoryGroupIdByName: createImportNameMap(params.categoryGroups, normalizeName),
  };
}

export async function resolveImportCategoryId(
  params: ResolveImportCategoryIdParams
): Promise<number> {
  const {
    columnCategory,
    row,
    inflow,
    incomeId,
    uncategorizedId,
    selectedBudgetId,
    categoryIdByName,
    categoryGroupIdByName,
    addCategoryGroup,
    addCategory,
    onCategoryCreated,
  } = params;

  const fallbackId = inflow > 0 ? incomeId : uncategorizedId;
  if (!columnCategory) return fallbackId;

  const categoryName = row[columnCategory]?.trim();
  if (!categoryName) return fallbackId;

  const normalizedCategoryName = normalizeImportName(categoryName);
  if (normalizedCategoryName === 'income') return incomeId;
  if (normalizedCategoryName === 'uncategorized') return uncategorizedId;

  const existingCategoryId = categoryIdByName.get(normalizedCategoryName);
  if (typeof existingCategoryId === 'number') return existingCategoryId;

  if (typeof selectedBudgetId !== 'number') return fallbackId;

  try {
    const normalizedImportGroupName = normalizeImportName(IMPORT_CATEGORIES_GROUP_NAME);
    let importGroupId = categoryGroupIdByName.get(normalizedImportGroupName);

    if (typeof importGroupId !== 'number') {
      importGroupId = await addCategoryGroup({
        name: IMPORT_CATEGORIES_GROUP_NAME,
        budgetId: selectedBudgetId,
      });
      categoryGroupIdByName.set(normalizedImportGroupName, importGroupId);
    }

    const newCategoryId = await addCategory({
      name: categoryName,
      groupId: importGroupId,
      budgetId: selectedBudgetId,
      note: 'Auto-created during CSV import',
    });

    categoryIdByName.set(normalizedCategoryName, newCategoryId);
    onCategoryCreated?.(newCategoryId);
    return newCategoryId;
  } catch {
    return fallbackId;
  }
}
