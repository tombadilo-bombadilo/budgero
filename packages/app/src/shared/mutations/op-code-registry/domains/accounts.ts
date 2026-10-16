import { t } from '@lingui/core/macro';
import { asMilli, type Account } from '@budgero/core/browser';
import {
  S,
  ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  TRANSACTION_INVALIDATION_KEYS,
  redoWithIds,
  safeCapture,
  type OpCodeEntry,
} from '../shared';

function parseMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (typeof metadata === 'object') return metadata as Record<string, unknown>;
  try {
    return JSON.parse(String(metadata)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export const accountOps = {
  'accounts.create': {
    execute: async (args) => {
      return await S().accounts!.createAccount(
        args.name as string,
        args.budgetId as number,
        args.type as string,
        args.currency as string,
        asMilli(Number(args.balance ?? 0)),
        (args.metadata as Record<string, unknown>) || undefined,
        !!args.onBudget,
        t`Initial Balance`,
        (args.initialBalanceDate as string | undefined) ?? undefined,
        (args.id as number | undefined) ?? undefined
      );
    },
    invalidates: [
      ['accounts', '*'], // Will match ["accounts", budgetId]
      // Debt and credit accounts create their linked category/group as part
      // of account creation, so dropdowns must refetch them immediately.
      ['categories', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Income calculations depend on on_budget accounts
    ],
    undo: {
      build: (_args, result) => {
        const id = (result as { ID?: number } | undefined)?.ID;
        return typeof id === 'number' ? [{ op: 'accounts.delete', args: { id } }] : [];
      },
    },
    redo: redoWithIds('accounts.create', (args, result) => {
      const id = (result as { ID?: number } | undefined)?.ID;
      return typeof id === 'number' ? { ...args, id } : null;
    }),
  },

  // useEditAccount
  'accounts.update': {
    execute: async (args) => {
      return await S().accounts!.updateAccount(
        args.id as number,
        args.name as string,
        args.type as string,
        args.currency as string,
        (args.metadata as Record<string, unknown>) || undefined,
        args.onBudget as boolean | undefined,
        args.currencyChangeMode === 'reinterpret' ? 'reinterpret' : 'convert'
      );
    },
    invalidates: [
      ['account', '*'], // Will match ["account", id]
      // Currency edits rewrite transactions; liability edits sync Initial Debt.
      ...TRANSACTION_INVALIDATION_KEYS,
      ['debtProgression', '*'],
      // Type/name edits can create, relink, or rename system categories.
      ['categories', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'], // on_budget affects budget calculations
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Income calculations depend on on_budget accounts
    ],
    undo: {
      capture: async (args) => safeCapture(() => S().accounts!.getAccount(args.id as number)),
      build: (args, _result, before) => {
        const account = before as Account | null;
        // A currency change rewrote every amount; converting back would not be exact.
        if (!account || account.Currency !== args.currency) return [];
        return [
          {
            op: 'accounts.update',
            args: {
              id: account.ID,
              name: account.Name,
              type: account.Type,
              currency: account.Currency,
              metadata: parseMetadata(account.Metadata),
              onBudget: Boolean(account.OnBudget),
            },
          },
        ];
      },
    },
  },

  // useReorderAccounts — custom sidebar/nav ordering (Settings → Appearance)
  'accounts.reorder': {
    execute: async (args) => {
      const accountsService = S().accounts as {
        reorderAccounts?: (budgetId: number, orderedAccountIds: number[]) => void;
      };
      if (!accountsService.reorderAccounts) {
        throw new Error('reorderAccounts not available on accounts service');
      }
      return accountsService.reorderAccounts(
        args.budgetId as number,
        args.orderedAccountIds as number[]
      );
    },
    invalidates: [
      ['accounts', '*'], // Will match ["accounts", budgetId]
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() =>
          S()
            .accounts!.listAccounts(args.budgetId as number)
            .map((a) => a.ID)
        ),
      build: (args, _result, before) => {
        const orderedAccountIds = before as number[] | null;
        return orderedAccountIds?.length
          ? [{ op: 'accounts.reorder', args: { budgetId: args.budgetId, orderedAccountIds } }]
          : [];
      },
    },
  },

  // Legacy: accounts.update now syncs the opening rows itself. Kept so queued
  // ops from older clients still replay; budgetId/accountType are ignored.
  'transactions.upsertLiabilityStarts': {
    execute: async (args) => {
      const amount = (value: unknown) => (typeof value === 'number' ? value : null);
      await S().accounts!.upsertLiabilityStarts(
        args.accountId as number,
        amount(args.originalDebt),
        amount(args.paidSoFar)
      );
    },
    invalidates: [
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['allTransactions', '*'], // For useAllTransactions hook
      ['allTransactionsDetailed', '*'], // For useAllTransactionsDetailed hook
      ['allTransactionsAnalytics', '*'], // For useAllTransactionsAnalytics hook
      ['uncategorizedTransactions', '*'], // For uncategorized badges
      ['allAccountsMonthlyTransactions', '*'], // For all accounts monthly transactions
      ['accounts'],
      // Ensures the Transfers category/group.
      ['categories', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
      ['readyToAssign'],
      ['monthlySpending', '*'], // Analytics queries
      ['monthlyBalance', '*'],
      ['spendingByDates', '*'],
      ['spendingByCategoryAndMonth', '*'],
      ['debtProgression', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
    ],
  },

  // useSetAccountArchived
  'accounts.setArchived': {
    execute: async (args) => {
      const accountsService = S().accounts as {
        setAccountArchived?: (id: number, archived: boolean) => void;
      };
      if (!accountsService.setAccountArchived) {
        throw new Error('setAccountArchived not available on accounts service');
      }
      return accountsService.setAccountArchived(args.id as number, args.archived as boolean);
    },
    invalidates: [
      ['accounts', '*'],
      ['account', '*'], // Will match ["account", id]
      // Unarchiving a credit/debt account can recreate its system-linked
      // category (and group) if it was deleted while archived.
      ['categories', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'],
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() => Boolean(S().accounts!.getAccount(args.id as number).Archived)),
      build: (args, _result, before) =>
        typeof before === 'boolean' && before !== Boolean(args.archived)
          ? [{ op: 'accounts.setArchived', args: { id: args.id, archived: before } }]
          : [],
    },
  },

  // useDeleteAccount
  'accounts.delete': {
    execute: async (args) => {
      return await S().accounts!.deleteAccount(args.id as number);
    },
    invalidates: [
      ['accounts', '*'], // Will match ["accounts", budgetId]
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      // Deleting a debt/credit account removes its linked system category.
      ['categories', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Deleting account removes its transactions, affecting income
    ],
  },
} satisfies Record<string, OpCodeEntry>;
