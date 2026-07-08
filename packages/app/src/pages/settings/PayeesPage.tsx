import {
  useAddPayee,
  useDeletePayee,
  usePayeeDirectory,
  useRenamePayee,
} from '@entities/payee/api/payee-directory';
import { useUiStore } from '@shared/store/useUiStore';
import { DirectoryManagerPage } from '@features/settings/directory-manager';
import type { DirectoryManagerConfig } from '@features/settings/directory-manager';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';
import type { PayeeListItem } from '@budgero/core/browser';

interface PayeeDraft {
  name: string;
}

const payeeDirectoryConfig: DirectoryManagerConfig<PayeeListItem, string, PayeeDraft> = {
  header: (
    <SettingsPageHeader
      title="Manage Payees"
      description="Add new payees, rename existing ones, or clear them from your transactions."
    />
  ),
  pageTitle: 'Manage Payees',
  selectBudgetDescription: 'Select a budget to manage payees.',
  addCardTitle: 'Add Payee',
  addCardDescription: 'Keep your list tidy by creating common payees up front.',
  addButtonLabel: 'Add payee',
  namePlaceholder: 'e.g. Local Grocery',
  listDescription: 'Rename to merge duplicates or remove unused payees.',
  countLabel: (count) => `Payees (${count})`,
  loadingLabel: 'Loading payees...',
  emptyStateText: 'No payees yet. Add one to get started.',
  columns: [],
  getKey: (item) => item.Name,
  getName: (item) => item.Name,
  getUsageCount: (item) => item.UsageCount,
  emptyDraft: { name: '' },
  draftFromItem: (item) => ({ name: item.Name }),
  prepareDraft: (draft) => {
    const name = draft.name.trim();
    if (!name) {
      return { error: { title: 'Enter a payee name', description: 'Payee name cannot be empty.' } };
    }
    return { draft: { name } };
  },
  deleteDialogTitle: () => 'Remove this payee?',
  deleteDialogDescription: (item) => (
    <>
      This will clear &ldquo;{item.Name}&rdquo; from all transactions in this budget. You can add it
      back later if needed.
    </>
  ),
  toasts: {
    addSuccess: (draft) => ({
      title: 'Payee added',
      description: `"${draft.name}" is now available when adding transactions.`,
    }),
    addErrorTitle: 'Could not add payee',
    editSuccess: (item, draft) => ({
      title: 'Payee updated',
      description: `"${item.Name}" renamed to "${draft.name}".`,
    }),
    editErrorTitle: 'Could not update payee',
    deleteSuccess: (item) => ({
      title: 'Payee removed',
      description: `"${item.Name}" has been removed and cleared from existing transactions.`,
    }),
    deleteErrorTitle: 'Could not remove payee',
  },
};

export default function PayeesPage() {
  const { selectedBudget } = useUiStore();
  const budgetId = selectedBudget?.ID ?? null;

  const { data: payees = [], isLoading, isFetching } = usePayeeDirectory(budgetId);
  const addPayee = useAddPayee();
  const renamePayee = useRenamePayee();
  const deletePayee = useDeletePayee();

  return (
    <DirectoryManagerPage
      config={payeeDirectoryConfig}
      budgetId={budgetId}
      items={payees}
      isLoading={isLoading}
      isFetching={isFetching}
      onAdd={(draft) => addPayee.mutateAsync({ budgetId: budgetId!, name: draft.name })}
      isAdding={addPayee.isPending}
      onEdit={(key, draft) =>
        renamePayee.mutateAsync({ budgetId: budgetId!, oldName: key, newName: draft.name })
      }
      isSaving={renamePayee.isPending}
      onDelete={(item) => deletePayee.mutateAsync({ budgetId: budgetId!, name: item.Name })}
      isDeleting={deletePayee.isPending}
    />
  );
}
