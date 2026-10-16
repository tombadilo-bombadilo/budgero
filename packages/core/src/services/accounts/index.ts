import { DatabaseAdapter } from '../../database/interface.js';
import { allRows, getRow, run } from '../../database/sql.js';
import {
  journalSize,
  RowCapture,
  restoreRowJournal,
  type RowJournal,
} from '../../database/row-journal.js';
import { asMilli, subMilli, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import {
  Account,
  defaultOnBudgetForType,
  isCreditAccountType,
  isDebtAccountType,
  isLiabilityAccountType,
} from './types.js';
import { AccountQueries } from './queries.js';
import { isCryptoCurrency } from '../../currencies/index.js';
import { TransactionService, type TransactionConversion } from '../transactions/index.js';
import { BankSyncQueries } from '../bank-sync/queries.js';
import type { BankLinkInput } from '../bank-sync/types.js';
import {
  ensureCategoryGroup,
  ensureCategoryWithGroup,
  ensureUncategorizedCategory,
} from '../transactions/category-helpers.js';
import { CurrencyService } from '../currency/index.js';
import { CategoryService } from '../categories/index.js';

import { createLogger } from '../../logger.js';
import { getLocalDateString } from '../../utils/date.js';

const debugLog = createLogger('services:accounts');

const SYSTEM_PAYEE = 'Budgero';

/** Deletes larger than this (rows removed) keep no undo data. */
export const ACCOUNT_UNDO_ROW_LIMIT = 5000;

/** Tables an account-delete undo may write back to. */
const ACCOUNT_RESTORE_TABLES: ReadonlySet<string> = new Set([
  'accounts',
  'transactions',
  'transaction_splits',
  'import_provenance',
  'bank_links',
  'bank_reviews',
  'account_revaluations',
  'recurring_transactions',
  'recurring_transaction_occurrences',
  'transaction_rule_run_changes',
  'warranties',
  'category_groups',
  'categories',
  'assignments',
  'goals',
]);

export interface CreateAccountOptions {
  /** Mark the opening rows cleared (an account opened from a bank balance). */
  openingCleared?: boolean;
  /** Link the new account to a bank feed in the same transaction. */
  bankLink?: Omit<BankLinkInput, 'budgetId' | 'accountId'>;
}

/**
 * AccountService - Port of Go accounts service
 * Handles account CRUD operations and automatically creates required categories
 */
export class AccountService {
  private queries: AccountQueries;

  private transactionService: TransactionService;

  private currencyService: CurrencyService;

  private categoryService: CategoryService;

  constructor(private db: DatabaseAdapter) {
    this.queries = new AccountQueries(db);
    this.transactionService = new TransactionService(db);
    this.currencyService = new CurrencyService(db);
    this.categoryService = new CategoryService(db);
  }

  /**
   * CreateAccount - Creates a new account with initial balance transaction
   * Automatically creates "Transfers" and "Income" category groups/categories if they don't exist
   *
   * Atomic: every async lookup (exchange rates) runs first; the account, its
   * system categories, its opening rows and (optionally) its bank link are then
   * written in ONE database transaction. Any failure — e.g. no rate for a crypto
   * opening balance while offline — leaves nothing behind.
   */
  async createAccount(
    name: string,
    budgetId: number,
    accType: string,
    currency: string,
    balance: MilliUnits,
    metadata?: Record<string, unknown>,
    onBudget?: boolean,
    /** Memo written on the opening transaction; app passes a localized string. */
    initialBalanceMemo = 'Initial Balance',
    initialBalanceDate?: string,
    /** Only passed by redo, to recreate the account under its original ID. */
    id?: number,
    options: CreateAccountOptions = {}
  ): Promise<Account> {
    if (!name.trim()) {
      throw new Error('account name cannot be empty');
    }

    if (metadata?.cc_payment_category_id !== undefined) {
      this.validatePaymentCategoryLink(budgetId, metadata.cc_payment_category_id);
    }

    // Determine default on_budget value based on account type if not explicitly set
    let isOnBudget = onBudget;
    if (isOnBudget === undefined) {
      // Crypto holdings default to tracking-only regardless of account type:
      // market volatility should not jitter Ready to Assign unless opted in.
      isOnBudget = isCryptoCurrency(currency) ? false : defaultOnBudgetForType(accType);
    }

    // Create initial transaction depending on account type
    // - Standard accounts: positive initial inflow sets opening balance
    // - Liability accounts (credit/loan/mortgage): record an initial outflow equal to total debt
    //   so the running balance starts negative and payments (inflows) reduce the debt
    const currentDate = initialBalanceDate ?? getLocalDateString();

    let isLiability = false;
    let initialDebt: MilliUnits = ZERO_MILLI;
    let paidSoFar: MilliUnits = ZERO_MILLI;
    try {
      const md = (metadata || {}) as Record<string, unknown>;
      isLiability = Boolean(md.liability) || isLiabilityAccountType(accType);
      if (md && typeof md.debt_total === 'number') {
        initialDebt = asMilli(Math.max(0, md.debt_total));
      }
      if (md && typeof md.paid_so_far === 'number') {
        paidSoFar = asMilli(Math.max(0, md.paid_so_far));
      }
    } catch {
      // Metadata parsing is best-effort; continue with default values if it fails
    }

    // The opening rows, in insertion order.
    // Liability accounts (credit cards, loans, mortgages) use the "Transfers"
    // category so the opening affects the account balance but NOT budget Available.
    const openingRows: {
      inflow: MilliUnits;
      outflow: MilliUnits;
      memo: string;
      category: 'transfers' | 'income';
    }[] = [];
    if (isLiability) {
      // Create initial principal outflow when original debt is provided
      if (initialDebt > 0) {
        openingRows.push({
          inflow: ZERO_MILLI,
          outflow: initialDebt,
          memo: 'Initial Debt',
          category: 'transfers',
        });
      }
      // Record prior payments (paid so far) as an inflow so remaining = original - paid
      if (paidSoFar > 0) {
        openingRows.push({
          inflow: paidSoFar,
          outflow: ZERO_MILLI,
          memo: 'Prior payments',
          category: 'transfers',
        });
      }
      // Plain opening balance: the caller gave a balance but no debt_total /
      // paid_so_far metadata (e.g. onboarding, where a user types the amount
      // they owe on a card). Honor the SIGNED balance so the account starts
      // where the user said — negative = existing debt (outflow), positive =
      // credit/overpaid (inflow). Without this, liability accounts silently opened at 0.
      if (initialDebt === 0 && paidSoFar === 0 && balance !== 0) {
        openingRows.push({
          inflow: balance > 0 ? balance : ZERO_MILLI,
          outflow: balance < 0 ? subMilli(ZERO_MILLI, balance) : ZERO_MILLI,
          memo: initialBalanceMemo,
          category: 'transfers',
        });
      }
    } else if (balance !== 0) {
      // Standard account initial balance, in the Income category
      openingRows.push({
        inflow: balance,
        outflow: ZERO_MILLI,
        memo: initialBalanceMemo,
        category: 'income',
      });
    }

    // ---- async lookups first: nothing below this block awaits ----
    // Pre-fetch the rate so the initial-balance transaction can be converted immediately.
    const budget = this.queries.getBudget(budgetId);
    if (budget && currency !== budget.DisplayCurrency && balance !== 0) {
      try {
        debugLog(
          `🔄 Pre-fetching currency rate for ${currency} → ${budget.DisplayCurrency} for account creation`
        );

        const rate = await this.currencyService.getOrFetchRate(
          currency,
          budget.DisplayCurrency,
          currentDate,
          budgetId
        );

        if (rate) {
          debugLog(
            `✅ Currency rate pre-fetch successful: ${currency} → ${budget.DisplayCurrency} = ${rate}`
          );
        } else {
          console.warn(
            `⚠️ Currency rate not available after retries: ${currency} → ${budget.DisplayCurrency}`
          );
          console.warn(
            `⚠️ Account will be created but opening balance may not be converted properly`
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed to pre-fetch currency rate for ${currency} → ${budget.DisplayCurrency}:`,
          error
        );
        console.warn(
          `⚠️ Account will be created but opening balance may not be converted properly`
        );
        // Continue with account creation even if rate fetch fails
        // The transaction will use the original amount (no conversion)
      }
    }
    // Throws (before anything is written) when a crypto opening has no rate.
    const conversions: TransactionConversion[] = [];
    for (const row of openingRows) {
      conversions.push(
        await this.transactionService.resolveConversion(
          currency,
          budget,
          currentDate,
          budgetId,
          row.inflow,
          row.outflow
        )
      );
    }

    // ---- every write in one transaction ----
    return this.db.transaction(() => {
      // Create the account with 0 balance first (the initial balance will be added via transaction)
      const metadataJson = JSON.stringify(metadata || {});
      const accountId = this.queries.createAccount(
        name,
        accType,
        currency,
        null,
        0,
        budgetId,
        metadataJson,
        isOnBudget,
        id
      );

      const transfersCategoryId = ensureCategoryWithGroup(
        this.categoryService,
        budgetId,
        'Transfers',
        'Transfers',
        ''
      );
      const incomeCategoryId = ensureCategoryWithGroup(
        this.categoryService,
        budgetId,
        'Income',
        'Income',
        ''
      );

      // If liability (but NOT credit card), prepare Liabilities group and per-account linked category
      // Credit cards don't need linked categories because spending is categorized when you use the card,
      // not when you pay the bill. Loans/mortgages DO need linked categories because the payment IS the expense.
      let linkedCategoryId: number | undefined;
      const needsLinkedCategory = isLiability && !isCreditAccountType(accType);

      if (needsLinkedCategory) {
        const requestedLinkedCategoryId = (metadata || {}).linked_category_id;
        if (this.categoryExistsInBudget(budgetId, requestedLinkedCategoryId)) {
          // Importers can preserve an explicit source-system payment category.
          // Ordinary account creation still falls through to the Budgero-owned
          // Liabilities category below.
          linkedCategoryId = requestedLinkedCategoryId as number;
        } else {
          const liabilitiesGroupId = ensureCategoryGroup(
            this.categoryService,
            budgetId,
            'Liabilities'
          );

          // Create per-account linked category (e.g., "Home Mortgage")
          // This category will be used for tracking spending when paying down this debt
          linkedCategoryId = this.categoryService.addCategory(
            liabilitiesGroupId,
            budgetId,
            name, // Use account name for the category
            ''
          );
        }

        // Store linked category ID in metadata for transfer handling
        const updatedMetadata = {
          ...(metadata || {}),
          linked_category_id: linkedCategoryId,
        };
        this.queries.updateAccountMetadata(accountId, JSON.stringify(updatedMetadata));
      }

      // For credit cards, create a CC Payment category
      // This category tracks money set aside for CC payments using YNAB-style mechanics:
      // - CC spending in real categories auto-funds this category
      // - Payments to CC draw from this category
      // - Legacy debt doesn't pre-populate; user assigns to pay it down
      const isCreditCard = isCreditAccountType(accType);
      let ccPaymentCategoryId: number | undefined;

      if (isCreditCard) {
        // Per-card payment category (e.g., "Chase CC"), named after the account.
        // Reuses an unclaimed same-named category already in the group. Each
        // account owns its payment category even when display names match.
        const requestedPaymentCategoryId = (metadata || {}).cc_payment_category_id;
        if (requestedPaymentCategoryId !== undefined) {
          ccPaymentCategoryId = requestedPaymentCategoryId as number;
        } else {
          ccPaymentCategoryId = this.reattachOrCreateCategory(
            budgetId,
            'Credit Card Payments',
            name,
            accountId
          );
        }

        const updatedMetadata = {
          ...(metadata || {}),
          cc_payment_category_id: ccPaymentCategoryId,
        };
        this.queries.updateAccountMetadata(accountId, JSON.stringify(updatedMetadata));
      }

      openingRows.forEach((row, index) => {
        this.transactionService.insertTransaction(
          {
            inflowOriginal: row.inflow,
            outflowOriginal: row.outflow,
            accountId,
            categoryId: row.category === 'income' ? incomeCategoryId : transfersCategoryId,
            budgetId,
            date: currentDate,
            memo: row.memo,
            transferId: '',
            payee: SYSTEM_PAYEE,
            // Bank-linked accounts open from the bank's own balance: cleared.
            cleared: Boolean(options.openingCleared),
          },
          conversions[index]
        );
      });

      if (options.bankLink) {
        new BankSyncQueries(this.db).upsertLink({ ...options.bankLink, budgetId, accountId });
      }

      const account = this.queries.getAccount(accountId);
      if (!account) {
        throw new Error('Failed to retrieve created account');
      }

      return account;
    });
  }

  /**
   * GetAccount - Gets a specific account by ID
   */
  getAccount(id: number): Account {
    const account = this.queries.getAccount(id);
    if (!account) {
      throw new Error(`Account with id ${id} not found`);
    }
    return account;
  }

  /**
   * ListAccounts - Gets all accounts for a budget
   */
  listAccounts(budgetId: number): Account[] {
    return this.queries.listAccounts(budgetId);
  }

  /**
   * UpdateAccount - Updates an account's properties
   * Uses original values if updated values are empty
   * Handles currency changes by clearing converted amounts
   * Updates linked category name and transfer memos when account name changes
   */
  async updateAccount(
    id: number,
    name: string,
    accType: string,
    currency: string,
    metadata?: Record<string, unknown>,
    onBudget?: boolean,
    currencyChangeMode: 'convert' | 'reinterpret' = 'convert'
  ): Promise<void> {
    const originalAccount = this.getAccount(id);

    const finalName = name.trim() || originalAccount.Name;
    const finalAccType = accType.trim() || originalAccount.Type;
    const finalCurrency = currency.trim() || originalAccount.Currency;

    const nameChanged = finalName !== originalAccount.Name;

    // Validate caller-supplied links before currency conversion or any database
    // writes. Metadata omitted by an edit form still preserves the stored link.
    if (metadata?.cc_payment_category_id !== undefined) {
      this.validatePaymentCategoryLink(
        originalAccount.BudgetID,
        metadata.cc_payment_category_id,
        id
      );
    }

    if (finalCurrency !== originalAccount.Currency) {
      // Handle currency change before updating
      await this.currencyService.handleAccountCurrencyChange(
        id,
        originalAccount.BudgetID,
        finalCurrency,
        originalAccount.Currency,
        currencyChangeMode
      );
    }

    // Parse the original metadata once; several blocks below need it.
    let originalMetadata: Record<string, unknown> = {};
    try {
      const raw = originalAccount.Metadata;
      originalMetadata = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...(raw || {}) };
    } catch {
      originalMetadata = {};
    }

    // System-managed keys must survive caller-supplied metadata. The account
    // edit form rebuilds metadata from its own fields and would otherwise
    // silently drop the category links, decoupling the account from its
    // CC Payment / linked category forever.
    const SYSTEM_METADATA_KEYS = [
      'cc_payment_category_id',
      'linked_category_id',
      'ynab_account_id',
      'ynab_credit_payment_category_id',
    ] as const;
    let persistedMetadata: Record<string, unknown> | undefined;
    if (metadata !== undefined) {
      persistedMetadata = { ...metadata };
      for (const key of SYSTEM_METADATA_KEYS) {
        if (persistedMetadata[key] === undefined && originalMetadata[key] !== undefined) {
          persistedMetadata[key] = originalMetadata[key];
        }
      }
    }

    const metadataJson =
      persistedMetadata !== undefined ? JSON.stringify(persistedMetadata) : undefined;
    this.queries.updateAccount(id, finalName, finalAccType, finalCurrency, metadataJson, onBudget);

    // Working view of what's stored now; the type-change block may add to it.
    let effectiveMetadata: Record<string, unknown> =
      persistedMetadata !== undefined ? { ...persistedMetadata } : { ...originalMetadata };

    // If the account type changed, make sure the categories debt types rely on exist.
    // Accounts *created* as credit/loan/mortgage get these in createAccount; an account
    // whose type is edited later needs the same treatment, otherwise CC payment
    // mechanics (and loan linked categories) silently never engage.
    const typeChanged = finalAccType.toLowerCase() !== (originalAccount.Type || '').toLowerCase();
    if (typeChanged) {
      const budgetId = originalAccount.BudgetID;
      const newType = finalAccType.toLowerCase();

      // Changed to credit card → ensure the per-card CC Payment category exists
      // (also recreates a link that points at a since-deleted category).
      if (
        isCreditAccountType(newType) &&
        !this.isCreditPaymentCategory(budgetId, effectiveMetadata.cc_payment_category_id)
      ) {
        effectiveMetadata = {
          ...effectiveMetadata,
          cc_payment_category_id: this.reattachOrCreateCategory(
            budgetId,
            'Credit Card Payments',
            finalName,
            id
          ),
        };
        this.queries.updateAccountMetadata(id, JSON.stringify(effectiveMetadata));
      }

      // Changed to loan/mortgage → ensure the linked category (the payment IS the expense)
      if (
        isDebtAccountType(newType) &&
        !this.categoryExistsInBudget(budgetId, effectiveMetadata.linked_category_id)
      ) {
        effectiveMetadata = {
          ...effectiveMetadata,
          linked_category_id: this.reattachOrCreateCategory(budgetId, 'Liabilities', finalName),
        };
        this.queries.updateAccountMetadata(id, JSON.stringify(effectiveMetadata));
      }
    }

    if (nameChanged) {
      // Update linked category name (for debt accounts) and CC Payment category
      // (for credit cards). Read from the metadata as persisted above, so links
      // preserved or created during this very update are honored too.
      const linkedCategoryId = effectiveMetadata.linked_category_id;
      if (typeof linkedCategoryId === 'number') {
        this.categoryService.updateCategoryName(linkedCategoryId, finalName);
      }

      const ccPaymentCategoryId = effectiveMetadata.cc_payment_category_id;
      if (
        this.isCreditPaymentCategory(originalAccount.BudgetID, ccPaymentCategoryId) &&
        !this.paymentCategoryClaimedByAnotherAccount(ccPaymentCategoryId as number, id)
      ) {
        this.categoryService.updateCategoryName(ccPaymentCategoryId as number, finalName);
      }

      this.transactionService.updateTransferMemosForAccountRename(
        originalAccount.BudgetID,
        originalAccount.Name,
        finalName
      );
    }

    // Starting debt / prior payments edited on a liability: keep the opening
    // rows createAccount wrote in step with the metadata. Untouched values
    // leave the transactions alone.
    const savedMetadata = persistedMetadata;
    if (
      savedMetadata !== undefined &&
      (Boolean(savedMetadata.liability) || isLiabilityAccountType(finalAccType))
    ) {
      const changedAmount = (key: 'debt_total' | 'paid_so_far'): number | null => {
        const next = savedMetadata[key];
        return typeof next === 'number' && next !== originalMetadata[key] ? next : null;
      };
      const originalDebt = changedAmount('debt_total');
      const paidSoFar = changedAmount('paid_so_far');
      if (originalDebt !== null || paidSoFar !== null) {
        await this.upsertLiabilityStarts(id, originalDebt, paidSoFar);
      }
    }
  }

  /**
   * Upserts a liability's opening rows ("Initial Debt" outflow, "Prior
   * payments" inflow) with createAccount's semantics: Transfers category,
   * excluded from the budget. Amounts are account-currency milliunits; null
   * or non-positive amounts are skipped. An existing row keeps its date. A
   * missing row is only created while the account has no other transactions,
   * so an account opened with a plain balance never gets a second debt row.
   */
  async upsertLiabilityStarts(
    accountId: number,
    originalDebt: number | null,
    paidSoFar: number | null
  ): Promise<void> {
    const account = this.getAccount(accountId);
    const budgetId = account.BudgetID;
    const transfersCategoryId = ensureCategoryWithGroup(
      this.categoryService,
      budgetId,
      'Transfers',
      'Transfers',
      ''
    );

    const starts = [
      { memo: 'Initial Debt', amount: originalDebt, isInflow: false },
      { memo: 'Prior payments', amount: paidSoFar, isInflow: true },
    ];
    const isStartRow = (memo: string | undefined) =>
      starts.some((s) => s.memo.toLowerCase() === (memo || '').trim().toLowerCase());

    for (const start of starts) {
      if (typeof start.amount !== 'number' || start.amount <= 0) continue;
      const amount = asMilli(start.amount);
      const inflow = start.isInflow ? amount : ZERO_MILLI;
      const outflow = start.isInflow ? ZERO_MILLI : amount;

      const rows = [...this.transactionService.getTransactionsByAccount(accountId)].sort(
        (a, b) => (a.Date || '').localeCompare(b.Date || '') || a.ID - b.ID
      );
      const existing = rows.find(
        (row) => (row.Memo || '').trim().toLowerCase() === start.memo.toLowerCase()
      );

      if (existing) {
        const unchanged =
          (existing.InflowNative ?? existing.InflowConverted) === inflow &&
          (existing.OutflowNative ?? existing.OutflowConverted) === outflow &&
          existing.CategoryID === transfersCategoryId;
        if (!unchanged) {
          await this.transactionService.updateTransaction(
            existing.ID,
            inflow,
            outflow,
            accountId,
            transfersCategoryId,
            existing.Date,
            existing.Memo,
            existing.Payee
          );
        }
        continue;
      }

      if (rows.some((row) => !isStartRow(row.Memo))) continue;
      await this.transactionService.addTransaction(
        inflow,
        outflow,
        accountId,
        transfersCategoryId, // Transfers category - excluded from budget calculations
        budgetId,
        rows[0]?.Date ?? getLocalDateString(),
        start.memo,
        '',
        SYSTEM_PAYEE
      );
    }
  }

  /**
   * SetAccountArchived - Toggles the Archived flag on an account.
   * Archived accounts are hidden from default account lists/pickers but their
   * historical transactions remain visible in reports and transaction lists.
   */
  setAccountArchived(id: number, archived: boolean): void {
    const account = this.getAccount(id); // throws if not
    this.queries.setArchived(id, archived);

    // Returning an account to active use: a system-linked category (CC Payment
    // for credit cards, linked category for loans/mortgages) can be deleted
    // while the account is archived, which leaves a dangling metadata link.
    // Restore it on unarchive so the payment mechanics engage again.
    if (!archived) {
      this.relinkSystemCategories(account);
    }
  }

  /** Parse an account's Metadata field into an object, tolerating bad JSON. */
  private parseAccountMetadata(
    raw: string | Record<string, unknown> | undefined
  ): Record<string, unknown> {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    } catch {
      return {};
    }
  }

  /** True when categoryId refers to a category that still exists in the budget. */
  private categoryExistsInBudget(budgetId: number, categoryId: unknown): boolean {
    return (
      typeof categoryId === 'number' &&
      this.categoryService.getAllCategories(budgetId).some((c) => c.ID === categoryId)
    );
  }

  private isCreditPaymentCategory(budgetId: number, categoryId: unknown): boolean {
    if (typeof categoryId !== 'number') return false;
    const category = this.categoryService
      .getAllCategories(budgetId)
      .find((candidate) => candidate.ID === categoryId);
    return Boolean(
      category &&
      this.categoryService
        .getAllCategoryGroups(budgetId)
        .some(
          (group) => group.ID === category.CategoryGroupID && group.Name === 'Credit Card Payments'
        )
    );
  }

  private paymentCategoryClaimedByAnotherAccount(categoryId: number, accountId?: number): boolean {
    // Archived accounts and accounts temporarily changed to another type retain
    // their category ownership. Include every account, even malformed links from
    // another budget, so one account cannot alter another account's category.
    return allRows<Pick<Account, 'ID' | 'Metadata'>>(
      this.db,
      'SELECT ID, Metadata FROM accounts'
    ).some(
      (account) =>
        account.ID !== accountId &&
        this.parseAccountMetadata(account.Metadata).cc_payment_category_id === categoryId
    );
  }

  private validatePaymentCategoryLink(
    budgetId: number,
    categoryId: unknown,
    accountId?: number
  ): void {
    if (!this.isCreditPaymentCategory(budgetId, categoryId)) {
      throw new Error(
        'Credit card payment category must belong to this budget’s Credit Card Payments group.'
      );
    }
    if (this.paymentCategoryClaimedByAnotherAccount(categoryId as number, accountId)) {
      throw new Error('Credit card payment category is already linked to another account.');
    }
  }

  /**
   * Reattach-or-create: prefer an existing same-named category in the target
   * group (recovers accounts whose metadata link was lost) before creating a
   * fresh one. Payment categories already claimed by other accounts are never
   * reused. Creates the group too if missing.
   */
  private reattachOrCreateCategory(
    budgetId: number,
    groupName: string,
    categoryName: string,
    accountId?: number
  ): number {
    const group = this.categoryService.getCategoryGroupByName(groupName, budgetId);
    let groupId = group?.ID;
    if (!groupId) {
      groupId = this.categoryService.addCategoryGroup(groupName, budgetId);
    } else {
      const existing = this.categoryService
        .getAllCategories(budgetId)
        .find(
          (c) =>
            c.CategoryGroupID === groupId &&
            c.Name === categoryName &&
            (groupName !== 'Credit Card Payments' ||
              !this.paymentCategoryClaimedByAnotherAccount(c.ID, accountId))
        );
      if (existing) return existing.ID;
    }
    return this.categoryService.addCategory(groupId, budgetId, categoryName, '');
  }

  /**
   * Ensures the account's system-linked categories exist and are referenced in
   * metadata: a per-card CC Payment category for credit accounts, a Liabilities
   * linked category for loans/mortgages. Recreates (or reattaches to a same-named
   * category) when the link is missing OR points at a deleted category. No-op for
   * asset accounts. Returns true if metadata was changed.
   */
  private relinkSystemCategories(account: Account): boolean {
    const budgetId = account.BudgetID;
    const metadata = this.parseAccountMetadata(account.Metadata);
    let changed = false;

    if (
      isCreditAccountType(account.Type) &&
      !this.isCreditPaymentCategory(budgetId, metadata.cc_payment_category_id)
    ) {
      metadata.cc_payment_category_id = this.reattachOrCreateCategory(
        budgetId,
        'Credit Card Payments',
        account.Name,
        account.ID
      );
      changed = true;
    }

    if (
      isDebtAccountType(account.Type) &&
      !this.categoryExistsInBudget(budgetId, metadata.linked_category_id)
    ) {
      metadata.linked_category_id = this.reattachOrCreateCategory(
        budgetId,
        'Liabilities',
        account.Name
      );
      changed = true;
    }

    if (changed) {
      this.queries.updateAccountMetadata(account.ID, JSON.stringify(metadata));
    }
    return changed;
  }

  /**
   * ReorderAccounts - Assigns Position by the given order for the supplied
   * account IDs. The on-budget and off-budget groups are ordered independently,
   * so callers pass the IDs of a single group; positions only need to be
   * monotonic within each group because render surfaces partition by
   * on/off-budget before applying Position order.
   */
  reorderAccounts(_budgetId: number, orderedAccountIds: number[]): void {
    const updates = orderedAccountIds.map((id, index) => ({ id, position: index }));
    this.queries.batchUpdateAccountPositions(updates);
  }

  /**
   * DeleteAccount - Deletes an account by ID
   * Also deletes linked category for debt accounts
   */
  deleteAccount(id: number): void {
    // Get the account to check for linked category
    const account = this.queries.getAccount(id);
    let linkedCategoryId: number | undefined;
    let ccPaymentCategoryId: number | undefined;
    let accountName: string | undefined;
    let budgetId: number | undefined;
    let isDebtAccount = false;
    let isCreditCard = false;

    if (account) {
      accountName = account.Name;
      budgetId = account.BudgetID;

      const DEBT_TYPES = ['credit', 'loan', 'mortgage'];
      isDebtAccount = DEBT_TYPES.includes(account.Type?.toLowerCase() || '');
      isCreditCard = account.Type?.toLowerCase() === 'credit';

      try {
        const rawMetadata = account.Metadata;
        const accountMetadata =
          typeof rawMetadata === 'string' ? JSON.parse(rawMetadata || '{}') : rawMetadata || {};
        linkedCategoryId = accountMetadata.linked_category_id;
        ccPaymentCategoryId = accountMetadata.cc_payment_category_id;
      } catch {
        // Metadata parsing failed, will try to find by name below
      }
    }

    const inTransaction = (fn: () => void) =>
      this.db.inTransaction ? fn() : this.db.transaction(fn);
    inTransaction(() => {
      // Delete the account (this will cascade delete transactions via foreign key)
      this.queries.deleteAccount(id);

      // Delete the linked category if it exists (for loans/mortgages)
      if (linkedCategoryId) {
        try {
          this.deleteOwnedCategory(linkedCategoryId, budgetId);
        } catch {
          // Category may have already been deleted or doesn't exist
        }
      } else if (isDebtAccount && !isCreditCard && accountName && budgetId) {
        // Fallback: For debt accounts without linked_category_id in metadata,
        // try to find and delete a category with the same name in Liabilities group
        try {
          const liabilitiesGroup = this.categoryService.getCategoryGroupByName(
            'Liabilities',
            budgetId
          );
          if (liabilitiesGroup) {
            const category = this.categoryService.getCategoryByName(accountName, budgetId);
            if (category && category.CategoryGroupID === liabilitiesGroup.ID) {
              this.deleteOwnedCategory(category.ID, budgetId);
            }
          }
        } catch {
          // Category not found or already deleted
        }
      }

      // Delete the CC Payment category if it exists (for credit cards)
      if (
        ccPaymentCategoryId &&
        budgetId &&
        this.isCreditPaymentCategory(budgetId, ccPaymentCategoryId) &&
        !this.paymentCategoryClaimedByAnotherAccount(ccPaymentCategoryId)
      ) {
        try {
          this.deleteOwnedCategory(ccPaymentCategoryId, budgetId);
        } catch {
          // Category may have already been deleted or doesn't exist
        }
      } else if (!ccPaymentCategoryId && isCreditCard && accountName && budgetId) {
        // Fallback: Try to find and delete a category with the same name in Credit Card Payments group
        try {
          const ccPaymentsGroup = this.categoryService.getCategoryGroupByName(
            'Credit Card Payments',
            budgetId
          );
          if (ccPaymentsGroup) {
            const category = this.categoryService.getCategoryByName(accountName, budgetId);
            if (
              category &&
              category.CategoryGroupID === ccPaymentsGroup.ID &&
              !this.paymentCategoryClaimedByAnotherAccount(category.ID)
            ) {
              this.deleteOwnedCategory(category.ID, budgetId);
            }
          }
        } catch {
          // Category not found or already deleted
        }
      }
    });
  }

  /**
   * deleteAccount, recording exactly what it removed or changed: the account
   * and every row that cascaded with it, its system categories (assignments,
   * goals), rows other accounts held in those categories (moved to
   * Uncategorized), and SET NULL references elsewhere. Returns null instead of
   * a journal when the delete is too large to keep as undo data.
   */
  deleteAccountWithUndo(id: number): RowJournal | null {
    return this.db.transaction(() => {
      const account = this.queries.getAccount(id);
      if (!account) {
        this.deleteAccount(id); // replay of a delete that already happened: no-op
        return null;
      }
      const metadata = this.parseAccountMetadata(account.Metadata);
      const capture = new RowCapture(this.db)
        .watchInserts('category_groups')
        .watchInserts('categories')
        .addKeys('accounts', [id]);
      const owned = [metadata.linked_category_id, metadata.cc_payment_category_id].filter(
        (value): value is number => typeof value === 'number'
      );
      capture.addKeys('categories', owned);
      // deleteAccount's by-name fallback for accounts without metadata links
      capture.addWhere(
        'categories',
        `BudgetID = ? AND Name = ? AND CategoryGroupID IN (
           SELECT ID FROM category_groups
           WHERE BudgetID = ? AND Name IN ('Liabilities', 'Credit Card Payments'))`,
        account.BudgetID,
        account.Name,
        account.BudgetID
      );
      this.deleteAccount(id);
      const journal = capture.finish();
      return journalSize(journal) > ACCOUNT_UNDO_ROW_LIMIT ? null : journal;
    });
  }

  /** Undo of deleteAccountWithUndo. */
  restoreDeletedAccount(journal: RowJournal): void {
    this.db.transaction(() => restoreRowJournal(this.db, journal, ACCOUNT_RESTORE_TABLES));
  }

  /**
   * Delete a category owned by an account being deleted. Other accounts can
   * still hold rows in it — the checking side of loan payments carries the
   * loan's linked category — and the category delete would cascade-delete
   * them from those accounts. They stay (like other transfer legs into the
   * deleted account) and move to Uncategorized first. Runs inside
   * deleteAccount's transaction.
   */
  private deleteOwnedCategory(categoryId: number, budgetId: number | undefined): void {
    this.categoryService.assertCategoryDeletable(categoryId);
    const inUse = getRow<{ Count: number }>(
      this.db,
      `SELECT
         (SELECT COUNT(*) FROM transactions WHERE CategoryID = ?1) +
         (SELECT COUNT(*) FROM transaction_splits WHERE CategoryID = ?1) AS Count`,
      categoryId
    );
    if (budgetId && Number(inUse?.Count) > 0) {
      const uncategorizedId = ensureUncategorizedCategory(this.categoryService, budgetId);
      run(
        this.db,
        'UPDATE transactions SET CategoryID = ? WHERE CategoryID = ?',
        uncategorizedId,
        categoryId
      );
      run(
        this.db,
        'UPDATE transaction_splits SET CategoryID = ? WHERE CategoryID = ?',
        uncategorizedId,
        categoryId
      );
    }
    this.categoryService.deleteCategoryInTransaction(categoryId);
  }
}
