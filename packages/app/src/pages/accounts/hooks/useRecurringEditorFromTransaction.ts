import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { toast } from 'sonner';
import type {
  GetTransactionsByAccountRow,
  Transaction,
  TransactionSplit,
} from '@budgero/core/browser';
import type {
  RecurringTransactionEditorProps,
  RecurringTransactionEditorSubmit,
} from '@features/recurring/ui/RecurringTransactionEditor';
import { useCreateRecurringTransaction } from '@entities/recurring/api/useRecurringTransactions';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { getTodayISO } from '@shared/lib/date-utils';
import { asMilli } from '@shared/lib/currency/milli';
import { getErrorMessage } from '@shared/lib/errors';

type RecurringEditorInitialValues = RecurringTransactionEditorProps['initialValues'];

function nativeOutflow(transaction: GetTransactionsByAccountRow | Transaction): number {
  return transaction.OutflowNative ?? transaction.OutflowConverted;
}

function nativeInflow(transaction: GetTransactionsByAccountRow | Transaction): number {
  return transaction.InflowNative ?? transaction.InflowConverted;
}

function scheduleFrom(date: string) {
  return {
    startDate: date || getTodayISO(),
    intervalUnit: 'month' as const,
    intervalCount: 1,
  };
}

export function recurringInitialValuesFromTransaction(
  transaction: GetTransactionsByAccountRow,
  fallbackAccountId?: number,
  transferLegs?: Transaction[],
  splitLines?: TransactionSplit[]
): RecurringEditorInitialValues | null {
  if (transaction.TransferID) {
    // A standard transfer must have exactly one source and one destination.
    // A split line's mirror row has a different shape: copy its split parent
    // instead.
    if (transferLegs?.length !== 2) return null;

    const source = transferLegs.find((leg) => nativeOutflow(leg) > 0);
    const destination = transferLegs.find((leg) => leg.ID !== source?.ID && nativeInflow(leg) > 0);
    if (!source || !destination || source.AccountID === destination.AccountID) return null;

    return {
      name: source.Payee || source.Memo || t`Recurring transfer`,
      memo: source.Memo || '',
      amount: asMilli(Math.abs(nativeOutflow(source))),
      direction: 'outflow',
      accountId: source.AccountID,
      toAccountId: destination.AccountID,
      categoryId: source.CategoryID ?? null,
      schedule: scheduleFrom(source.Date),
      notifyDaysBefore: 0,
      active: true,
    };
  }

  const outflow = nativeOutflow(transaction);
  const inflow = nativeInflow(transaction);
  const direction = outflow > 0 ? 'outflow' : 'inflow';
  // Lines in account currency, like the template amount.
  const splits = splitLines?.length
    ? splitLines.map((line) => ({
        categoryId: line.TransferAccountID ? null : (line.CategoryID ?? null),
        transferAccountId: line.TransferAccountID ?? null,
        memo: line.Memo ?? '',
        payee: line.Payee ?? '',
        inflow: asMilli(line.InflowNative ?? line.InflowConverted),
        outflow: asMilli(line.OutflowNative ?? line.OutflowConverted),
      }))
    : null;

  return {
    name: transaction.Payee || transaction.Memo || t`Recurring transaction`,
    memo: transaction.Memo || '',
    amount: asMilli(Math.abs(direction === 'outflow' ? outflow : inflow)),
    direction,
    accountId: fallbackAccountId ?? transaction.AccountID ?? null,
    categoryId: splits ? null : (transaction.CategoryID ?? null),
    splits,
    schedule: scheduleFrom(transaction.Date),
    notifyDaysBefore: 0,
    active: true,
  };
}

/**
 * Shared "create recurring transaction from an existing transaction" editor
 * state for AccountPage and AllTransactionsPage: prefills the editor from a
 * selected register row and persists the template on submit.
 *
 * `accountId` pins the prefilled account (AccountPage); when omitted the
 * row's own AccountID is used (AllTransactionsPage).
 */
export function useRecurringEditorFromTransaction({
  budgetId,
  accountId,
}: {
  budgetId: number;
  accountId?: number;
}) {
  const { t } = useLingui();

  const runtime = useRuntime();
  const createRecurring = useCreateRecurringTransaction();
  const [open, setOpen] = useState(false);
  const [initialValues, setInitialValues] =
    useState<RecurringTransactionEditorProps['initialValues']>();

  const openFromTransaction = async (transaction: GetTransactionsByAccountRow) => {
    try {
      const transferLegs = transaction.TransferID
        ? await runtime.services().transactions.getTransactionsByTransferID(transaction.TransferID)
        : undefined;
      const splitLines = transaction.TransferID
        ? undefined
        : runtime.services().splits.getSplits(transaction.ID);
      const values = recurringInitialValuesFromTransaction(
        transaction,
        accountId,
        transferLegs,
        splitLines
      );

      if (!values) {
        toast.error(t`Unable to create recurring transfer`, {
          description: t`The selected transfer does not have one source and one destination. To repeat a split with a transfer line, make its split transaction recurring instead.`,
        });
        return;
      }

      setInitialValues(values);
      setOpen(true);
    } catch (error) {
      toast.error(t`Unable to load transfer`, {
        description: getErrorMessage(
          error,
          t`The paired transfer transaction could not be loaded.`
        ),
      });
    }
  };

  const handleSubmit = async (values: RecurringTransactionEditorSubmit) => {
    if (!budgetId) return;
    if (!values.accountId) {
      toast.error(t`Select an account`);
      return;
    }
    if (values.toAccountId != null) {
      if (values.toAccountId === values.accountId) {
        toast.error(t`Pick two different accounts for a transfer`);
        return;
      }
    } else if (!values.categoryId && !values.splits?.length) {
      toast.error(t`Select a category`);
      return;
    }
    if (!values.amount || Number.isNaN(values.amount)) {
      toast.error(t`Enter a valid amount`);
      return;
    }

    try {
      await createRecurring.mutateAsync({
        budgetId,
        accountId: values.accountId,
        toAccountId: values.toAccountId,
        categoryId: values.categoryId,
        splits: values.splits,
        name: values.name,
        memo: values.memo,
        amount: values.amount,
        direction: values.direction,
        schedule: values.schedule,
        notifyDaysBefore: values.notifyDaysBefore,
        active: values.active,
      });
      toast.success(t`Recurring transaction created`, {
        description: t`We will remind you when it is almost due.`,
      });
      setOpen(false);
    } catch (error) {
      const message = getErrorMessage(error, t`Something went wrong.`);
      toast.error(t`Unable to save recurring transaction`, {
        description: message,
      });
    }
  };

  return {
    open,
    setOpen,
    initialValues,
    openFromTransaction,
    handleSubmit,
    isSubmitting: createRecurring.isPending,
  };
}
