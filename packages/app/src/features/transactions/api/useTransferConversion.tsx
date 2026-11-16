import * as React from 'react';
import { parseISO } from 'date-fns';
import { Trans, useLingui } from '@lingui/react/macro';
import { toast } from 'sonner';
import type { Account, GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useCategories } from '@entities/category/api/useCategories';
import { formatNativeAmount, getExchangeRate } from '@entities/currency/lib/currency-utils';
import { formatDate } from '@shared/lib/date-format';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import { runUndoGroup } from '@shared/mutations/UndoStore';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { generateTransferId } from '@features/transactions/ui/add-transaction/add-transaction.utils';
import {
  conversionReplacesCategory,
  isLinkedTransferRow,
} from '@features/transactions/lib/transfer-payee-options';
import {
  buildConvertToTransferArgs,
  buildPairCandidateQuery,
  buildRevertToTransactionArgs,
  canPairWith,
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

/** A transaction already in the other account that can become the transfer's other leg. */
interface PairOption {
  id: number;
  date: string;
  label: string;
  amount: number;
  currency: string;
  /** Payload that reuses it instead of adding a new leg. */
  args: AddTransferArgs;
}

/** A conversion that passed every check and is waiting only for the user's confirmation. */
interface PreparedConversion {
  transactionId: number;
  counterpartName: string;
  categoryName: string;
  /** Whether the row's category gets replaced by Transfers (worth a confirmation). */
  replacesCategory: boolean;
  args: AddTransferArgs;
  pair: PairOption | null;
}

const DEFAULT_PAIR_SETTINGS = { toleranceBps: 100, dayWindow: 7 };

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
  const [usePair, setUsePair] = React.useState(true);
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

      const transferId = generateTransferId();
      const importIdentities = services.importHistory?.duplicates.identities(transactionId) ?? [];
      const baseArgs = {
        transaction,
        category: row.Category,
        ownAccount,
        counterpart,
        categories,
        transferId,
        counterpartAmount,
        importIdentities,
      };

      // Both sides may already be here (bank sync, file import): offer the existing
      // row in the other account instead of adding a duplicate.
      let pair: PairOption | null = null;
      const settings =
        (await services.userMeta?.getDuplicateHintSettings?.()) ?? DEFAULT_PAIR_SETTINGS;
      const query = buildPairCandidateQuery({
        transaction,
        ownAccount,
        counterpart,
        counterpartAmount,
        settings,
      });
      const matches = query ? await services.transactions.findSimilarTransactions(query) : [];
      for (const match of matches) {
        const candidate = (await services.transactions.getTransactionByID(
          match.ID
        )) as ConvertibleTransaction;
        const candidateLinks = await services.transactions.getTransactionLinks(match.ID);
        if (
          !canPairWith({
            transaction,
            candidate,
            links: candidateLinks,
            sameCurrency: ownAccount.Currency === counterpart.Currency,
          })
        ) {
          continue;
        }
        const pairFlow = getTransactionFlow(candidate);
        if (!pairFlow) continue;
        pair = {
          id: candidate.ID,
          date: candidate.Date,
          label: match.Payee || match.Memo,
          amount: pairFlow.amount,
          currency: counterpart.Currency,
          args: buildConvertToTransferArgs({
            ...baseArgs,
            pairWith: {
              transaction: candidate,
              importIdentities: services.importHistory?.duplicates.identities(candidate.ID) ?? [],
            },
          }),
        };
        break;
      }

      return {
        transactionId,
        counterpartName: counterpart.Name,
        categoryName: row.Category,
        replacesCategory: conversionReplacesCategory(row, Boolean(counterpart.OnBudget)),
        args: buildConvertToTransferArgs(baseArgs),
        pair,
      };
    },
    [accounts, blockerMessage, categories, rows, runtime, t]
  );

  const executeConversion = React.useCallback(
    async (prepared: PreparedConversion, withPair: boolean) => {
      const pair = withPair ? prepared.pair : null;
      try {
        await runUndoGroup(t`Convert to transfer`, async () => {
          await executeSpaceMutation(runtime, {
            op: 'transactions.delete',
            payload: { id: prepared.transactionId },
            meta: { label: 'convertToTransfer.delete' },
          });
          if (pair) {
            await executeSpaceMutation(runtime, {
              op: 'transactions.delete',
              payload: { id: pair.id },
              meta: { label: 'convertToTransfer.deletePair' },
            });
          }
          await executeSpaceMutation(runtime, {
            op: 'transactions.addTransfer',
            payload: { ...(pair ? pair.args : prepared.args) },
            meta: { label: 'convertToTransfer.addTransfer' },
          });
        });
        toast.success(
          pair
            ? t`Converted to a transfer with the existing transaction in ${prepared.counterpartName}`
            : t`Converted to a transfer with ${prepared.counterpartName}`
        );
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
        if (prepared.pair || prepared.replacesCategory) {
          setUsePair(true);
          setPending(prepared);
          return;
        }
        await executeConversion(prepared, false);
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
        !pending
          ? undefined
          : pending.pair
            ? pending.replacesCategory
              ? t`This replaces the category (${pending.categoryName}) with Transfers, so the amount no longer counts as spending. ${pending.counterpartName} already has a transaction that looks like the other side.`
              : t`${pending.counterpartName} already has a transaction that looks like the other side.`
            : t`This replaces the category (${pending.categoryName}) with Transfers, so the amount no longer counts as spending. A matching transaction is added to ${pending.counterpartName}.`
      }
      confirmText={t`Convert to transfer`}
      cancelText={t`Cancel`}
      onConfirm={() => {
        const prepared = pending;
        setPending(null);
        if (prepared) void executeConversion(prepared, usePair);
      }}
    >
      {pending?.pair ? (
        <RadioGroup
          value={usePair ? 'pair' : 'new'}
          onValueChange={(value) => setUsePair(value === 'pair')}
          aria-label={t`Other side of the transfer`}
        >
          <label
            htmlFor="transfer-pair-existing"
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
          >
            <RadioGroupItem id="transfer-pair-existing" value="pair" className="mt-0.5" />
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium">
                <Trans>Use the existing transaction</Trans>
              </span>
              <span className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  {formatDate(parseISO(pending.pair.date.slice(0, 10)), 'MMM d')} ·{' '}
                  {pending.pair.label || '—'}
                </span>
                <span className="shrink-0 font-mono">
                  {formatNativeAmount(pending.pair.amount, pending.pair.currency)}{' '}
                  {pending.pair.currency}
                </span>
              </span>
            </span>
          </label>
          <label
            htmlFor="transfer-pair-new"
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
          >
            <RadioGroupItem id="transfer-pair-new" value="new" className="mt-0.5" />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                <Trans>Add a new transaction</Trans>
              </span>
              <span className="block text-xs text-muted-foreground">
                <Trans>
                  Adds another one to {pending.counterpartName} and leaves the existing one as it
                  is.
                </Trans>
              </span>
            </span>
          </label>
        </RadioGroup>
      ) : null}
    </ConfirmDialog>
  );

  return {
    requestConversion,
    requestUnlink,
    dialog,
    isPending,
  };
}
