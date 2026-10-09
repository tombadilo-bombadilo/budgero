import type { FundingPriorityUpdate } from '@budgero/core/browser';
import {
  S,
  makeRestoreUndo,
  redoWithIds,
  safeCapture,
  type CategoryRow,
  type OpCodeEntry,
} from '../shared';

export const categoryOps = {
  'categories.updateFundingPriorities': {
    execute: async (args) =>
      S().categories.updateFundingPriorities(
        args.budgetId as number,
        args.updates as FundingPriorityUpdate[]
      ),
    invalidates: [
      ['categories', '*'],
      ['monthlyBudget', '*'],
    ],
    undo: {
      capture: async (args) =>
        (args.updates as FundingPriorityUpdate[]).map(({ categoryId }) => ({
          categoryId,
          priority: S().categories.getCategory(categoryId).FundingPriority ?? 3,
        })),
      build: (args, _result, before) => [
        {
          op: 'categories.updateFundingPriorities',
          args: { budgetId: args.budgetId, updates: before },
        },
      ],
    },
  },
  'categories.updateDetails': {
    execute: async (args) =>
      S().categories.updateCategoryDetails(
        args.budgetId as number,
        args.id as number,
        args.name as string,
        args.excludeFromBudgetPace as boolean,
        args.priority as number
      ),
    invalidates: [
      ['categories', '*'],
      ['monthlyBudget', '*'],
    ],
    undo: {
      capture: async (args) => {
        const category = S().categories.getCategory(args.id as number);
        return {
          name: category.Name,
          excludeFromBudgetPace: !!category.ExcludeFromBudgetPace,
          priority: category.FundingPriority ?? 3,
        };
      },
      build: (args, _result, before) => [
        {
          op: 'categories.updateDetails',
          args: { id: args.id, budgetId: args.budgetId, ...(before as Record<string, unknown>) },
        },
      ],
    },
  },
  'categoryGroups.create': {
    execute: async (args) => {
      return await S().categories!.addCategoryGroup(
        args.name as string,
        args.budgetId as number,
        (args.id as number | undefined) ?? undefined
      );
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
    redo: redoWithIds('categoryGroups.create', (args, result) =>
      typeof result === 'number' ? { ...args, id: result } : null
    ),
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
      build: (args, _result, before) => {
        const snapshot = before as { name?: string; budgetId?: number } | null | undefined;
        if (!snapshot?.name || !snapshot?.budgetId) return [];
        return [
          {
            op: 'categoryGroups.create',
            args: { id: args.id, name: snapshot.name, budgetId: snapshot.budgetId },
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
        args.note as string,
        (args.fundingPriority as number | undefined) ?? 3,
        (args.id as number | undefined) ?? undefined
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
    redo: redoWithIds('categories.create', (args, result) =>
      typeof result === 'number' ? { ...args, id: result } : null
    ),
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

  // useUpdateCategoryNote
  'categories.updateNote': {
    execute: async (args) =>
      S().categories!.updateCategoryNote(args.id as number, args.note as string),
    invalidates: [['categories', '*']],
    undo: {
      // Not makeRestoreUndo: an empty previous note is a valid value to restore.
      capture: async (args) =>
        safeCapture(() => ({ note: S().categories!.getCategory(args.id as number)?.Note ?? '' })),
      build: (args, _result, before) => {
        const snapshot = before as { note: string } | null | undefined;
        if (!snapshot) return [];
        return [{ op: 'categories.updateNote', args: { id: args.id, note: snapshot.note } }];
      },
    },
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
            CategoryRow | undefined;
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
            fundingPriority: category?.FundingPriority ?? 3,
            groupId: category?.CategoryGroupID,
            budgetId: category?.BudgetID,
          };
        }),
      build: (args, _result, before) => {
        const snapshot = before as
          | {
              name?: string;
              note?: string;
              groupId?: number;
              budgetId?: number;
              fundingPriority?: number;
            }
          | null
          | undefined;
        if (!snapshot?.name || !snapshot?.groupId || !snapshot?.budgetId) return [];
        return [
          {
            op: 'categories.create',
            args: {
              id: args.id,
              parentId: snapshot.groupId,
              budgetId: snapshot.budgetId,
              name: snapshot.name,
              note: snapshot.note ?? '',
              fundingPriority: snapshot.fundingPriority ?? 3,
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
    undo: {
      capture: async (args) =>
        safeCapture(() =>
          S()
            .categories.getAllCategoryGroups(args.budgetId as number)
            .map((group) => group.ID)
        ),
      build: (args, _result, before) => {
        const orderedGroupIds = before as number[] | null;
        return orderedGroupIds?.length
          ? [{ op: 'categoryGroups.reorder', args: { budgetId: args.budgetId, orderedGroupIds } }]
          : [];
      },
    },
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
    undo: {
      capture: async (args) =>
        safeCapture(() => {
          const groupId = args.categoryGroupId as number;
          const { BudgetID } = S().categories.getCategoryGroup(groupId);
          return S()
            .categories.getCategoriesByGroup(BudgetID, groupId)
            .map((category) => category.ID);
        }),
      build: (args, _result, before) => {
        const orderedCategoryIds = before as number[] | null;
        return orderedCategoryIds?.length
          ? [
              {
                op: 'categories.reorder',
                args: { categoryGroupId: args.categoryGroupId, orderedCategoryIds },
              },
            ]
          : [];
      },
    },
  },
} satisfies Record<string, OpCodeEntry>;
