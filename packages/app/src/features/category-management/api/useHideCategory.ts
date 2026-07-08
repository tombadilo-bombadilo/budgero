/**
 * Hook to hide categories by moving them to a special "Hidden Categories" group.
 */
import { useCallback } from 'react';
import {
  useCategoryGroups,
  useAddCategoryGroup,
  useMoveCategoryToNewGroup,
} from '@entities/category/api/useCategories';

export const HIDDEN_CATEGORIES_GROUP_NAME = 'Hidden Categories';

export function useHideCategory(budgetId: number) {
  const { data: categoryGroups } = useCategoryGroups(budgetId);
  const addGroupMutation = useAddCategoryGroup();
  const moveCategoryMutation = useMoveCategoryToNewGroup();

  const hideCategory = useCallback(
    async (categoryId: number) => {
      let hiddenGroup = categoryGroups?.find((g) => g.Name === HIDDEN_CATEGORIES_GROUP_NAME);

      if (!hiddenGroup) {
        const newGroupId = await addGroupMutation.mutateAsync({
          name: HIDDEN_CATEGORIES_GROUP_NAME,
          budgetId,
        });
        hiddenGroup = {
          ID: newGroupId,
          Name: HIDDEN_CATEGORIES_GROUP_NAME,
          BudgetID: budgetId,
          Note: '',
          Position: 0,
        };
      }

      await moveCategoryMutation.mutateAsync({
        categoryId,
        newGroupId: hiddenGroup.ID,
        budgetId,
      });
    },
    [categoryGroups, addGroupMutation, moveCategoryMutation, budgetId]
  );

  const hasHiddenCategories =
    categoryGroups?.some((g) => g.Name === HIDDEN_CATEGORIES_GROUP_NAME) ?? false;

  return { hideCategory, hasHiddenCategories };
}
