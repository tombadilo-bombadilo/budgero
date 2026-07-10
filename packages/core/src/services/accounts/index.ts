import { DatabaseAdapter } from '../../database/interface.js';
import { asMilli, subMilli, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import {
  Account,
  defaultOnBudgetForType,
  isCreditAccountType,
  isDebtAccountType,
  isLiabilityAccountType,
} from './types.js';
import { AccountQueries } from './queries.js';
import { TransactionService } from '../transactions/index.js';
import { ensureCategoryGroup, ensureCategoryWithGroup } from '../transactions/category-helpers.js';
import { CurrencyService } from '../currency/index.js';
import { CategoryService } from '../categories/index.js';

import { createLogger } from '../../logger.js';
import { getLocalDateString } from '../../utils/date.js';

const debugLog = createLogger('services:accounts');

const SYSTEM_PAYEE = 'Budgero';

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
   */
  async createAccount(
    name: string,
    budgetId: number,
    accType: string,
    currency: string,
    balance: MilliUnits,
    metadata?: Record<string, unknown>,
    onBudget?: boolean
  ): Promise<Account> {
    if (!name.trim()) {
      throw new Error('account name cannot be empty');
    }

    // Determine default on_budget value based on account type if not explicitly set
    let isOnBudget = onBudget;
    if (isOnBudget === undefined) {
      isOnBudget = defaultOnBudgetForType(accType);
    }

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
      isOnBudget
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

    // Create initial transaction depending on account type
    // - Standard accounts: positive initial inflow sets opening balance
    // - Liability accounts (credit/loan/mortgage): record an initial outflow equal to total debt
    //   so the running balance starts negative and payments (inflows) reduce the debt
    const currentDate = getLocalDateString(); // YYYY-MM-DD, user's local calendar day

    // Pre-fetch the rate so the initial-balance transaction can be converted immediately.
    const budget = this.queries.getBudget(budgetId);
    if (budget && currency !== budget.DisplayCurrency && balance !== 0) {
      try {
        const currentMonth = currentDate.substring(0, 7); // YYYY-MM
        debugLog(
          `🔄 Pre-fetching currency rate for ${currency} → ${budget.DisplayCurrency} for account creation`
        );

        const rate = await this.currencyService.getOrFetchRate(
          currency,
          budget.DisplayCurrency,
          currentMonth,
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

    // If liability (but NOT credit card), prepare Liabilities group and per-account linked category
    // Credit cards don't need linked categories because spending is categorized when you use the card,
    // not when you pay the bill. Loans/mortgages DO need linked categories because the payment IS the expense.
    let linkedCategoryId: number | undefined;
    const needsLinkedCategory = isLiability && !isCreditAccountType(accType);

    if (needsLinkedCategory) {
      const liabilitiesGroupId = ensureCategoryGroup(this.categoryService, budgetId, 'Liabilities');

      // Create per-account linked category (e.g., "Home Mortgage")
      // This category will be used for tracking spending when paying down this debt
      linkedCategoryId = this.categoryService.addCategory(
        liabilitiesGroupId,
        budgetId,
        name, // Use account name for the category
        ''
      );

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
      const ccPaymentsGroupId = ensureCategoryGroup(
        this.categoryService,
        budgetId,
        'Credit Card Payments'
      );

      // Create per-card payment category (e.g., "Chase CC")
      ccPaymentCategoryId = this.categoryService.addCategory(
        ccPaymentsGroupId,
        budgetId,
        name, // Use account name for the category
        ''
      );

      const updatedMetadata = {
        ...(metadata || {}),
        cc_payment_category_id: ccPaymentCategoryId,
      };
      this.queries.updateAccountMetadata(accountId, JSON.stringify(updatedMetadata));
    }

    // Handle initial balance for all liability accounts (credit cards, loans, mortgages)
    // Use "Transfers" category so it affects account balance but NOT budget Available
    if (isLiability) {
      // Create initial principal outflow when original debt is provided
      if (initialDebt > 0) {
        await this.transactionService.addTransaction(
          ZERO_MILLI,
          initialDebt,
          accountId,
          transfersCategoryId, // Transfers category - excluded from budget calculations
          budgetId,
          currentDate,
          'Initial Debt',
          '',
          SYSTEM_PAYEE
        );
      }

      // Record prior payments (paid so far) as an inflow so remaining = original - paid
      if (paidSoFar > 0) {
        await this.transactionService.addTransaction(
          paidSoFar,
          ZERO_MILLI,
          accountId,
          transfersCategoryId, // Transfers category - excluded from budget calculations
          budgetId,
          currentDate,
          'Prior payments',
          '',
          SYSTEM_PAYEE
        );
      }

      // Plain opening balance: the caller gave a balance but no debt_total /
      // paid_so_far metadata (e.g. onboarding, where a user types the amount
      // they owe on a card). Honor the SIGNED balance so the account starts
      // where the user said — negative = existing debt (outflow), positive =
      // credit/overpaid (inflow). Transfers category keeps it out of budget
      // Available. Without this, liability accounts silently opened at 0.
      if (initialDebt === 0 && paidSoFar === 0 && balance !== 0) {
        const inflow = balance > 0 ? balance : ZERO_MILLI;
        const outflow = balance < 0 ? subMilli(ZERO_MILLI, balance) : ZERO_MILLI;
        await this.transactionService.addTransaction(
          inflow,
          outflow,
          accountId,
          transfersCategoryId, // Transfers category - excluded from budget calculations
          budgetId,
          currentDate,
          'Initial Balance',
          '',
          SYSTEM_PAYEE
        );
      }
    } else if (balance !== 0) {
      // Standard account initial balance
      await this.transactionService.addTransaction(
        balance, // inflow
        ZERO_MILLI, // outflow
        accountId, // accountId
        incomeCategoryId, // categoryId - Using Income category ID
        budgetId, // budgetId
        currentDate, // date
        'Initial Balance', // memo
        '', // transferId (empty for initial balance)
        SYSTEM_PAYEE
      );
    }

    const account = this.queries.getAccount(accountId);
    if (!account) {
      throw new Error('Failed to retrieve created account');
    }

    return account;
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
    onBudget?: boolean
  ): Promise<void> {
    const originalAccount = this.getAccount(id);

    const finalName = name.trim() || originalAccount.Name;
    const finalAccType = accType.trim() || originalAccount.Type;
    const finalCurrency = currency.trim() || originalAccount.Currency;

    const nameChanged = finalName !== originalAccount.Name;

    if (finalCurrency !== originalAccount.Currency) {
      // Handle currency change before updating
      await this.currencyService.handleAccountCurrencyChange(
        id,
        originalAccount.BudgetID,
        finalCurrency,
        originalAccount.Currency
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
    const SYSTEM_METADATA_KEYS = ['cc_payment_category_id', 'linked_category_id'] as const;
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
        !this.categoryExistsInBudget(budgetId, effectiveMetadata.cc_payment_category_id)
      ) {
        effectiveMetadata = {
          ...effectiveMetadata,
          cc_payment_category_id: this.reattachOrCreateCategory(
            budgetId,
            'Credit Card Payments',
            finalName
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
      if (typeof ccPaymentCategoryId === 'number') {
        this.categoryService.updateCategoryName(ccPaymentCategoryId, finalName);
      }

      this.transactionService.updateTransferMemosForAccountRename(
        originalAccount.BudgetID,
        originalAccount.Name,
        finalName
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
      return typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...(raw || {}) };
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

  /**
   * Reattach-or-create: prefer an existing same-named category in the target
   * group (recovers accounts whose metadata link was lost) before creating a
   * fresh one. Creates the group too if missing.
   */
  private reattachOrCreateCategory(
    budgetId: number,
    groupName: string,
    categoryName: string
  ): number {
    const group = this.categoryService.getCategoryGroupByName(groupName, budgetId);
    let groupId = group?.ID;
    if (!groupId) {
      groupId = this.categoryService.addCategoryGroup(groupName, budgetId);
    } else {
      const existing = this.categoryService
        .getAllCategories(budgetId)
        .find((c) => c.CategoryGroupID === groupId && c.Name === categoryName);
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
      !this.categoryExistsInBudget(budgetId, metadata.cc_payment_category_id)
    ) {
      metadata.cc_payment_category_id = this.reattachOrCreateCategory(
        budgetId,
        'Credit Card Payments',
        account.Name
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

    // Delete the account (this will cascade delete transactions via foreign key)
    this.queries.deleteAccount(id);

    // Delete the linked category if it exists (for loans/mortgages)
    if (linkedCategoryId) {
      try {
        this.categoryService.deleteCategory(linkedCategoryId);
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
            this.categoryService.deleteCategory(category.ID);
          }
        }
      } catch {
        // Category not found or already deleted
      }
    }

    // Delete the CC Payment category if it exists (for credit cards)
    if (ccPaymentCategoryId) {
      try {
        this.categoryService.deleteCategory(ccPaymentCategoryId);
      } catch {
        // Category may have already been deleted or doesn't exist
      }
    } else if (isCreditCard && accountName && budgetId) {
      // Fallback: Try to find and delete a category with the same name in Credit Card Payments group
      try {
        const ccPaymentsGroup = this.categoryService.getCategoryGroupByName(
          'Credit Card Payments',
          budgetId
        );
        if (ccPaymentsGroup) {
          const category = this.categoryService.getCategoryByName(accountName, budgetId);
          if (category && category.CategoryGroupID === ccPaymentsGroup.ID) {
            this.categoryService.deleteCategory(category.ID);
          }
        }
      } catch {
        // Category not found or already deleted
      }
    }
  }
}
