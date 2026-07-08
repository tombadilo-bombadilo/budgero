import { useQuery, useMutation } from '@tanstack/react-query';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type { CategoryGroup, Category } from '@budgero/core/browser';

/**
 * Fetch all category groups for a given budget.
 */
export function useCategoryGroups(budgetId: number) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<CategoryGroup[]>({
    queryKey: ['categoryGroups', spaceKey, budgetId],
    queryFn: async () => {
      if (!spaceId || !budgetId) {
        return [];
      }
      const services = runtime.services();
      const data = services.categories.getAllCategoryGroups(budgetId);
      return data;
    },
    enabled: Boolean(spaceId) && budgetId > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });
}

/**
 * Fetch all categories for a given budget.
 */
export function useCategories(budgetId: number) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<Category[]>({
    queryKey: ['categories', spaceKey, budgetId],
    queryFn: async () => {
      if (!spaceId || !budgetId) {
        return [];
      }
      const services = runtime.services();
      const data = services.categories.getAllCategories(budgetId);
      return data;
    },
    enabled: Boolean(spaceId) && budgetId > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });
}

/**
 * Add a new category group.
 */
export type AddCategoryGroupInput = {
  name: string;
  budgetId: number;
};

export function useAddCategoryGroup() {
  const runtime = useRuntime();
  return useMutation<
    number, // ← mutationFn returns the new ID
    Error,
    AddCategoryGroupInput
  >({
    mutationFn: async (input) => {
      return executeSpaceMutation<number>(runtime, {
        op: 'categoryGroups.create',
        payload: {
          name: input.name,
          budgetId: input.budgetId,
        },
        meta: { label: 'useAddCategoryGroup' },
      });
    },
  });
}

/**
 * Update an existing category group.
 */
export type UpdateCategoryGroupInput = {
  id: number;
  name: string;
  budgetId: number;
};
export function useUpdateCategoryGroup() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateCategoryGroupInput>({
    mutationFn: async ({ id, name, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categoryGroups.update',
        payload: { id, name, budgetId },
        meta: { label: 'useUpdateCategoryGroup' },
      });
    },
  });
}

/**
 * Delete a category group.
 */
export type DeleteCategoryGroupInput = {
  id: number;
  budgetId: number;
};
export function useDeleteCategoryGroup() {
  const runtime = useRuntime();
  return useMutation<void, Error, DeleteCategoryGroupInput>({
    mutationFn: async ({ id, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categoryGroups.delete',
        payload: { id, budgetId },
        meta: { label: 'useDeleteCategoryGroup' },
      });
    },
  });
}

/**
 * Add a new category to a group.
 */
export type AddCategoryInput = {
  name: string;
  groupId: number;
  budgetId: number;
  note: string;
};
export function useAddCategory() {
  const runtime = useRuntime();
  return useMutation<number, Error, AddCategoryInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<number>(runtime, {
        op: 'categories.create',
        payload: {
          name: input.name,
          parentId: input.groupId,
          budgetId: input.budgetId,
          note: input.note,
        },
        meta: { label: 'useAddCategory' },
      });
    },
  });
}

/**
 * Update an existing category's name.
 */
export type UpdateCategoryNameInput = {
  id: number;
  name: string;
  budgetId: number;
};
export function useUpdateCategoryName() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateCategoryNameInput>({
    mutationFn: async ({ id, name, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categories.updateName',
        payload: { id, name, budgetId },
        meta: { label: 'useUpdateCategoryName' },
      });
    },
  });
}

/**
 * Update an existing category's exclude_from_budget_pace flag.
 */
export type UpdateCategoryExcludeFromBudgetPaceInput = {
  id: number;
  excludeFromBudgetPace: boolean;
  budgetId: number;
};
export function useUpdateCategoryExcludeFromBudgetPace() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateCategoryExcludeFromBudgetPaceInput>({
    mutationFn: async ({ id, excludeFromBudgetPace, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categories.updateExcludeFromBudgetPace',
        payload: { id, excludeFromBudgetPace, budgetId },
        meta: { label: 'useUpdateCategoryExcludeFromBudgetPace' },
      });
    },
  });
}

/**
 * Delete a category.
 */
export type DeleteCategoryInput = {
  id: number;
  budgetId: number;
};
export function useDeleteCategory() {
  const runtime = useRuntime();
  return useMutation<void, Error, DeleteCategoryInput>({
    mutationFn: async ({ id, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categories.delete',
        payload: { id, budgetId },
        meta: { label: 'useDeleteCategory' },
      });
    },
  });
}

/**
 * Move a category to a new group.
 */
export type MoveCategoryToNewGroupInput = {
  categoryId: number;
  newGroupId: number;
  budgetId: number;
};
export function useMoveCategoryToNewGroup() {
  const runtime = useRuntime();
  return useMutation<void, Error, MoveCategoryToNewGroupInput>({
    mutationFn: async ({ categoryId, newGroupId, budgetId }) => {
      const mutationManager = runtime.mutationsRouter();
      await mutationManager.execute<void>({
        op: 'categories.moveToNewGroup',
        payload: {
          categoryId,
          newGroupId,
          budgetId,
        },
        meta: { label: 'useMoveCategoryToNewGroup' },
      });
    },
  });
}

/**
 * Reorder category groups within a budget.
 */
export type ReorderCategoryGroupsInput = {
  budgetId: number;
  orderedGroupIds: number[];
};

export function useReorderCategoryGroups() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReorderCategoryGroupsInput>({
    mutationFn: async ({ budgetId, orderedGroupIds }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categoryGroups.reorder',
        payload: { budgetId, orderedGroupIds },
        meta: { label: 'useReorderCategoryGroups' },
      });
    },
  });
}

/**
 * Reorder categories within a group.
 */
export type ReorderCategoriesInput = {
  categoryGroupId: number;
  orderedCategoryIds: number[];
  budgetId: number;
};

export function useReorderCategories() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReorderCategoriesInput>({
    mutationFn: async ({ categoryGroupId, orderedCategoryIds }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'categories.reorder',
        payload: { categoryGroupId, orderedCategoryIds },
        meta: { label: 'useReorderCategories' },
      });
    },
  });
}
