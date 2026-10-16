import * as React from 'react';
import { useLingui } from '@lingui/react/macro';
import { toast } from 'sonner';
import type { Account, GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useCategories } from '@entities/category/api/useCategories';
import { getExchangeRate } from '@entities/currency/lib/currency-utils';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import { runUndoGroup } from '@shared/mutations/UndoStore';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { generateTransferId } from '@features/transactions/ui/add-transaction/add-transaction.utils';
import {
  conversionReplacesCategory,
  isLinkedTransferRow,
} from '@features/transactions/lib/transfer-payee-options';
import {
  buildConvertToTransferArgs,
  buildRevertToTransactionArgs,
  computeCounterpartAmount,
  getConversionBlocker,
  getRevertBlocker,
  getTransactionFlow,
  type AddTransferArgs,
  type ConversionBlocker,
  type ConvertibleTransaction,
} from '@features/transactions/lib/transfer-conversion';

interface UseTransferConversionOptions {
  rows: GetTransactionsByAccountRow[];
  accounts: Account[];
}

/** A conversion that passed every check and is waiting only for the user's confirmation. */
interface PreparedConversion {
  transactionId: number;
  counterpartName: string;
  categoryName: string;
  args: AddTransferArgs;
}

/**
 * Converts a transaction into a transfer (picking "Transfer: Account" as its payee) and
 * back, composed from existing ops rather than dedicated ones:
 *
 * - convert: read the row into memory, `transactions.delete` it, then
 *   `transactions.addTransfer` from the copy (the converted row keeps its ID);
 * - revert: read the transfer into memory, `transactions.deleteTransfer`, then
 *   `transactions.add` a plain row from the copy.
 *
 * Both run inside one undo group, so a single undo reverts the whole conversion and a
 * failure part-way puts the original back. Rows with links that a delete would clear
 * (warranty, recurring occurrence, pending bank review) are refused.
 */
export function useTransferConversion({ rows, accounts }: UseTransferConversionOptions) {
  const { t } = useLingui();
  const runtime = useRuntime();
  const budgetId = useUiStore(
    (state) => state.selectedAccount?.BudgetID || state.selectedBudget?.ID || 0
  );
  const { data: categories = [] } = useCategories(budgetId);
  const [pending, setPending] = React.useState<PreparedConversion | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  const blockerMessage = React.useCallback(
    (blocker: ConversionBlocker): string => {
      switch (blocker) {
        case 'already-transfer':
          return t`This transaction is already a transfer.`;
        case 'not-a-transfer':
          return t`This isn't a simple two-sided transfer, so it can't be converted back.`;
        case 'reconciled':
          return t`Reconciled transactions can't be converted.`;
        case 'split':
          return t`Split transactions can't be converted to a transfer.`;
        case 'no-amount':
          return t`This transaction has no single amount to transfer.`;
        case 'same-account':
          return t`Pick a different account.`;
        case 'archived-account':
          return t`Archived accounts can't be part of a transfer.`;
        case 'warranty':
          return t`It is linked to a warranty, and that link would be lost.`;
        case 'recurring-occurrence':
          return t`It is linked to a recurring transaction, and that link would be lost.`;
        case 'bank-review':
          return t`It is waiting in a bank sync review, and that link would be lost.`;
      }
    },
    [t]
  );

  /** Reads the row and runs every check. Returns null (after a toast) if it can't proceed. */
  const prepareConversion = React.useCallback(
    async (
      transactionId: number,
      counterpartAccountId: number
    ): Promise<PreparedConversion | null> => {
      const row = rows.find((candidate) => candidate.ID === transactionId);
      const counterpart = accounts.find((account) => account.ID === counterpartAccountId);
      if (!row || !counterpart) return null;

      const fail = (description: string, title = t`Couldn't convert to a transfer`) => {
        toast.error(title, { description });
        return null;
      };

      const services = runtime.services();
      const transaction = (await services.transactions.getTransactionByID(
        transactionId
      )) as ConvertibleTransaction;
      const links = await services.transactions.getTransactionLinks(transactionId);
      const blocker = getConversionBlocker({
        transaction,
        category: row.Category,
        counterpart,
        links,
      });
      if (blocker) return fail(blockerMessage(blocker));

      const ownAccount = accounts.find((account) => account.ID === transaction.AccountID);
      const flow = getTransactionFlow(transaction);
      if (!ownAccount || !flow) return null;

      const counterpartAmount = await computeCounterpartAmount({
        amount: flow.amount,
        ownAccount,
        counterpart,
        date: transaction.Date,
        budgetId: transaction.BudgetID,
        getRate: getExchangeRate,
      });
      if (counterpartAmount === null) {
        return fail(
          t`A ${ownAccount.Currency} to ${counterpart.Currency} rate is required to convert this transaction.`,
          t`Exchange rate unavailable`
        );
      }

      return {
        transactionId,
        counterpartName: counterpart.Name,
        categoryName: row.Category,
        args: buildConvertToTransferArgs({
          transaction,
          category: row.Category,
          ownAccount,
          counterpart,
          categories,
          transferId: generateTransferId(),
          counterpartAmount,
          importIdentities: services.importHistory?.duplicates.identities(transactionId) ?? [],
        }),
      };
    },
    [accounts, blockerMessage, categories, rows, runtime, t]
  );

  const executeConversion = React.useCallback(
    async (prepared: PreparedConversion) => {
      try {
        await runUndoGroup(t`Convert to transfer`, async () => {
          await executeSpaceMutation(runtime, {
            op: 'transactions.delete',
            payload: { id: prepared.transactionId },
            meta: { label: 'convertToTransfer.delete' },
          });
          await executeSpaceMutation(runtime, {
            op: 'transactions.addTransfer',
            payload: { ...prepared.args },
            meta: { label: 'convertToTransfer.addTransfer' },
          });
        });
        toast.success(t`Converted to a transfer with ${prepared.counterpartName}`);
      } catch (error) {
        toast.error(t`Couldn't convert to a transfer`, {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [runtime, t]
  );

  const requestConversion = React.useCallback(
    async (transactionId: number, counterpartAccountId: number) => {
      const row = rows.find((candidate) => candidate.ID === transactionId);
      const counterpart = accounts.find((account) => account.ID === counterpartAccountId);
      if (!row || !counterpart || isLinkedTransferRow(row) || isPending) return;

      setIsPending(true);
      try {
        const prepared = await prepareConversion(transactionId, counterpartAccountId);
        if (!prepared) return;
        if (conversionReplacesCategory(row, Boolean(counterpart.OnBudget))) {
          setPending(prepared);
          return;
        }
        await executeConversion(prepared);
      } catch (error) {
        toast.error(t`Couldn't convert to a transfer`, {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsPending(false);
      }
    },
    [accounts, executeConversion, isPending, prepareConversion, rows, t]
  );

  const requestUnlink = React.useCallback(
    async (transactionId: number) => {
      const row = rows.find((candidate) => candidate.ID === transactionId);
      if (!row || !isLinkedTransferRow(row) || isPending) return;

      setIsPending(true);
      try {
        const services = runtime.services();
        const survivor = (await services.transactions.getTransactionByID(
          transactionId
        )) as ConvertibleTransaction;
        const legs = (
          survivor.TransferID
            ? await services.transactions.getTransactionsByTransferID(survivor.TransferID)
            : [survivor]
        ) as ConvertibleTransaction[];
        const links = await services.transactions.getTransactionLinks(transactionId);
        const blocker = getRevertBlocker({ legs, transactionId, links });
        if (blocker) {
          toast.error(t`Couldn't convert the transfer`, { description: blockerMessage(blocker) });
          return;
        }

        const partner = legs.find((leg) => leg.ID !== transactionId);
        const ownAccount = accounts.find((account) => account.ID === survivor.AccountID);
        const partnerAccount = accounts.find((account) => account.ID === partner?.AccountID);
        if (!partner || !ownAccount || !partnerAccount || !survivor.TransferID) return;

        const addArgs = buildRevertToTransactionArgs({
          survivor,
          ownAccount,
          partnerAccount,
          transfersCategoryId: categories.find((c) => c.Name === 'Transfers')?.ID ?? 0,
          importIdentities: services.importHistory?.duplicates.identities(transactionId) ?? [],
        });

        await runUndoGroup(t`Convert transfer to transaction`, async () => {
          await executeSpaceMutation(runtime, {
            op: 'transactions.deleteTransfer',
            payload: { transferId: survivor.TransferID },
            meta: { label: 'unlinkTransfer.deleteTransfer' },
          });
          await executeSpaceMutation(runtime, {
            op: 'transactions.add',
            payload: { ...addArgs },
            meta: { label: 'unlinkTransfer.add' },
          });
        });
        toast.success(t`Converted back to a regular transaction`);
      } catch (error) {
        toast.error(t`Couldn't convert the transfer`, {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsPending(false);
      }
    },
    [accounts, blockerMessage, categories, isPending, rows, runtime, t]
  );

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={t`Convert to a transfer?`}
      description={
        pending
          ? t`This replaces the category (${pending.categoryName}) with Transfers, so the amount no longer counts as spending. A matching transaction is added to ${pending.counterpartName}.`
          : undefined
      }
      confirmText={t`Convert to transfer`}
      cancelText={t`Cancel`}
      onConfirm={() => {
        const prepared = pending;
        setPending(null);
        if (prepared) void executeConversion(prepared);
      }}
    />
  );

  return {
    requestConversion,
    requestUnlink,
    dialog,
    isPending,
  };
}
