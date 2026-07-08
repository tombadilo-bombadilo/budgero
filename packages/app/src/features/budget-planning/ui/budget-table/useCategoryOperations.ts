/**
 * Category Operations Hook
 *
 * Handles CRUD operations for categories and category groups.
 */

import { useCallback, useMemo, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCategories,
  useDeleteCategoryGroup,
  useUpdateCategoryGroup,
  useUpdateCategoryName,
  useUpdateCategoryExcludeFromBudgetPace,
  useDeleteCategory,
  useAddCategory,
  useAddCategoryGroup,
  useMoveCategoryToNewGroup,
  useReorderCategoryGroups,
  useReorderCategories,
} from '@entities/category/api/useCategories';
import {
  useUpsertAssignment,
  useBatchUpsertAssignments,
  useReassignAssignments,
  useFutureOverspendingCheck,
} from '@entities/budget/api/useMonthlyBudget';
import { useReassignTransactions } from '@entities/transaction/api/useTransactions';
import { toast } from 'sonner';
import { useUiStore } from '@shared/store/useUiStore';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { exceedsAmount } from '@shared/lib/currency/round-amount';
import { useAllowOverAssignment } from '@shared/hooks/useUserPreferences';
import { toastError } from '@shared/lib/errors';
import type { BudgetRow } from '../../lib/budget-transforms';
import type { FutureOverspendingMonth } from '../FutureOverspendingWarning';

interface UseCategoryOperationsProps {
  budgetId: number;
  selectedBudgetId: number;
  effectiveMonth: string;
  spaceKey: string;
  globalLocalizer: Intl.NumberFormat;
  transformedRows: BudgetRow[];
  rowsByCategoryId: Map<number, BudgetRow>;
}

export function useCategoryOperations({
  budgetId,
  selectedBudgetId,
  effectiveMonth,
  spaceKey,
  globalLocalizer,
  transformedRows,
  rowsByCategoryId,
}: UseCategoryOperationsProps) {
  const queryClient = useQueryClient();
  const setHighlightAssignmentCategoryId = useUiStore(
    (state) => state.setHighlightAssignmentCategoryId
  );
  // Toast descriptions include amounts; mask them while privacy mode is on.
  const maskedLocalizer = useMaskedLocalizer(globalLocalizer);

  const { data: categories } = useCategories(selectedBudgetId || 0);
  const deleteCategoryGroupMutation = useDeleteCategoryGroup();
  const updateCategoryGroupMutation = useUpdateCategoryGroup();
  const upsertAssignmentMutation = useUpsertAssignment();
  const updateCategoryNameMutation = useUpdateCategoryName();
  const updateCategoryExcludeFromBudgetPaceMutation = useUpdateCategoryExcludeFromBudgetPace();
  const deleteCategoryMutation = useDeleteCategory();
  const createCategoryGroupMutation = useAddCategoryGroup();
  const createCategoryMutation = useAddCategory();
  const moveCategoryToNewGroupMutation = useMoveCategoryToNewGroup();
  const reassignTransactionsMutation = useReassignTransactions();
  const reassignAssignmentsMutation = useReassignAssignments();
  const batchUpsertAssignments = useBatchUpsertAssignments();
  const reorderCategoryGroupsMutation = useReorderCategoryGroups();
  const reorderCategoriesMutation = useReorderCategories();
  const { checkOverspending } = useFutureOverspendingCheck();
  const { data: allowOverAssignment = false } = useAllowOverAssignment();

  const [overspendingWarning, setOverspendingWarning] = useState<{
    open: boolean;
    affectedMonths: FutureOverspendingMonth[];
  }>({ open: false, affectedMonths: [] });
  const pendingActionRef = useRef<(() => Promise<void>) | null>(null);

  const handleOverspendingConfirm = useCallback(async () => {
    if (pendingActionRef.current) {
      await pendingActionRef.current();
      pendingActionRef.current = null;
    }
    setOverspendingWarning({ open: false, affectedMonths: [] });
  }, []);

  const handleOverspendingCancel = useCallback(() => {
    pendingActionRef.current = null;
    setOverspendingWarning({ open: false, affectedMonths: [] });
  }, []);

  const assignedByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    transformedRows.forEach((row) => {
      if (!row.isGroup && row.categoryId > 0) {
        map.set(row.categoryId, row.assigned || 0);
      }
    });
    return map;
  }, [transformedRows]);

  const availableByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    transformedRows.forEach((row) => {
      if (!row.isGroup && row.categoryId > 0) {
        map.set(row.categoryId, row.available || 0);
      }
    });
    return map;
  }, [transformedRows]);

  const handleDeleteCategoryGroup = useCallback(
    async (item: BudgetRow) => {
      const associatedCategories =
        categories?.filter((category) => category.CategoryGroupID === item.categoryGroupId) || [];

      if (associatedCategories.length > 0) {
        toast.error('Cannot delete non-empty category group', {
          description: `This group contains ${associatedCategories.length} ${associatedCategories.length === 1 ? 'category' : 'categories'}. Please move or delete them first.`,
        });
        return;
      }

      if (item.categoryGroupId === undefined || item.categoryGroupId === null) {
        toast.error('Cannot delete category group', {
          description: 'Invalid category group.',
        });
        return;
      }

      try {
        await deleteCategoryGroupMutation.mutateAsync({
          id: item.categoryGroupId,
          budgetId: selectedBudgetId || 0,
        });
      } catch (error) {
        console.error('Error deleting category group:', error);
        toastError('Failed to delete category group', error, 'Please try again.');
      }
    },
    [categories, deleteCategoryGroupMutation, selectedBudgetId]
  );

  const handleUpdateCategoryGroup = useCallback(
    async (id: number, name: string) => {
      if (!name.trim()) {
        toast.error('Name cannot be empty');
        return;
      }

      try {
        await updateCategoryGroupMutation.mutateAsync({
          id,
          name,
          budgetId: selectedBudgetId || 0,
        });
      } catch {
        toast.error('Failed to update category group', {
          description: 'Please try again.',
        });
      }
    },
    [selectedBudgetId, updateCategoryGroupMutation]
  );

  const handleCreateCategoryGroup = useCallback(
    (name: string, onSuccess: () => void) => {
      createCategoryGroupMutation.mutate(
        { name, budgetId },
        {
          onSuccess,
          onError: () => {
            toast.error('Failed to create category group', {
              description: 'Please try again.',
            });
          },
        }
      );
    },
    [budgetId, createCategoryGroupMutation]
  );

  const handleSaveCategoryEdit = useCallback(
    async (
      editingCategory: { id: number; name: string; excludeFromBudgetPace: boolean },
      name: string,
      excludeFromBudgetPace: boolean,
      onSuccess: () => void
    ) => {
      try {
        const categoryData = categories?.find((c) => c.ID === editingCategory.id);

        if (categoryData?.Name !== name) {
          await updateCategoryNameMutation.mutateAsync({
            id: editingCategory.id,
            name,
            budgetId: selectedBudgetId || 0,
          });
        }

        if (categoryData?.ExcludeFromBudgetPace !== excludeFromBudgetPace) {
          await updateCategoryExcludeFromBudgetPaceMutation.mutateAsync({
            id: editingCategory.id,
            excludeFromBudgetPace,
            budgetId: selectedBudgetId || 0,
          });
        }

        onSuccess();
      } catch {
        toast.error('Failed to update category', {
          description: 'Please try again.',
        });
      }
    },
    [
      categories,
      selectedBudgetId,
      updateCategoryExcludeFromBudgetPaceMutation,
      updateCategoryNameMutation,
    ]
  );

  const handleConfirmDelete = useCallback(
    async (pendingDelete: BudgetRow, onSuccess: () => void) => {
      try {
        await deleteCategoryMutation.mutateAsync({
          id: pendingDelete.categoryId,
          budgetId: selectedBudgetId || 0,
        });
        onSuccess();
      } catch (error) {
        toastError('Failed to delete category', error, 'Please try again.');
      }
    },
    [deleteCategoryMutation, selectedBudgetId]
  );

  const handleConfirmCategoryDelete = useCallback(
    async (deletingCategory: BudgetRow, targetCategoryId: number, onSuccess: () => void) => {
      const budgetIdForOps = selectedBudgetId || budgetId || 0;
      if (!budgetIdForOps) {
        toast.error('No budget selected', {
          description: 'Please select a budget before deleting categories.',
        });
        throw new Error('Budget is required to delete a category');
      }
      if (targetCategoryId === deletingCategory.categoryId) {
        toast.error('Choose another category', {
          description: 'Select a different category to receive the data.',
        });
        throw new Error('Target category must be different from the source');
      }

      try {
        await reassignTransactionsMutation.mutateAsync({
          newCategoryId: targetCategoryId,
          oldCategoryId: deletingCategory.categoryId,
          budgetId: budgetIdForOps,
        });

        await reassignAssignmentsMutation.mutateAsync({
          newCategoryId: targetCategoryId,
          oldCategoryId: deletingCategory.categoryId,
          budgetId: budgetIdForOps,
        });

        await deleteCategoryMutation.mutateAsync({
          id: deletingCategory.categoryId,
          budgetId: budgetIdForOps,
        });

        onSuccess();
        toast.success('Category deleted', {
          description: 'All transactions and assignments were moved to the selected category.',
        });
      } catch (error) {
        toastError('Failed to delete category', error, 'Please try again.');
        throw error;
      }
    },
    [
      budgetId,
      deleteCategoryMutation,
      reassignAssignmentsMutation,
      reassignTransactionsMutation,
      selectedBudgetId,
    ]
  );

  const handleCreateCategory = useCallback(
    (name: string, selectedGroupId: number, onSuccess: () => void) => {
      createCategoryMutation.mutate(
        {
          name,
          note: '',
          groupId: selectedGroupId,
          budgetId,
        },
        {
          onSuccess: () => {
            onSuccess();
          },
          onError: () => {
            toast.error('Failed to create category', {
              description: 'Please try again.',
            });
          },
        }
      );
    },
    [budgetId, createCategoryMutation]
  );

  const executeUpsertAssignment = useCallback(
    async (categoryId: number, value: number) => {
      await upsertAssignmentMutation.mutateAsync({
        categoryId,
        amount: value,
        month: effectiveMonth,
        budgetId: selectedBudgetId || 0,
      });
      setHighlightAssignmentCategoryId(null);
    },
    [effectiveMonth, selectedBudgetId, setHighlightAssignmentCategoryId, upsertAssignmentMutation]
  );

  const handleUpsertAssignment = useCallback(
    async (categoryId: number, value: number) => {
      try {
        const readyToAssignData = queryClient.getQueryData<number>([
          'readyToAssign',
          spaceKey,
          selectedBudgetId || 0,
        ]);
        const readyToAssign = readyToAssignData || 0;

        const currentAssignment =
          transformedRows.find((row) => row.categoryId === categoryId)?.assigned || 0;
        const assignmentDifference = value - currentAssignment;

        // exceedsAmount rounds both sides to integer milliunits, so float
        // residuals never trip the popup with an overage of 0.00.
        const isOverAssigning =
          assignmentDifference > 0 && exceedsAmount(assignmentDifference, readyToAssign);

        if (isOverAssigning && !allowOverAssignment) {
          const overAmount = asMilli(assignmentDifference - readyToAssign);
          toast.error('Assignment exceeds ready-to-assign amount', {
            description: `This assignment would exceed your ready-to-assign amount by ${formatMilli(maskedLocalizer, overAmount)}.`,
          });
          return;
        }

        if (isOverAssigning && allowOverAssignment) {
          const overAmount = asMilli(assignmentDifference - readyToAssign);
          toast.success('Creating negative Ready to Assign', {
            description: `This will reduce your Ready to Assign by ${formatMilli(maskedLocalizer, overAmount)}.`,
          });
        }

        if (assignmentDifference < 0) {
          const reductionAmount = -assignmentDifference;
          const affected = checkOverspending(
            categoryId,
            reductionAmount,
            effectiveMonth,
            selectedBudgetId || 0
          );
          if (affected.length > 0) {
            pendingActionRef.current = () => executeUpsertAssignment(categoryId, value);
            setOverspendingWarning({ open: true, affectedMonths: affected });
            return;
          }
        }

        await executeUpsertAssignment(categoryId, value);
      } catch {
        toast.error('Failed to update allocation', {
          description: 'Please try again.',
        });
      }
    },
    [
      allowOverAssignment,
      checkOverspending,
      effectiveMonth,
      executeUpsertAssignment,
      maskedLocalizer,
      queryClient,
      selectedBudgetId,
      spaceKey,
      transformedRows,
    ]
  );

  const executeMoveMoney = useCallback(
    async (sourceCategoryId: number, moveAmount: number, target: number | 'rta') => {
      const month = effectiveMonth;
      const budgetIdForOps = selectedBudgetId || 0;

      const sourceAssigned = assignedByCategoryId.get(sourceCategoryId) || 0;
      const assignments: {
        categoryId: number;
        amount: number;
        month: string;
        budgetId: number;
      }[] = [];
      assignments.push({
        categoryId: sourceCategoryId,
        amount: sourceAssigned - moveAmount,
        month,
        budgetId: budgetIdForOps,
      });

      if (target !== 'rta') {
        const targetAssigned = assignedByCategoryId.get(target) || 0;
        assignments.push({
          categoryId: target,
          amount: targetAssigned + moveAmount,
          month,
          budgetId: budgetIdForOps,
        });
      }

      await batchUpsertAssignments.mutateAsync(assignments);
      toast.success('Money moved', {
        description: `Moved ${formatMilli(maskedLocalizer, asMilli(moveAmount))} ${
          target === 'rta' ? 'to Ready to Assign' : 'to selected category'
        }.`,
      });
    },
    [
      assignedByCategoryId,
      batchUpsertAssignments,
      effectiveMonth,
      maskedLocalizer,
      selectedBudgetId,
    ]
  );

  const handleMoveMoney = useCallback(
    async (sourceCategoryId: number, amount: number, target: number | 'rta') => {
      const month = effectiveMonth;
      const budgetIdForOps = selectedBudgetId || 0;
      if (!budgetIdForOps || !month) return;

      const uiAvailable = rowsByCategoryId.get(sourceCategoryId)?.available ?? null;
      const mapAvailable = availableByCategoryId.get(sourceCategoryId) ?? null;
      const sourceAvailable = (uiAvailable ?? mapAvailable ?? 0) as number;
      if (amount <= 0 || sourceAvailable <= 0) {
        toast.error('Invalid amount', {
          description: 'Enter a positive amount within available funds.',
        });
        return;
      }
      const moveAmount = Math.min(amount, Math.max(0, sourceAvailable));

      const affected = checkOverspending(sourceCategoryId, moveAmount, month, budgetIdForOps);
      if (affected.length > 0) {
        pendingActionRef.current = () => executeMoveMoney(sourceCategoryId, moveAmount, target);
        setOverspendingWarning({ open: true, affectedMonths: affected });
        return;
      }

      try {
        await executeMoveMoney(sourceCategoryId, moveAmount, target);
      } catch {
        toast.error('Move failed', { description: 'Please try again.' });
      }
    },
    [
      availableByCategoryId,
      checkOverspending,
      effectiveMonth,
      executeMoveMoney,
      rowsByCategoryId,
      selectedBudgetId,
    ]
  );

  const handleReorderItems = useCallback(
    async (
      reorderedItems: BudgetRow[],
      movedCategoryInfo?: {
        categoryId: number;
        oldGroupId: number;
        newGroupId: number;
      }
    ) => {
      const budgetIdForOps = selectedBudgetId || 0;
      if (!budgetIdForOps) return;

      try {
        // If category moved to new group, handle that first
        if (movedCategoryInfo) {
          await moveCategoryToNewGroupMutation.mutateAsync({
            categoryId: movedCategoryInfo.categoryId,
            newGroupId: movedCategoryInfo.newGroupId,
            budgetId: budgetIdForOps,
          });
        }

        const groupOrder = reorderedItems
          .filter(
            (item): item is typeof item & { categoryGroupId: number } =>
              item.isGroup && typeof item.categoryGroupId === 'number'
          )
          .map((item) => item.categoryGroupId);

        const categoryOrderByGroup: Record<number, number[]> = {};
        for (const item of reorderedItems) {
          if (item.isGroup && item.categoryGroupId) {
            categoryOrderByGroup[item.categoryGroupId] = [];
          }
        }
        for (const item of reorderedItems) {
          if (!item.isGroup && item.categoryId) {
            const parentGroup = reorderedItems.find((r) => r.id === item.parentId);
            if (parentGroup?.categoryGroupId) {
              categoryOrderByGroup[parentGroup.categoryGroupId].push(item.categoryId);
            }
          }
        }

        if (groupOrder.length > 0) {
          await reorderCategoryGroupsMutation.mutateAsync({
            budgetId: budgetIdForOps,
            orderedGroupIds: groupOrder,
          });
        }

        for (const [groupIdStr, categoryIds] of Object.entries(categoryOrderByGroup)) {
          if (categoryIds.length > 0) {
            await reorderCategoriesMutation.mutateAsync({
              categoryGroupId: Number(groupIdStr),
              orderedCategoryIds: categoryIds,
              budgetId: budgetIdForOps,
            });
          }
        }
      } catch {
        toast.error('Failed to save order', {
          description: 'Please try again.',
        });
      }
    },
    [
      moveCategoryToNewGroupMutation,
      reorderCategoryGroupsMutation,
      reorderCategoriesMutation,
      selectedBudgetId,
    ]
  );

  return {
    categories,
    handleDeleteCategoryGroup,
    handleUpdateCategoryGroup,
    handleCreateCategoryGroup,
    handleSaveCategoryEdit,
    handleConfirmDelete,
    handleConfirmCategoryDelete,
    handleCreateCategory,
    handleUpsertAssignment,
    handleMoveMoney,
    handleReorderItems,
    overspendingWarning,
    handleOverspendingConfirm,
    handleOverspendingCancel,
    isUpdatingGroup: updateCategoryGroupMutation.isPending,
    isDeletingGroup: deleteCategoryGroupMutation.isPending,
    isCreatingGroup: createCategoryGroupMutation.isPending,
    isCreatingCategory: createCategoryMutation.isPending,
    isDeletingCategory: deleteCategoryMutation.isPending,
    isSavingCategoryEdit:
      updateCategoryNameMutation.isPending || updateCategoryExcludeFromBudgetPaceMutation.isPending,
    isDeletingCategoryWithData:
      deleteCategoryMutation.isPending ||
      reassignTransactionsMutation.isPending ||
      reassignAssignmentsMutation.isPending,
  };
}
