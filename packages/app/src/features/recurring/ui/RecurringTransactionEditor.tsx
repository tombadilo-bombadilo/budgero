import type { Account, Category } from '@budgero/core/browser';
import { Dialog, DialogContent } from '@shared/ui/dialog';
import {
  AddTransactionForm,
  type AddTransactionFormProps,
} from '@features/transactions/ui/add-transaction/AddTransactionForm';
import type {
  RecurringTransactionFormInitialValues,
  RecurringTransactionFormSubmit,
} from '@features/transactions/ui/add-transaction/recurring-form';

export type RecurringTransactionEditorSubmit = RecurringTransactionFormSubmit;

export interface RecurringTransactionEditorProps {
  open: boolean;
  mode: 'create' | 'edit';
  onOpenChange: (open: boolean) => void;
  budgetId?: number;
  accounts: Account[];
  categories: Category[];
  initialValues?: Omit<RecurringTransactionFormInitialValues, 'categoryName'>;
  onSubmit: (values: RecurringTransactionEditorSubmit) => Promise<void> | void;
  isSubmitting?: boolean;
}

const unsupportedTransactionSubmit: AddTransactionFormProps['onAddTransaction'] = async () => {
  throw new Error('A recurring template cannot be submitted as a transaction.');
};

const unsupportedTransferSubmit: AddTransactionFormProps['onAddTransfer'] = async () => {
  throw new Error('A recurring template cannot be submitted as a transfer.');
};

/**
 * Dialog adapter for recurring settings. Transaction fields are intentionally
 * owned by AddTransactionForm so create, edit, and "make recurring" all use
 * the same controls and validation surface.
 */
export function RecurringTransactionEditor({
  open,
  mode,
  onOpenChange,
  budgetId,
  accounts,
  categories,
  initialValues,
  onSubmit,
  isSubmitting = false,
}: RecurringTransactionEditorProps) {
  const resolvedBudgetId = budgetId ?? accounts[0]?.BudgetID ?? categories[0]?.BudgetID ?? 0;
  // The name is only shown; the ID travels with it so a same-named
  // category can't take its place on save.
  const categoryName =
    initialValues?.categoryId != null
      ? categories.find((category) => category.ID === initialValues.categoryId)?.Name
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        {open && (
          <AddTransactionForm
            budgetId={resolvedBudgetId}
            onAddTransaction={unsupportedTransactionSubmit}
            onAddTransfer={unsupportedTransferSubmit}
            onCancel={() => onOpenChange(false)}
            recurring={{
              initialEnabled: true,
              locked: true,
              mode,
              initialValues: {
                ...initialValues,
                categoryName,
              },
              onSubmit,
              isSubmitting,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
