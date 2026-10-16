import { useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
import { memo } from 'react';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { SpendingDrawerMobile } from '@features/budget-planning/ui/spending-drawer-mobile';
import { CategoryEditDialog } from '@features/category-management/ui/CategoryEditDialog';
import { AddCategoryGroupDialog } from '@features/category-management/ui/AddCategoryGroupDialog';
import { AddCategoryDialog } from '@features/category-management/ui/AddCategoryDialog';
import {
  FutureOverspendingWarning,
  type FutureOverspendingMonth,
} from '@features/budget-planning/ui/FutureOverspendingWarning';
import { DeleteCategoryDialog } from '@features/category-management/ui/DeleteCategoryDialog';
import type { BudgetRow } from '../../lib/budget-transforms';
import type { CategoryModalState, SpendingDrawerState } from './types';

interface BudgetModalsProps {
  // Spending drawer
  drawerState: SpendingDrawerState;
  onDrawerClose: () => void;
  currentMonth: string;

  // Category edit modal
  modalState: CategoryModalState;
  onEditModalClose: () => void;
  onSaveCategoryEdit: (
    name: string,
    excludeFromBudgetPace: boolean,
    priority: number
  ) => Promise<void>;
  isSavingEdit: boolean;

  // Delete modal
  onDeleteModalClose: () => void;
  onConfirmCategoryDelete: (targetCategoryId: number) => Promise<void>;
  isDeletingWithData: boolean;
  data: BudgetRow[];
  formatAmount: (val: number) => string;

  // Confirm delete dialog
  onConfirmDeleteClose: () => void;
  onConfirmDelete: () => Promise<void>;
  isDeletingCategory: boolean;

  // Add category group modal
  onAddGroupClose: () => void;
  onCreateCategoryGroup: (name: string) => void;
  isCreatingGroup: boolean;

  // Add category modal
  onAddCategoryClose: () => void;
  onCreateCategory: (name: string) => void;
  isCreatingCategory: boolean;

  // Future overspending warning
  overspendingWarning?: {
    open: boolean;
    affectedMonths: FutureOverspendingMonth[];
  };
  onOverspendingConfirm?: () => void | Promise<void>;
  onOverspendingCancel?: () => void;
}

const SpendingDrawerModal = memo(function SpendingDrawerModal({
  drawerState,
  onDrawerClose,
  currentMonth,
}: {
  drawerState: SpendingDrawerState;
  onDrawerClose: () => void;
  currentMonth: string;
}) {
  if (!drawerState.selectedCategory) return null;

  return (
    <SpendingDrawerMobile
      open={drawerState.drawerOpen}
      onClose={onDrawerClose}
      selectedCategory={drawerState.selectedCategory}
      currentMonth={currentMonth}
    />
  );
});

export function BudgetModals({
  drawerState,
  onDrawerClose,
  currentMonth,
  modalState,
  onEditModalClose,
  onSaveCategoryEdit,
  isSavingEdit,
  onDeleteModalClose,
  onConfirmCategoryDelete,
  isDeletingWithData,
  data,
  formatAmount,
  onConfirmDeleteClose,
  onConfirmDelete,
  isDeletingCategory,
  onAddGroupClose,
  onCreateCategoryGroup,
  isCreatingGroup,
  onAddCategoryClose,
  onCreateCategory,
  isCreatingCategory,
  overspendingWarning,
  onOverspendingConfirm,
  onOverspendingCancel,
}: BudgetModalsProps) {
  const { t } = useLingui();

  const formatMonth = (month: string) => {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };
  // What the delete also removes, across all months (A6): stated up front.
  const pendingName = modalState.pendingDelete?.name ?? '';
  const pendingImpact = modalState.pendingDelete?.deletionImpact;
  const removals: string[] = [];
  if (pendingImpact) {
    if (pendingImpact.assignedMonths > 0) {
      const total = formatAmount(pendingImpact.assignedTotal);
      removals.push(
        plural(pendingImpact.assignedMonths, {
          one: `Assigned money in # month (${total}) is removed and returns to Ready to Assign.`,
          other: `Assigned money in # months (${total}) is removed and returns to Ready to Assign.`,
        })
      );
    }
    if (pendingImpact.goals > 0) removals.push(t`Its goal is deleted.`);
    if (pendingImpact.scheduled > 0) {
      removals.push(
        plural(pendingImpact.scheduled, {
          one: `# scheduled transaction loses its category.`,
          other: `# scheduled transactions lose their category.`,
        })
      );
    }
  }
  const confirmDeleteDescription = (
    <>
      <span className="block">{t`Delete the category "${pendingName}"?`}</span>
      {removals.map((line) => (
        <span key={line} className="mt-1 block">
          {line}
        </span>
      ))}
      <span className="mt-1 block">{t`You can undo this.`}</span>
    </>
  );

  return (
    <>
      {/* Mobile Spending Drawer */}
      <SpendingDrawerModal
        drawerState={drawerState}
        onDrawerClose={onDrawerClose}
        currentMonth={currentMonth}
      />

      {/* Category Edit Modal */}
      {modalState.editingCategory && (
        <CategoryEditDialog
          open={modalState.editModalOpen}
          onClose={onEditModalClose}
          budgetId={modalState.editingCategory.budgetId}
          fundingPriority={modalState.editingCategory.fundingPriority}
          categoryName={modalState.editingCategory.name}
          excludeFromBudgetPace={modalState.editingCategory.excludeFromBudgetPace}
          onSave={onSaveCategoryEdit}
          isSaving={isSavingEdit}
        />
      )}

      {/* Category Delete Modal */}
      {modalState.deletingCategory && (
        <DeleteCategoryDialog
          open={modalState.deleteModalOpen}
          onClose={onDeleteModalClose}
          categories={data}
          currentCategoryId={modalState.deletingCategory.categoryId}
          currentCategoryTotalTransactions={modalState.deletingCategory.totalTransactions}
          currentCategoryAssigned={modalState.deletingCategory.assigned}
          impact={modalState.deletingCategory.deletionImpact}
          onDelete={onConfirmCategoryDelete}
          isLoading={isDeletingWithData}
          formatAmount={formatAmount}
        />
      )}

      {/* Add Category Group Modal */}
      <AddCategoryGroupDialog
        open={modalState.addCategoryGroupOpen}
        onClose={onAddGroupClose}
        onSave={onCreateCategoryGroup}
        isSaving={isCreatingGroup}
      />

      {/* Add Category Modal */}
      <AddCategoryDialog
        open={modalState.addCategoryOpen}
        onClose={onAddCategoryClose}
        onSave={onCreateCategory}
        isSaving={isCreatingCategory}
      />

      {/* Confirmation Dialog for Empty Category Deletion */}
      <ConfirmDialog
        open={modalState.confirmDeleteOpen}
        onOpenChange={(open) => !open && onConfirmDeleteClose()}
        title={t`Delete Category`}
        description={confirmDeleteDescription}
        confirmText={t`Delete`}
        cancelText={t`Cancel`}
        variant="destructive"
        onConfirm={onConfirmDelete}
        isLoading={isDeletingCategory}
      />

      {/* Future Overspending Warning */}
      {overspendingWarning && onOverspendingConfirm && onOverspendingCancel && (
        <FutureOverspendingWarning
          open={overspendingWarning.open}
          onOpenChange={(open) => {
            if (!open) onOverspendingCancel();
          }}
          affectedMonths={overspendingWarning.affectedMonths}
          onConfirm={onOverspendingConfirm}
          formatAmount={formatAmount}
          formatMonth={formatMonth}
        />
      )}
    </>
  );
}
