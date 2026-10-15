import { t } from '@lingui/core/macro';
import { asMilli, ZERO_MILLI, type Account } from '@budgero/core/browser';
import { capitalize } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import {
  S,
  ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
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
      ['accounts', '*'], // Will match ["accounts", budgetId]
      ['account', '*'], // Will match ["account", id]
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS, // Currency/type edits can rewrite transactions
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

  // upsert liability starting transactions (initial debt and prior payments)
  'transactions.upsertLiabilityStarts': {
    execute: async (args) => {
      const accountId = args.accountId as number;
      const budgetId = args.budgetId as number;
      const originalDebt = args.originalDebt as number | null;
      const accountType = (args.accountType as string) || 'loan';

      const txService = S().transactions;
      const catService = S().categories;

      const now = getTodayISO();

      // Ensure Liabilities group and category exist
      const group = catService.getCategoryGroupByName('Liabilities', budgetId) || {
        ID: catService.addCategoryGroup('Liabilities', budgetId),
      };
      const categoryName = capitalize(accountType);
      const existingCategory = catService.getCategoryByName(categoryName, budgetId);
      const liabilityCategoryId = existingCategory
        ? existingCategory.ID
        : catService.addCategory(group.ID, budgetId, categoryName, '');

      // Find the first "Initial Debt" transaction for this account
      const allTransactions = txService.getTransactionsByAccount(accountId);
      const sorted = [...allTransactions].sort((a, b) => {
        const dc = (a.Date || '').localeCompare(b.Date || '');
        return dc !== 0 ? dc : (a.ID || 0) - (b.ID || 0);
      });

      type TransactionRow = (typeof allTransactions)[number];
      let initialDebtTx: TransactionRow | null = null;
      for (const t of sorted) {
        if ((t.Memo || '').toLowerCase() === 'initial debt') {
          initialDebtTx = t;
          break;
        }
      }

      if (typeof originalDebt === 'number') {
        const originalDebtMilli = asMilli(originalDebt);
        if (initialDebtTx) {
          await txService.updateTransaction(
            initialDebtTx.ID,
            ZERO_MILLI,
            originalDebtMilli,
            accountId,
            liabilityCategoryId,
            initialDebtTx.Date,
            'Initial Debt'
          );
        } else {
          await txService.addTransaction(
            ZERO_MILLI,
            originalDebtMilli,
            accountId,
            liabilityCategoryId,
            budgetId,
            now,
            'Initial Debt',
            ''
          );
        }
      }
      // Note: Balance recalculation is handled internally by addTransaction/updateTransaction
    },
    invalidates: [
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['allTransactions', '*'], // For useAllTransactions hook
      ['allTransactionsDetailed', '*'], // For useAllTransactionsDetailed hook
      ['allTransactionsAnalytics', '*'], // For useAllTransactionsAnalytics hook
      ['uncategorizedTransactions', '*'], // For uncategorized badges
      ['allAccountsMonthlyTransactions', '*'], // For all accounts monthly transactions
      ['accounts'],
      // This legacy liability-start path also ensures its category/group.
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
      // Deleting a debt/credit account removes its linked system category;
      // rows other accounts held in it move to Uncategorized.
      ['categories', '*'],
      ['allTransactions', '*'],
      ['allTransactionsDetailed', '*'],
      ['allTransactionsAnalytics', '*'],
      ['uncategorizedTransactions', '*'],
      ['transactionsByCategoryAndMonth', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Deleting account removes its transactions, affecting income
    ],
  },
} satisfies Record<string, OpCodeEntry>;
