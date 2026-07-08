import { S, makeRestoreUndo, safeCapture, type CategoryRow, type OpCodeEntry } from '../shared';

export const categoryOps = {
  'categoryGroups.create': {
    execute: async (args) => {
      return await S().categories!.addCategoryGroup(args.name as string, args.budgetId as number);
    },
    invalidates: [
      ['categoryGroups', '*'], // Will match ["categoryGroups", budgetId]
      ['monthlyBudget', '*'],
    ],
    undo: {
      // create -> delete
      build: (_args, result) => {
        const id = result as number;
        return Number.isFinite(id) ? [{ op: 'categoryGroups.delete', args: { id } }] : [];
      },
    },
  },

  // useUpdateCategoryGroup
  'categoryGroups.update': {
    execute: async (args) => {
      return await S().categories!.updateCategoryGroup(args.id as number, args.name as string);
    },
    invalidates: [
      ['categoryGroups', '*'], // Will match ["categoryGroups", budgetId]
      ['monthlyBudget', '*'],
    ],
    undo: makeRestoreUndo(
      'categoryGroups.update',
      (args) => ({ oldName: S().categories!.getCategoryGroup(args.id as number)?.Name }),
      (args, snapshot) => ({ id: args.id, name: snapshot.oldName })
    ),
  },

  // useDeleteCategoryGroup
  'categoryGroups.delete': {
    execute: async (args) => {
      return await S().categories!.deleteCategoryGroup(args.id as number);
    },
    invalidates: [
      ['categoryGroups', '*'], // Will match ["categoryGroups", budgetId]
      ['categories', '*'], // Will match ["categories", budgetId]
      ['monthlyBudget', '*'],
      ['readyToAssign', '*'], // Will match ["readyToAssign", budgetId]
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() => {
          const group = S().categories!.getCategoryGroup(args.id as number);
          return { name: group?.Name, budgetId: group?.BudgetID };
        }),
      build: (_args, _result, before) => {
        const snapshot = before as { name?: string; budgetId?: number } | null | undefined;
        if (!snapshot?.name || !snapshot?.budgetId) return [];
        return [
          {
            op: 'categoryGroups.create',
            args: { name: snapshot.name, budgetId: snapshot.budgetId },
          },
        ];
      },
    },
  },

  // useAddCategory
  'categories.create': {
    execute: async (args) => {
      return await S().categories!.addCategory(
        args.parentId as number, // groupId
        args.budgetId as number,
        args.name as string,
        args.note as string
      );
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['monthlyBudget', '*'],
    ],
    undo: {
      // create -> delete
      build: (_args, result) => {
        const id = result as number;
        return Number.isFinite(id) ? [{ op: 'categories.delete', args: { id } }] : [];
      },
    },
  },

  // useUpdateCategoryName
  'categories.updateName': {
    execute: async (args) => {
      return await S().categories!.updateCategoryName(args.id as number, args.name as string);
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['monthlyBudget', '*'],
    ],
    undo: makeRestoreUndo(
      'categories.updateName',
      (args) => ({ oldName: S().categories!.getCategory(args.id as number)?.Name }),
      (args, snapshot) => ({ id: args.id, name: snapshot.oldName })
    ),
  },

  // useUpdateCategoryExcludeFromBudgetPace
  'categories.updateExcludeFromBudgetPace': {
    execute: async (args) => {
      const catService = S().categories as {
        updateCategoryExcludeFromBudgetPace?: (id: number, value: boolean) => void | Promise<void>;
      };
      if (!catService.updateCategoryExcludeFromBudgetPace) {
        throw new Error('updateCategoryExcludeFromBudgetPace not available');
      }
      return catService.updateCategoryExcludeFromBudgetPace(
        args.id as number,
        args.excludeFromBudgetPace as boolean
      );
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['monthlyBudget', '*'],
    ],
    // Bespoke undo: false is a valid captured value, so makeRestoreUndo's
    // truthy-bail would wrongly drop it.
    undo: {
      capture: async (args) =>
        safeCapture(() => {
          const category = S().categories!.getCategory(args.id as number) as
            | CategoryRow
            | undefined;
          return { oldValue: category?.ExcludeFromBudgetPace ?? false };
        }),
      build: (args, _result, before) => {
        const snapshot = before as { oldValue?: boolean } | null | undefined;
        if (snapshot?.oldValue === undefined) return [];
        return [
          {
            op: 'categories.updateExcludeFromBudgetPace',
            args: { id: args.id, excludeFromBudgetPace: snapshot.oldValue },
          },
        ];
      },
    },
  },

  // useDeleteCategory
  'categories.delete': {
    execute: async (args) => {
      return await S().categories!.deleteCategory(args.id as number);
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['monthlyBudget', '*'],
      ['readyToAssign', '*'], // Will match ["readyToAssign", budgetId]
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() => {
          const category = S().categories!.getCategory(args.id as number);
          return {
            name: category?.Name,
            note: category?.Note ?? '',
            groupId: category?.CategoryGroupID,
            budgetId: category?.BudgetID,
          };
        }),
      build: (_args, _result, before) => {
        const snapshot = before as
          | { name?: string; note?: string; groupId?: number; budgetId?: number }
          | null
          | undefined;
        if (!snapshot?.name || !snapshot?.groupId || !snapshot?.budgetId) return [];
        return [
          {
            op: 'categories.create',
            args: {
              parentId: snapshot.groupId,
              budgetId: snapshot.budgetId,
              name: snapshot.name,
              note: snapshot.note ?? '',
            },
          },
        ];
      },
    },
  },

  // useMoveCategoryToNewGroup
  'categories.moveToNewGroup': {
    execute: async (args) => {
      return await S().categories!.moveCategoryToNewGroup(
        args.newGroupId as number,
        args.categoryId as number
      );
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['categoryGroups', '*'], // Will match ["categoryGroups", budgetId]
      ['monthlyBudget', '*'],
    ],
    undo: makeRestoreUndo(
      'categories.moveToNewGroup',
      (args) => ({
        oldGroupId: S().categories!.getCategory(args.categoryId as number)?.CategoryGroupID,
      }),
      (args, snapshot) => ({ categoryId: args.categoryId, newGroupId: snapshot.oldGroupId })
    ),
  },

  // useReorderCategoryGroups
  'categoryGroups.reorder': {
    execute: async (args) => {
      const catService = S().categories as {
        reorderCategoryGroups?: (budgetId: number, orderedGroupIds: number[]) => void;
      };
      if (!catService.reorderCategoryGroups) {
        throw new Error('reorderCategoryGroups not available');
      }
      return catService.reorderCategoryGroups(
        args.budgetId as number,
        args.orderedGroupIds as number[]
      );
    },
    invalidates: [
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
    ],
  },

  // useReorderCategories
  'categories.reorder': {
    execute: async (args) => {
      const catService = S().categories as {
        reorderCategories?: (categoryGroupId: number, orderedCategoryIds: number[]) => void;
      };
      if (!catService.reorderCategories) {
        throw new Error('reorderCategories not available');
      }
      return catService.reorderCategories(
        args.categoryGroupId as number,
        args.orderedCategoryIds as number[]
      );
    },
    invalidates: [
      ['categories', '*'],
      ['monthlyBudget', '*'],
    ],
  },
} satisfies Record<string, OpCodeEntry>;
