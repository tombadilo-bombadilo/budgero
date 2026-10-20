import { t } from '@lingui/core/macro';
import { asMilli, isRowJournal, type Account, type BankLinkInput } from '@budgero/core/browser';
import {
  S,
  ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  TRANSACTION_INVALIDATION_KEYS,
  RECURRING_OCCURRENCE_INVALIDATIONS,
  RECURRING_TEMPLATE_INVALIDATIONS,
  redoWithIds,
  safeCapture,
  type OpCodeEntry,
} from '../shared';
import { missingPayees, removeAddedPayees, type MissingPayees } from './transactions';

/** Payee of an account's opening row: the create adds it to the directory when missing. */
const OPENING_PAYEE = 'Budgero';

/** Undo of an account create: delete it, then the opening payee entry the create added. */
const accountCreateUndo: NonNullable<OpCodeEntry['undo']> = {
  capture: async (args) => ({ payees: missingPayees(args.budgetId, [OPENING_PAYEE]) }),
  build: (_args, result, before) => {
    const id = (result as { ID?: number } | undefined)?.ID;
    if (typeof id !== 'number') return [];
    return [
      { op: 'accounts.delete', args: { id } },
      ...removeAddedPayees((before as { payees?: MissingPayees } | undefined)?.payees),
    ];
  },
};

function parseMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (typeof metadata === 'object') return metadata as Record<string, unknown>;
  try {
    return JSON.parse(String(metadata)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function createAccount(args: Record<string, unknown>, link?: Record<string, unknown>) {
  return S().accounts!.createAccount(
    args.name as string,
    args.budgetId as number,
    args.type as string,
    args.currency as string,
    asMilli(Number(args.balance ?? 0)),
    (args.metadata as Record<string, unknown>) || undefined,
    !!args.onBudget,
    t`Initial Balance`,
    (args.initialBalanceDate as string | undefined) ?? undefined,
    (args.id as number | undefined) ?? undefined,
    link
      ? {
          openingCleared: true,
          bankLink: link as unknown as Omit<BankLinkInput, 'budgetId' | 'accountId'>,
        }
      : {}
  );
}

const ACCOUNT_CREATE_INVALIDATIONS: string[][] = [
  ['accounts', '*'], // Will match ["accounts", budgetId]
  // Debt and credit accounts create their linked category/group as part
  // of account creation, so dropdowns must refetch them immediately.
  ['categories', '*'],
  ['categoryGroups', '*'],
  ['monthlyBudget', '*'],
  ['onBudgetBalance'],
  ['onBudgetBalanceByDates'],
  ['readyToAssign', '*'], // Income calculations depend on on_budget accounts
];

const ACCOUNT_DELETE_INVALIDATIONS: string[][] = [
  ['accounts', '*'], // Will match ["accounts", budgetId]
  ['account', '*'],
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
];

const ACCOUNT_RESTORE_INVALIDATIONS: string[][] = [
  ...ACCOUNT_DELETE_INVALIDATIONS,
  ...TRANSACTION_INVALIDATION_KEYS,
  ['goals', '*'],
  ['goal', '*'],
  ['transactionSplits', '*'],
  ...RECURRING_TEMPLATE_INVALIDATIONS,
  ...RECURRING_OCCURRENCE_INVALIDATIONS,
  ['bankSync', '*'],
];

export const accountOps = {
  'accounts.create': {
    execute: async (args) => createAccount(args),
    invalidates: ACCOUNT_CREATE_INVALIDATIONS,
    undo: accountCreateUndo,
    redo: redoWithIds('accounts.create', (args, result) => {
      const id = (result as { ID?: number } | undefined)?.ID;
      return typeof id === 'number' ? { ...args, id } : null;
    }),
  },

  /**
   * Bank linking: create the account, its cleared opening balance and its bank
   * link in one transaction, so a failure never leaves an unlinked account.
   * Replaces accounts.create + transactions.setCleared + bankSync.saveLink.
   */
  'accounts.createLinked': {
    execute: async (args) => createAccount(args, args.link as Record<string, unknown>),
    invalidates: [
      ...ACCOUNT_CREATE_INVALIDATIONS,
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['bankSync', '*'],
    ],
    // Keeps the opening payee entry on undo (accounts.delete-undo integration
    // spec pins this undo to the delete alone); allow-listed as A23-payee.
    undo: {
      build: (_args, result) => {
        const id = (result as { ID?: number } | undefined)?.ID;
        return typeof id === 'number' ? [{ op: 'accounts.delete', args: { id } }] : [];
      },
    },
    redo: redoWithIds('accounts.createLinked', (args, result) => {
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
    // Same delete as before; it now also returns what it removed, for undo.
    execute: async (args) => S().accounts!.deleteAccountWithUndo(args.id as number),
    invalidates: ACCOUNT_DELETE_INVALIDATIONS,
    undo: {
      build: (args, result) =>
        isRowJournal(result)
          ? [{ op: 'accounts.restoreDeleted', args: { budgetId: args.budgetId, journal: result } }]
          : [],
    },
  },

  /** Undo of accounts.delete; `journal` is the delete's result. */
  'accounts.restoreDeleted': {
    execute: async (args) => {
      if (!isRowJournal(args.journal)) throw new Error('Nothing to restore');
      S().accounts!.restoreDeletedAccount(args.journal);
    },
    invalidates: ACCOUNT_RESTORE_INVALIDATIONS,
  },
} satisfies Record<string, OpCodeEntry>;
