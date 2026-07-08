import { asMilli, ZERO_MILLI } from '@budgero/core/browser';
import { capitalize } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { S, type OpCodeEntry } from '../shared';

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
        !!args.onBudget
      );
    },
    invalidates: [
      ['accounts', '*'], // Will match ["accounts", budgetId]
      ['monthlyBudget', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Income calculations depend on on_budget accounts
    ],
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
        args.onBudget as boolean | undefined
      );
    },
    invalidates: [
      ['accounts', '*'], // Will match ["accounts", budgetId]
      ['account', '*'], // Will match ["account", id]
      ['transactions', '*'], // Currency/type edits can rewrite transactions
      ['monthlyBudget', '*'], // on_budget affects budget calculations
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Income calculations depend on on_budget accounts
    ],
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
      ['transactions'],
      ['allTransactions', '*'], // For useAllTransactions hook
      ['allTransactionsDetailed', '*'], // For useAllTransactionsDetailed hook
      ['uncategorizedTransactions', '*'], // For uncategorized badges
      ['allAccountsMonthlyTransactions', '*'], // For all accounts monthly transactions
      ['accounts'],
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
  },

  // useDeleteAccount
  'accounts.delete': {
    execute: async (args) => {
      return await S().accounts!.deleteAccount(args.id as number);
    },
    invalidates: [
      ['accounts', '*'], // Will match ["accounts", budgetId]
      ['transactions'],
      ['monthlyBudget', '*'],
      ['onBudgetBalance'],
      ['onBudgetBalanceByDates'],
      ['readyToAssign', '*'], // Deleting account removes its transactions, affecting income
    ],
  },
} satisfies Record<string, OpCodeEntry>;
