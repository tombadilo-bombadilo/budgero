import { ImportDuplicateService, type ImportIdentity } from '../import/duplicate-planner.js';
import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, run } from '../../database/sql.js';
import {
  Transaction,
  GetTransactionsByAccountRow,
  AccountTransactionPage,
  AccountTransactionPageOptions,
  AccountTransactionSummary,
  AccountBalanceHistoryTransaction,
  GetTransactionsByAccountAndMonthRow,
  GetAllTransactions,
  GetTransactionsByCategoryAndMonthRow,
} from './types.js';
import { NotFoundError, ValidationError } from '../../types';
import { TransactionQueries } from './queries.js';
import { CurrencyService } from '../currency/index.js';
import { CategoryService } from '../categories/index.js';
import { isDebtAccountType } from '../accounts/types.js';
import {
  ensureCategoryGroup,
  ensureTransferCategory,
  ensureUncategorizedCategory,
} from './category-helpers.js';

import { createLogger } from '../../logger.js';
import { asMilli, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import {
  assertValidExchangeRate,
  convertScaled,
  isCryptoCurrency,
} from '../../currencies/index.js';
import { getLocalDateString, parseDateOnlyLocal } from '../../utils/date.js';
import {
  applyTransferRate as applyDirectTransferRate,
  getTransferRateDetails as loadTransferRateDetails,
  type TransferRateDetails,
} from './transfer-rate.js';
import { isAccountOnBudget } from './transfer-payee.js';

export type {
  Transaction,
  GetTransactionsByAccountRow,
  GetTransactionsByAccountAndMonthRow,
  GetAllTransactions,
  GetTransactionsByCategoryAndMonthRow,
  TransactionSplit,
  PayeeListItem,
  LabelListItem,
} from './types.js';
export type { TransferRateDetails } from './transfer-rate.js';
export {
  isAccountOnBudget,
  resolveTransferPayees,
  transferInvolvesOffBudgetAccount,
} from './transfer-payee.js';
const debugLog = createLogger('services:transactions');

/**
 * TransactionService - Port of Go transactions service
 * Handles complex transaction management with running balance calculations
 */
export class TransactionService {
  private queries: TransactionQueries;

  private currencyService: CurrencyService;

  private categoryService: CategoryService;

  constructor(private db: DatabaseAdapter) {
    this.queries = new TransactionQueries(db);
    this.currencyService = new CurrencyService(db);
    this.categoryService = new CategoryService(db);
  }

  private resolvePayee(
    incoming: string | undefined,
    existing: string | null | undefined
  ): string | null {
    if (incoming === undefined) return existing ?? null;
    return incoming.trim() || null;
  }

  private normalizeLabelId(value: number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.floor(parsed);
  }

  private assertLabelBelongsToBudget(labelId: number, budgetId: number): void {
    const label = this.queries.getLabelById(labelId, budgetId);
    if (!label) {
      throw new NotFoundError(`Label '${labelId}' does not exist in budget '${budgetId}'`);
    }
  }

  /**
   * AddTransaction - Creates a new transaction with proper running balance management
   * Now supports multi-currency with automatic conversion
   */
  async addTransaction(
    inflowOriginal: MilliUnits,
    outflowOriginal: MilliUnits,
    accountId: number,
    categoryId: number,
    budgetId: number,
    date: string,
    memo: string,
    transferId = '',
    payee?: string,
    labelId?: number | null,
    exchangeRateOverride?: number | null,
    excludeFromReadyToAssign = false,
    importIdentities: ImportIdentity[] = []
  ): Promise<number> {
    debugLog('🔵 TransactionService.addTransaction called with:', {
      inflowOriginal,
      outflowOriginal,
      accountId,
      categoryId,
      budgetId,
      date,
      memo,
      transferId,
      payee,
      labelId,
      exchangeRateOverride,
    });

    const { account, budget } = this.queries.getAccountAndBudget(accountId, budgetId);

    // Calculate converted amounts (will be same as original if currencies match)
    let inflowConverted: MilliUnits = inflowOriginal;
    let outflowConverted: MilliUnits = outflowOriginal;
    let resolvedExchangeRate: number | null = null;
    const pinnedExchangeRate =
      typeof exchangeRateOverride === 'number' &&
      Number.isFinite(exchangeRateOverride) &&
      exchangeRateOverride > 0
        ? exchangeRateOverride
        : null;
    const usesPinnedExchangeRate =
      pinnedExchangeRate !== null &&
      Boolean(account && budget && account.Currency !== budget.DisplayCurrency);

    if (account && budget && account.Currency !== budget.DisplayCurrency) {
      // Use full resolution chain: custom date-range → official → manual → fallback → 1:1
      let rate =
        pinnedExchangeRate ??
        (await this.currencyService.resolveRate(
          account.Currency,
          budget.DisplayCurrency,
          date,
          budgetId
        ));

      if (!rate) {
        // Crypto never falls back to 1:1 — a BTC transaction converted at
        // parity would corrupt the budget by orders of magnitude.
        if (isCryptoCurrency(account.Currency) || isCryptoCurrency(budget.DisplayCurrency)) {
          throw new ValidationError(
            `No exchange rate available for ${account.Currency} → ${budget.DisplayCurrency}. ` +
              `Add a manual rate or reconnect before recording this transaction.`
          );
        }
        // Fiat: 1:1 placeholder, marked ConversionPending and resynced later.
        rate = 1;
      }

      resolvedExchangeRate = rate;
      inflowConverted = asMilli(
        convertScaled(inflowOriginal, rate || 1, account.Currency, budget.DisplayCurrency)
      );
      outflowConverted = asMilli(
        convertScaled(outflowOriginal, rate || 1, account.Currency, budget.DisplayCurrency)
      );
    }

    // Capture whether we need to mark this row pending (manual/adjacent/1:1)
    let markPending = false;
    if (
      account &&
      budget &&
      account.Currency !== budget.DisplayCurrency &&
      !usesPinnedExchangeRate
    ) {
      const official = await this.currencyService.getLocalRate(
        account.Currency,
        budget.DisplayCurrency,
        date,
        budgetId
      );
      const custom = await this.currencyService.getCustomRate(
        account.Currency,
        budget.DisplayCurrency,
        date,
        budgetId
      );
      const manual = await this.currencyService.getManualRate(
        account.Currency,
        budget.DisplayCurrency,
        budgetId
      );
      markPending = (!official && !custom) || !!manual;
    }

    const normalizedPayeeValue = (() => {
      const trimmed = payee?.trim();
      return trimmed || null;
    })();

    const normalizedLabelId = this.normalizeLabelId(labelId);
    if (normalizedLabelId !== null) {
      this.assertLabelBelongsToBudget(normalizedLabelId, budgetId);
    }

    const transactionId = this.db.transaction(() => {
      const imports = new ImportDuplicateService(this.db);
      const existing =
        importIdentities[0] && imports.findOperation(importIdentities[0].operationId);
      if (existing !== undefined) return existing;
      // Variables for overpayment split handling (need to be in outer scope)
      let needsOverpaymentSplit = false;
      let spendingAmount: MilliUnits = ZERO_MILLI;
      let overpaymentAmount: MilliUnits = ZERO_MILLI;
      let linkedCategoryIdForSplit: number | undefined;
      let transfersCategoryIdForSplit: number | undefined;

      // 1. If transferID is provided, determine the appropriate category
      // Debt account transfers: source side gets linked category (spending), dest side gets Transfers
      // NOTE: Credit cards are NOT included - CC spending is categorized when you use the card,
      // payments to CC are just neutral transfers covering already-categorized expenses.
      if (transferId) {
        const isCurrentDebt = isDebtAccountType(account?.Type);
        const isCurrentOnBudget = account?.OnBudget !== false && Number(account?.OnBudget) !== 0;
        const isCurrentOutflow = outflowOriginal > 0;
        const isCurrentInflow = inflowOriginal > 0;

        debugLog('🔍 Checking transfer categorization:', {
          transferId,
          accountId,
          accountType: account?.Type,
          isCurrentDebt,
          isCurrentOnBudget,
          isCurrentOutflow,
          isCurrentInflow,
        });

        const partner = getRow<{
          AccountID: number;
          TxInflow: number;
          TxOutflow: number;
          Type: string;
          OnBudget: boolean | number;
          BalanceNative: number;
          Metadata: string;
        }>(
          this.db,
          `SELECT t.AccountID, t.InflowConverted as TxInflow, t.OutflowConverted as TxOutflow,
                  a.Type, a.OnBudget, a.BalanceNative, a.Metadata
           FROM transactions t
           JOIN accounts a ON t.AccountID = a.ID
           WHERE t.TransferID = ? AND t.AccountID != ?
           LIMIT 1`,
          transferId,
          accountId
        );

        const isPartnerDebt = partner && isDebtAccountType(partner.Type);
        const isPartnerOnBudget = partner && partner.OnBudget !== false && partner.OnBudget !== 0;

        // Calculate pre-transfer balance (before partner's transaction was applied)
        const partnerPreTransferBalance = partner
          ? partner.BalanceNative - (partner.TxInflow || 0) + (partner.TxOutflow || 0)
          : 0;

        debugLog('🔍 Partner account info:', {
          partnerId: partner?.AccountID,
          partnerType: partner?.Type,
          isPartnerDebt,
          isPartnerOnBudget,
          partnerBalance: partner?.BalanceNative,
          partnerPreTransferBalance,
        });

        // Determine if this is a debt payment scenario:
        // Transfer FROM on-budget non-debt TO on-budget debt
        // All debt types (credit, loan, mortgage) are handled uniformly
        let useDebtCategory = false;
        let linkedCategoryId: number | undefined;
        let debtAccountBalance = 0;

        if (
          isCurrentOutflow &&
          !isCurrentDebt &&
          isCurrentOnBudget &&
          isPartnerDebt &&
          isPartnerOnBudget
        ) {
          // Current is SOURCE (outflow, non-debt) → Partner is DEST (debt)
          // Source side gets linked category from destination's metadata
          useDebtCategory = true;
          // Use PRE-TRANSFER balance to calculate debt owed
          debtAccountBalance = partnerPreTransferBalance;
          try {
            const metadata = JSON.parse(partner?.Metadata || '{}');
            linkedCategoryId = metadata.linked_category_id;
          } catch {
            // Metadata parsing failed
          }

          // Lazy creation: if no linked category exists, create one for the debt account
          if (!linkedCategoryId && partner) {
            linkedCategoryId = this.ensureDebtAccountCategory(partner.AccountID, budgetId);
            debugLog('🆕 Created linked category for debt account:', linkedCategoryId);
          }

          // Calculate spending cap: only count spending up to the debt balance
          // If debt balance is -600 and transfer is 700, only 600 counts as spending
          const transferAmount = outflowOriginal;
          // debtAccountBalance is negative for debt, so abs() gives positive debt amount
          // If balance is positive (overpaid), debt owed is 0
          const debtOwed = debtAccountBalance < 0 ? Math.abs(debtAccountBalance) : 0;
          spendingAmount = asMilli(Math.min(transferAmount, debtOwed));
          overpaymentAmount = asMilli(transferAmount - spendingAmount);

          debugLog(
            `💳 Debt payment calc: balance=${debtAccountBalance}, debtOwed=${debtOwed}, transfer=${transferAmount}, spending=${spendingAmount}, overpay=${overpaymentAmount}`
          );

          if (spendingAmount > 0 && overpaymentAmount > 0) {
            // Overpaying with some debt - need to split transaction after creation
            needsOverpaymentSplit = true;
            linkedCategoryIdForSplit = linkedCategoryId;
            transfersCategoryIdForSplit = ensureTransferCategory(this.categoryService, budgetId);
            debugLog(
              `💰 Overpayment detected: ${transferAmount} transfer, ${spendingAmount} spending (capped at debt), ${overpaymentAmount} excess`
            );
          } else if (spendingAmount === 0) {
            // No debt to pay off (balance is positive) - use Transfers category instead
            useDebtCategory = false;
            debugLog('💳 No debt to pay off (balance >= 0) - using Transfers category');
          }

          debugLog('💳 SOURCE side of debt payment - will use linked category:', linkedCategoryId);
        } else if (
          isCurrentInflow &&
          isCurrentDebt &&
          isCurrentOnBudget &&
          !isPartnerDebt &&
          isPartnerOnBudget
        ) {
          // Current is DEST (inflow, debt) → Partner is SOURCE (non-debt)
          // Destination side gets "Transfers" category
          // Partner (source) should get linked category - update it
          useDebtCategory = false; // This side uses Transfers
          try {
            const metadata = JSON.parse((account?.Metadata as string) || '{}');
            linkedCategoryId = metadata.linked_category_id;
          } catch {
            // Metadata parsing failed
          }

          // Lazy creation: if no linked category exists, create one for this debt account
          if (!linkedCategoryId) {
            linkedCategoryId = this.ensureDebtAccountCategory(accountId, budgetId);
            debugLog('🆕 Created linked category for this debt account:', linkedCategoryId);
          }

          debugLog(
            '💳 DEST side of debt payment - will use Transfers, partner uses linked category:',
            linkedCategoryId
          );

          // Update partner (source) transaction to use linked category if it exists
          if (linkedCategoryId && partner) {
            run(
              this.db,
              `UPDATE transactions
               SET CategoryID = ?
               WHERE TransferID = ? AND AccountID = ?`,
              linkedCategoryId,
              transferId,
              partner.AccountID
            );
            debugLog('📝 Updated source transaction to use linked category');
          }
        }

        const transfersCategoryId = ensureTransferCategory(this.categoryService, budgetId);

        // Determine if user specified a custom category (not the default Transfers category)
        // The user can specify a category for on-budget → off-budget transfers to treat them as spending
        // We detect this by checking if:
        // 1. A valid category was passed (categoryId !== 0)
        // 2. The category is NOT the Transfers category
        // 3. The current account is the on-budget leg of a transfer crossing
        //    the budget boundary. For a source leg the partner may not exist
        //    yet, so the frontend supplies the correct category; an incoming
        //    destination leg can verify that its existing partner is off-budget.
        debugLog('🔍 Category decision debug:', {
          categoryId,
          transfersCategoryId,
          isCurrentOutflow,
          isCurrentOnBudget,
          useDebtCategory,
          linkedCategoryId,
          'categoryId !== 0': categoryId !== 0,
          'categoryId !== transfersCategoryId': categoryId !== transfersCategoryId,
        });

        const userSpecifiedCustomCategory =
          isCurrentOnBudget &&
          !useDebtCategory &&
          categoryId !== 0 &&
          categoryId !== transfersCategoryId &&
          (isCurrentOutflow || (isCurrentInflow && partner && !isPartnerOnBudget));

        if (userSpecifiedCustomCategory) {
          // Keep the user's selected category for off-budget transfers
          debugLog('✅ Keeping user-specified category for off-budget transfer:', categoryId);
        } else if (useDebtCategory && linkedCategoryId) {
          categoryId = linkedCategoryId;
          debugLog('✅ Using linked debt category for source side:', categoryId);
        } else {
          categoryId = transfersCategoryId;
          debugLog('📁 Using regular "Transfers" category');
        }
      }

      // No category specified (id 0) — fall back to "Uncategorized", creating it lazily.
      // Budgets created before it became a default don't have it, and the frontend resolves
      // category names to 0 when no match is found (e.g. split parents).
      if (!categoryId) {
        categoryId = ensureUncategorizedCategory(this.categoryService, budgetId);
      }

      // 2. Validate the category exists
      try {
        this.categoryService.getCategory(categoryId);
      } catch {
        throw new NotFoundError(`Category '${categoryId}' does not exist`);
      }

      // 3. Get previous running balances (both original and converted).
      // Plain transactions normally append at the newest ledger position. In that
      // common case the latest row supplies both balances and there are no future
      // rows to update. Keep the established transfer path unchanged.
      let plainAppendOnly = false;
      let prevBalanceConverted: number;
      let prevBalanceOriginal: number;
      if (!transferId) {
        const latest = this.queries.getLatestRunningBalances(accountId);
        plainAppendOnly = latest === null || latest.Date <= date;
        const previous = plainAppendOnly
          ? latest
          : this.queries.getRunningBalancesBefore(accountId, date);
        prevBalanceConverted = previous?.RunningBalanceConverted ?? 0;
        prevBalanceOriginal = previous?.RunningBalanceNative ?? 0;
      } else {
        prevBalanceConverted = this.queries.getRunningBalanceBefore(accountId, date) || 0;
        prevBalanceOriginal = this.queries.getRunningBalanceOriginalBefore(accountId, date) || 0;
      }

      // 4. Compute new balances
      const deltaConverted = inflowConverted - outflowConverted;
      const deltaOriginal = inflowOriginal - outflowOriginal;
      const newBalanceConverted = prevBalanceConverted + deltaConverted;
      const newBalanceOriginal = prevBalanceOriginal + deltaOriginal;

      // Ensure payee is saved for directory/combobox use
      if (normalizedPayeeValue) {
        this.queries.insertPayee(budgetId, normalizedPayeeValue);
      }

      // 5. Insert the transaction with all amounts and balances
      const id = this.queries.insertTransactionWithBalance(
        inflowConverted,
        outflowConverted,
        inflowOriginal,
        outflowOriginal,
        categoryId,
        accountId,
        date,
        memo,
        normalizedPayeeValue,
        budgetId,
        newBalanceConverted,
        newBalanceOriginal,
        transferId || null,
        resolvedExchangeRate,
        normalizedLabelId,
        usesPinnedExchangeRate,
        excludeFromReadyToAssign
      );

      // If rate was manual/adjacent/1:1, mark pending for later recalc
      if (markPending) this.queries.setConversionPending(id, true);

      // 6. Bump future balances (both converted and original). A newest plain
      // transaction has no future rows; backdated plain adds update both balance
      // columns in one scan. Transfers retain their established behavior.
      if (!transferId) {
        if (!plainAppendOnly) {
          this.queries.bumpFutureBalancesCombined(
            accountId,
            date,
            id,
            deltaConverted,
            deltaOriginal
          );
        }
      } else {
        this.queries.bumpFutureBalances(accountId, date, id, deltaConverted);
        this.queries.bumpFutureBalancesOriginal(accountId, date, id, deltaOriginal);
      }

      // 7. Update account-level balance (both original and converted)
      this.queries.updateAccountBalance(
        accountId,
        inflowOriginal,
        outflowOriginal,
        inflowConverted,
        outflowConverted
      );

      // 8. Handle overpayment splits for debt payments
      // If paying more than the debt balance, split into: spending (capped) + excess (Transfers)
      if (needsOverpaymentSplit && linkedCategoryIdForSplit && transfersCategoryIdForSplit) {
        debugLog(
          `📊 Creating overpayment splits: ${spendingAmount} to debt category, ${overpaymentAmount} to Transfers`
        );

        // Delete any existing splits (shouldn't be any, but be safe)
        this.queries.deleteSplitsForTransaction(id);

        // Split 1: Spending amount to linked debt category
        if (spendingAmount > 0) {
          this.queries.insertSplitLine({
            TransactionID: id,
            CategoryID: linkedCategoryIdForSplit,
            Memo: 'Debt payment',
            InflowConverted: ZERO_MILLI,
            OutflowConverted: spendingAmount,
            InflowNative: ZERO_MILLI,
            OutflowNative: spendingAmount,
            OrderIndex: 0,
          });
        }

        // Split 2: Overpayment amount to Transfers category
        this.queries.insertSplitLine({
          TransactionID: id,
          CategoryID: transfersCategoryIdForSplit,
          Memo: 'Overpayment',
          InflowConverted: ZERO_MILLI,
          OutflowConverted: overpaymentAmount,
          InflowNative: ZERO_MILLI,
          OutflowNative: overpaymentAmount,
          OrderIndex: 1,
        });

        debugLog('✅ Created overpayment splits');
      }

      for (const identity of importIdentities) imports.record(id, identity);
      debugLog('✅ Transaction added successfully with ID:', id);
      return id;
    });
    if (transferId) this.normalizeTransferPayees(transferId);
    return transactionId;
  }

  /**
   * GetAllTransactions - Gets all transactions for a budget
   */
  getAllTransactions(budgetId: number, limit?: number): GetAllTransactions[] {
    return this.queries.getAllTransactions(budgetId, limit);
  }

  /**
   * GetAllTransactionsDetailed - Gets all transactions for a budget with full details
   * Returns same format as getTransactionsByAccount but includes Account field for all accounts
   */
  getAllTransactionsDetailed(budgetId: number): GetTransactionsByAccountRow[] {
    return this.queries.getAllTransactionsDetailed(budgetId);
  }

  /**
   * GetAllTransactionsAnalytics - Budget-wide rows with split parents expanded
   * into their split lines; for aggregation views, not registers
   */
  getAllTransactionsAnalytics(budgetId: number): GetTransactionsByAccountRow[] {
    return this.queries.getAllTransactionsAnalytics(budgetId);
  }

  /**
   * GetTransactionsByAccount - Gets transactions for a specific account
   */
  getTransactionsByAccount(accountId: number): GetTransactionsByAccountRow[] {
    return this.queries.getTransactionsByAccount(accountId);
  }

  getTransactionsByAccountPage(
    accountId: number,
    options: AccountTransactionPageOptions = {}
  ): AccountTransactionPage {
    return this.queries.getTransactionsByAccountPage(accountId, options);
  }

  getTransactionsByAccountRange(
    accountId: number,
    fromDate?: string,
    toDate?: string
  ): GetTransactionsByAccountRow[] {
    return this.queries.getTransactionsByAccountRange(accountId, fromDate, toDate);
  }

  getAccountTransactionSummary(
    accountId: number,
    fromDate?: string,
    toDate?: string
  ): AccountTransactionSummary {
    return this.queries.getAccountTransactionSummary(accountId, fromDate, toDate);
  }

  getAccountBalanceHistory(
    accountId: number,
    fromDate: string,
    toDate: string
  ): AccountBalanceHistoryTransaction[] {
    return this.queries.getAccountBalanceHistory(accountId, fromDate, toDate);
  }

  getTransactionForAccountRegister(id: number): GetTransactionsByAccountRow {
    const transaction = this.queries.getTransactionForAccountRegister(id);
    if (!transaction) {
      throw new NotFoundError('Transaction', id);
    }
    return transaction;
  }

  /**
   * GetTransactionsByAccountAndMonth - Gets transactions for an account in a specific month
   */
  getTransactionsByAccountAndMonth(
    accountId: number,
    month: string
  ): GetTransactionsByAccountAndMonthRow[] {
    return this.queries.getTransactionsByAccountAndMonth(accountId, month);
  }

  /**
   * GetTransactionsByCategory - Gets all transactions for a category
   */
  getTransactionsByCategory(categoryId: number): Transaction[] {
    return this.queries.getTransactionsByCategory(categoryId);
  }

  /**
   * GetTransactionByID - Gets a specific transaction by ID
   */
  getTransactionByID(id: number): Transaction {
    const transaction = this.queries.getTransactionByID(id);
    if (!transaction) {
      throw new NotFoundError('Transaction', id);
    }
    return transaction;
  }

  /** Update non-balance fields without entering the full balance-recalculation path. */
  updatePlainTransactionMetadata(
    id: number,
    categoryId: number,
    memo: string,
    payee?: string
  ): void {
    const transaction = this.getTransactionByID(id);
    if (transaction.TransferID) {
      throw new ValidationError('Plain transaction metadata updates cannot modify transfers');
    }

    const normalizedPayee = this.resolvePayee(payee, transaction.Payee);
    this.db.transaction(() => {
      this.queries.recategorizeTransaction(id, categoryId);
      this.queries.updateTransactionMemo(id, memo);
      this.queries.updateTransactionPayee(id, normalizedPayee);
    });
  }

  /**
   * UpdateTransaction - Updates a transaction with proper balance recalculation
   * Now supports multi-currency with automatic conversion
   */
  async updateTransaction(
    id: number,
    inflow: MilliUnits,
    outflow: MilliUnits,
    accountId: number,
    categoryId: number,
    date: string,
    memo: string,
    payee?: string
  ): Promise<void> {
    const transaction = this.getTransactionByID(id);
    const budgetId = transaction.BudgetID;

    const { account, budget } = this.queries.getAccountAndBudget(accountId, budgetId);

    const inflowOriginal = inflow;
    const outflowOriginal = outflow;

    if (account && budget && account.Currency !== budget.DisplayCurrency) {
      const rate = await this.currencyService.getOrFetchRate(
        account.Currency,
        budget.DisplayCurrency,
        date,
        budgetId
      );

      if (!rate) {
        console.warn(
          `No exchange rate available for ${account.Currency} → ${budget.DisplayCurrency} on ${date}`
        );
      }

      inflow = await this.currencyService.convertAmount(
        inflow,
        account.Currency,
        budget.DisplayCurrency,
        date,
        budgetId
      );

      outflow = await this.currencyService.convertAmount(
        outflow,
        account.Currency,
        budget.DisplayCurrency,
        date,
        budgetId
      );
    }

    // No pending-flag handling in updateTransaction; pending recalculation is tracked on add/move flows

    const normalizedPayee = this.resolvePayee(payee, transaction.Payee);

    this.db.transaction(() => {
      // 1. Fetch original transaction
      const oldTxn = this.getTransactionByID(id);

      // 2. Calculate deltas (using converted amounts)
      const oldDelta = oldTxn.InflowConverted - oldTxn.OutflowConverted;
      const newDelta = inflow - outflow;
      const delta = newDelta - oldDelta;

      // 3. Update transaction fields with both original and converted amounts
      this.queries.updateTransaction(
        id,
        inflow,
        outflow,
        inflowOriginal,
        outflowOriginal,
        categoryId,
        accountId,
        date,
        memo,
        normalizedPayee
      );

      // 4. Recalculate current row's running balance
      const rbBefore = this.queries.getRunningBalanceBefore(accountId, date, id) || 0;
      const newRunningBalance = rbBefore + newDelta;

      // 5. Set new balance for this transaction
      this.queries.updateRunningBalance(id, newRunningBalance);

      // 6. Bump future balances
      this.queries.bumpFutureBalances(accountId, date, id, delta);

      // 7. Update account-level balance (both original and converted)
      this.queries.updateAccountBalance(
        accountId,
        inflowOriginal - (oldTxn.InflowNative ?? oldTxn.InflowConverted ?? 0),
        outflowOriginal - (oldTxn.OutflowNative ?? oldTxn.OutflowConverted ?? 0),
        inflow - (oldTxn.InflowConverted ?? 0),
        outflow - (oldTxn.OutflowConverted ?? 0)
      );
    });

    // Recalculate balances to ensure both converted and original running balances are consistent
    this.queries.recalculateBalances(accountId);

    await this.syncTransferPartnerAmounts(id);
  }

  /** Apply a Push API patch in account currency, committing all fields together. */
  async updatePushedTransaction(id: number, fields: Record<string, unknown>): Promise<string[]> {
    const allowed = ['inflow', 'outflow', 'date', 'memo', 'payee', 'categoryId', 'accountId'];
    const keys = Object.keys(fields);
    if (!keys.length || keys.some((key) => !allowed.includes(key))) {
      throw new ValidationError(
        `"fields" must set at least one of: ${allowed.join(', ')}; unknown fields are not allowed.`
      );
    }
    const previous = this.getTransactionByID(id);
    const structural = keys.some((key) => !['memo', 'payee'].includes(key));
    if (previous.TransferID || (structural && this.queries.getSplitsForTransaction(id).length)) {
      throw new ValidationError(
        'Transfer transactions cannot be patched; split transactions only support memo and payee.'
      );
    }
    const amount = (key: string, fallback: number) => {
      const value = fields[key] === undefined ? fallback : fields[key];
      if (typeof value !== 'number' || value < 0)
        throw new ValidationError(`${key} must be non-negative integer milliunits.`);
      return asMilli(value);
    };
    const inflow = amount('inflow', previous.InflowNative ?? previous.InflowConverted);
    const outflow = amount('outflow', previous.OutflowNative ?? previous.OutflowConverted);
    if (structural && ((inflow > 0 && outflow > 0) || (inflow === 0 && outflow === 0))) {
      throw new ValidationError('Exactly one of inflow or outflow must be non-zero.');
    }
    const identifier = (key: string, fallback: number) => {
      const value = fields[key] === undefined ? fallback : fields[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new ValidationError(`${key} must be a positive integer.`);
      }
      return value;
    };
    const accountId = identifier('accountId', previous.AccountID);
    const categoryId = identifier('categoryId', previous.CategoryID);
    const { account, budget } = this.queries.getAccountAndBudget(accountId, previous.BudgetID);
    if (!account || !budget || account.BudgetID !== previous.BudgetID) {
      throw new ValidationError('Account must belong to the transaction budget.');
    }
    if (this.categoryService.getCategory(categoryId).BudgetID !== previous.BudgetID) {
      throw new ValidationError('Category must belong to the transaction budget.');
    }
    const date = fields.date === undefined ? previous.Date : fields.date;
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      getLocalDateString(parseDateOnlyLocal(date)!) !== date
    ) {
      throw new ValidationError('date must be a valid YYYY-MM-DD date.');
    }
    if (fields.memo !== undefined && typeof fields.memo !== 'string')
      throw new ValidationError('memo must be a string.');
    if (fields.payee !== undefined && fields.payee !== null && typeof fields.payee !== 'string')
      throw new ValidationError('payee must be a string or null.');
    const memo = fields.memo === undefined ? (previous.Memo ?? '') : (fields.memo as string);
    const payee =
      fields.payee === undefined ? previous.Payee : (fields.payee as string | null)?.trim() || null;
    let inflowConverted = previous.InflowConverted;
    let outflowConverted = previous.OutflowConverted;
    let rate = previous.ExchangeRate;
    let pinned = previous.ExchangeRateOverride;
    const reprice = keys.some((key) => ['inflow', 'outflow', 'accountId', 'date'].includes(key));
    if (reprice) {
      if (account.Currency === budget.DisplayCurrency) {
        rate = 1;
        pinned = false;
      } else if (!(pinned && rate && accountId === previous.AccountID && date === previous.Date)) {
        rate = await this.currencyService.resolveRate(
          account.Currency,
          budget.DisplayCurrency,
          date,
          previous.BudgetID
        );
        pinned = false;
        if (!rate) throw new ValidationError('No exchange rate available for this update.');
      }
      inflowConverted = asMilli(
        convertScaled(inflow, rate || 1, account.Currency, budget.DisplayCurrency)
      );
      outflowConverted = asMilli(
        convertScaled(outflow, rate || 1, account.Currency, budget.DisplayCurrency)
      );
    }
    this.db.transaction(() => {
      this.queries.updateTransactionWithOriginal(
        id,
        inflow,
        outflow,
        inflowConverted,
        outflowConverted,
        categoryId,
        accountId,
        date,
        memo,
        payee ?? null
      );
      if (reprice && rate) this.queries.setExchangeRate(id, rate, Boolean(pinned));
      if (payee) this.queries.insertPayee(previous.BudgetID, payee);
      this.queries.recalculateBalancesForAccounts([...new Set([previous.AccountID, accountId])]);
    });
    return keys;
  }

  /**
   * DeleteTransaction - Deletes a transaction with proper balance cleanup
   * If the transaction is part of a transfer, deletes both sides automatically
   */
  deleteTransaction(id: number): void {
    this.db.transaction(() => {
      // 1. Fetch original transaction
      const txn = this.getTransactionByID(id);

      // 2. Check if this is a transfer and find the partner transaction(s)
      let partnerTransactions: Transaction[] = [];
      if (txn.TransferID) {
        debugLog(`🔄 Deleting transfer ${txn.TransferID} - finding partner transactions`);
        partnerTransactions = this.queries
          .getTransactionsByTransferID(txn.TransferID)
          .filter((t) => t.ID !== id);
        debugLog(`Found ${partnerTransactions.length} partner transaction(s) to delete`);
      }

      if (
        !txn.TransferID &&
        this.queries.getSplitsForTransaction(id).some((line) => line.TransferAccountID)
      ) {
        partnerTransactions = this.queries.getTransactionsByTransferID(
          `split_transfer_${txn.ID}_${txn.Date}`
        );
      }

      // 3. Delete the main transaction
      this.queries.deleteTransaction(id);

      // 4. Bump future balances negatively for main transaction (both converted and original)
      const deltaConverted = -(txn.InflowConverted - txn.OutflowConverted);
      const deltaOriginal = -(
        (txn.InflowNative ?? txn.InflowConverted ?? 0) -
        (txn.OutflowNative ?? txn.OutflowConverted ?? 0)
      );

      this.queries.bumpFutureBalances(txn.AccountID, txn.Date, txn.ID, deltaConverted);
      this.queries.bumpFutureBalancesOriginal(txn.AccountID, txn.Date, txn.ID, deltaOriginal);

      // 5. Update account balance for main transaction (both original and converted)
      // When deleting: subtract previous inflows, add back previous outflows
      // We pass outflow as inflow (to add it back) and inflow as outflow (to subtract it)
      this.queries.updateAccountBalance(
        txn.AccountID,
        txn.OutflowNative ?? txn.OutflowConverted ?? 0, // Add back the outflow (pass as inflow param)
        txn.InflowNative ?? txn.InflowConverted ?? 0, // Subtract the inflow (pass as outflow param)
        txn.OutflowConverted ?? 0, // Add back the outflow converted
        txn.InflowConverted ?? 0 // Subtract the inflow converted
      );

      // 6. Delete partner transactions if this was a transfer
      for (const partner of partnerTransactions) {
        debugLog(`🗑️ Deleting partner transaction ${partner.ID} in account ${partner.AccountID}`);

        this.queries.deleteTransaction(partner.ID);

        const partnerDeltaConverted = -(partner.InflowConverted - partner.OutflowConverted);
        const partnerDeltaOriginal = -(
          (partner.InflowNative ?? partner.InflowConverted ?? 0) -
          (partner.OutflowNative ?? partner.OutflowConverted ?? 0)
        );

        this.queries.bumpFutureBalances(
          partner.AccountID,
          partner.Date,
          partner.ID,
          partnerDeltaConverted
        );
        this.queries.bumpFutureBalancesOriginal(
          partner.AccountID,
          partner.Date,
          partner.ID,
          partnerDeltaOriginal
        );

        this.queries.updateAccountBalance(
          partner.AccountID,
          partner.OutflowNative ?? partner.OutflowConverted ?? 0,
          partner.InflowNative ?? partner.InflowConverted ?? 0,
          partner.OutflowConverted ?? 0,
          partner.InflowConverted ?? 0
        );
      }

      if (partnerTransactions.length > 0) {
        debugLog(
          `✅ Deleted transfer ${txn.TransferID} - removed ${partnerTransactions.length + 1} total transactions`
        );
      }

      // If the account has no remaining transactions, recalculate to get a clean zero balance
      // (avoids floating point drift from incremental delta updates)
      const accountIds = new Set([txn.AccountID, ...partnerTransactions.map((p) => p.AccountID)]);
      for (const accountId of accountIds) {
        const remaining = this.queries.getTransactionsByAccount(accountId);
        if (remaining.length === 0) {
          this.queries.recalculateBalances(accountId);
        }
      }
    });
  }

  /**
   * Resolve selected transactions and any transfer counterparts that must be
   * deleted with them. Exposed so mutation undo can capture the same set.
   */
  getTransactionsForDelete(ids: number[]): Transaction[] {
    const selected = this.queries.getTransactionsByIDs(ids);
    const transferIds = selected
      .map(
        (transaction) =>
          transaction.TransferID ||
          (this.queries
            .getSplitsForTransaction(transaction.ID)
            .some((line) => line.TransferAccountID)
            ? `split_transfer_${transaction.ID}_${transaction.Date}`
            : undefined)
      )
      .filter((transferId): transferId is string => Boolean(transferId));
    const transferTransactions = this.queries.getTransactionsByTransferIDs(transferIds);

    return [
      ...new Map([...selected, ...transferTransactions].map((item) => [item.ID, item])).values(),
    ];
  }

  /**
   * Delete a selection atomically, expanding transfer pairs once and
   * recalculating each affected account once.
   */
  deleteTransactions(ids: number[]): void {
    const transactions = this.getTransactionsForDelete(ids);
    if (transactions.length === 0) return;

    const transactionIds = transactions.map((transaction) => transaction.ID);
    const accountIds = [...new Set(transactions.map((transaction) => transaction.AccountID))];

    this.db.transaction(() => {
      this.queries.deleteTransactions(transactionIds);
      this.queries.recalculateBalancesForAccounts(accountIds);
    });
  }

  /**
   * MoveTransactionToNewAccount - Moves a transaction between accounts with balance recalculation
   * Note: This may require re-conversion if the new account has a different currency
   */
  async moveTransactionToNewAccount(transactionId: number, newAccountId: number): Promise<void> {
    const tx = this.getTransactionByID(transactionId);

    const { account: newAccount, budget } = this.queries.getAccountAndBudget(
      newAccountId,
      tx.BudgetID
    );
    const { account: oldAccount } = this.queries.getAccountAndBudget(tx.AccountID, tx.BudgetID);

    let needsRecalculation = false;
    let newInflowConverted = tx.InflowConverted ?? 0;
    let newOutflowConverted = tx.OutflowConverted ?? 0;
    // New originals in target account currency
    let newInflowOriginal = tx.InflowNative ?? tx.InflowConverted ?? 0;
    let newOutflowOriginal = tx.OutflowNative ?? tx.OutflowConverted ?? 0;

    if (newAccount && oldAccount && budget) {
      needsRecalculation = newAccount.Currency !== oldAccount.Currency;

      if (needsRecalculation) {
        // Determine old originals reliably (fall back by back-calculating from converted if needed)
        let oldInflowOriginal = tx.InflowNative;
        let oldOutflowOriginal = tx.OutflowNative;
        if (oldInflowOriginal == null && (tx.InflowConverted ?? 0) !== 0) {
          // convert from budget to old account currency
          oldInflowOriginal = await this.currencyService.convertAmount(
            tx.InflowConverted,
            budget.DisplayCurrency,
            oldAccount.Currency,
            tx.Date,
            tx.BudgetID
          );
        }
        if (oldOutflowOriginal == null && (tx.OutflowConverted ?? 0) !== 0) {
          oldOutflowOriginal = await this.currencyService.convertAmount(
            tx.OutflowConverted,
            budget.DisplayCurrency,
            oldAccount.Currency,
            tx.Date,
            tx.BudgetID
          );
        }

        // Compute new originals in target account currency
        newInflowOriginal = await this.currencyService.convertAmount(
          oldInflowOriginal ?? ZERO_MILLI,
          oldAccount.Currency,
          newAccount.Currency,
          tx.Date,
          tx.BudgetID
        );
        newOutflowOriginal = await this.currencyService.convertAmount(
          oldOutflowOriginal ?? ZERO_MILLI,
          oldAccount.Currency,
          newAccount.Currency,
          tx.Date,
          tx.BudgetID
        );

        // Now compute converted (budget currency) using target account currency
        if (newAccount.Currency !== budget.DisplayCurrency) {
          newInflowConverted = await this.currencyService.convertAmount(
            newInflowOriginal,
            newAccount.Currency,
            budget.DisplayCurrency,
            tx.Date,
            tx.BudgetID
          );
          newOutflowConverted = await this.currencyService.convertAmount(
            newOutflowOriginal,
            newAccount.Currency,
            budget.DisplayCurrency,
            tx.Date,
            tx.BudgetID
          );
        } else {
          // Target account in budget currency: converted equals originals
          newInflowConverted = newInflowOriginal;
          newOutflowConverted = newOutflowOriginal;
        }
      } else if (newAccount.Currency === budget.DisplayCurrency) {
        // No recalculation needed, and target is budget currency → converted equals originals
        newInflowConverted = tx.InflowNative ?? tx.InflowConverted ?? 0;
        newOutflowConverted = tx.OutflowNative ?? tx.OutflowConverted ?? 0;
        newInflowOriginal = tx.InflowNative ?? tx.InflowConverted ?? 0;
        newOutflowOriginal = tx.OutflowNative ?? tx.OutflowConverted ?? 0;
      }
    }

    // Compute pending flag for this move based on availability of official/manual rates
    let markPendingMove = false;
    if (needsRecalculation && newAccount && oldAccount && budget) {
      const officialOldToNew = await this.currencyService.getLocalRate(
        oldAccount.Currency,
        newAccount.Currency,
        tx.Date,
        tx.BudgetID
      );
      const manualOldToNew = await this.currencyService.getManualRate(
        oldAccount.Currency,
        newAccount.Currency,
        tx.BudgetID
      );
      const officialNewToBudget = await this.currencyService.getLocalRate(
        newAccount.Currency,
        budget.DisplayCurrency,
        tx.Date,
        tx.BudgetID
      );
      const manualNewToBudget = await this.currencyService.getManualRate(
        newAccount.Currency,
        budget.DisplayCurrency,
        tx.BudgetID
      );
      markPendingMove =
        !officialOldToNew || !!manualOldToNew || !officialNewToBudget || !!manualNewToBudget;
    }

    this.db.transaction(() => {
      const oldAccountId = tx.AccountID;
      const deltaConverted = tx.InflowConverted - tx.OutflowConverted;
      const oldDeltaOriginal =
        (tx.InflowNative ?? tx.InflowConverted ?? 0) -
        (tx.OutflowNative ?? tx.OutflowConverted ?? 0);

      // 2. Remove delta from old account's future balances (both converted and original)
      this.queries.bumpFutureBalances(oldAccountId, tx.Date, tx.ID, -deltaConverted);
      this.queries.bumpFutureBalancesOriginal(oldAccountId, tx.Date, tx.ID, -oldDeltaOriginal);

      // 3. Move transaction to new account (and update converted amounts if needed)
      if (needsRecalculation) {
        this.queries.updateTransaction(
          transactionId,
          newInflowConverted,
          newOutflowConverted,
          newInflowOriginal,
          newOutflowOriginal,
          tx.CategoryID,
          newAccountId,
          tx.Date,
          tx.Memo,
          tx.Payee ?? null
        );
      } else {
        this.queries.moveTransactionToAccount(transactionId, newAccountId);
      }

      // 4. Recalculate new running balances in the new account
      const prevBalanceConverted =
        this.queries.getRunningBalanceBefore(newAccountId, tx.Date, tx.ID) || 0;
      const prevBalanceOriginal =
        this.queries.getRunningBalanceOriginalBefore(newAccountId, tx.Date, tx.ID) || 0;

      const newDeltaConverted = newInflowConverted - newOutflowConverted;
      const newRunningBalanceConverted = prevBalanceConverted + newDeltaConverted;
      const newDeltaOriginal = newInflowOriginal - newOutflowOriginal;
      const newRunningBalanceOriginal = prevBalanceOriginal + newDeltaOriginal;

      // 5. Update the moved transaction's running balances
      this.queries.updateRunningBalance(tx.ID, newRunningBalanceConverted);
      this.queries.updateRunningBalanceOriginal(tx.ID, newRunningBalanceOriginal);

      // 6. Bump future balances in new account
      this.queries.bumpFutureBalances(newAccountId, tx.Date, tx.ID, newDeltaConverted);
      this.queries.bumpFutureBalancesOriginal(newAccountId, tx.Date, tx.ID, newDeltaOriginal);

      // 7. Update account balances (both original and converted)
      this.queries.updateAccountBalance(
        oldAccountId,
        -Number(tx.InflowNative ?? tx.InflowConverted ?? 0),
        -Number(tx.OutflowNative ?? tx.OutflowConverted ?? 0),
        -Number(tx.InflowConverted ?? 0),
        -Number(tx.OutflowConverted ?? 0)
      );
      this.queries.updateAccountBalance(
        newAccountId,
        newInflowOriginal,
        newOutflowOriginal,
        newInflowConverted,
        newOutflowConverted
      );

      if (markPendingMove) this.queries.setConversionPending(tx.ID, true);
    });

    await this.syncTransferPartnerAmounts(transactionId);
  }

  /**
   * MoveTransactionToNewCategory - Changes the category of a transaction
   */
  moveTransactionToNewCategory(transactionId: number, categoryId: number): void {
    const transaction = this.getTransactionByID(transactionId);
    if (transaction.TransferID) {
      const group = this.getTransactionsByTransferID(transaction.TransferID);
      if (group.length === 2) {
        this.queries.recategorizeTransfer(transaction.TransferID, categoryId);
        return;
      }
    }
    this.queries.recategorizeTransaction(transactionId, categoryId);
  }

  /**
   * ReassignTransactions - Moves all transactions from one category to another
   */
  reassignTransactions(newCategoryId: number, oldCategoryId: number): void {
    const categories = new CategoryService(this.db);
    const source = categories.getCategory(oldCategoryId);
    const destination = categories.getCategory(newCategoryId);
    if (source.BudgetID !== destination.BudgetID) {
      throw new ValidationError('Both categories must belong to the same budget');
    }
    this.queries.reassignTransactionCategories(newCategoryId, oldCategoryId);
  }

  /**
   * GetTransactionsByTransferID - Gets transactions by transfer ID
   */
  getTransactionsByTransferID(transferId: string): Transaction[] {
    return this.queries.getTransactionsByTransferID(transferId);
  }

  getTransferRateDetails(transferId: string): TransferRateDetails | null {
    return loadTransferRateDetails(this.db, transferId);
  }

  /** Enforce that a linked transfer entirely inside the budget has no payee. */
  normalizeTransferPayees(transferId: string): void {
    const linked = this.getTransactionsByTransferID(transferId);
    if (linked.length < 2) return;
    const internal = linked.every((leg) => {
      const { account } = this.queries.getAccountAndBudget(leg.AccountID, leg.BudgetID);
      return account ? isAccountOnBudget(account) : false;
    });
    if (!internal) return;
    this.db.transaction(() => {
      for (const leg of linked) this.queries.updateTransactionPayee(leg.ID, null);
    });
  }

  async updateTransferRate(
    transferId: string,
    rate: number,
    transferRateOverride = true,
    sourceRateOverride?: boolean,
    destinationRateOverride?: boolean
  ): Promise<TransferRateDetails> {
    const current = loadTransferRateDetails(this.db, transferId);
    if (!current) throw new ValidationError('A transfer rate requires exactly two linked legs');

    return applyDirectTransferRate(
      this.db,
      transferId,
      rate,
      (fromCurrency, toCurrency, date, budgetId) =>
        this.currencyService.resolveRate(fromCurrency, toCurrency, date, budgetId),
      {
        sourceOverride: sourceRateOverride ?? current.source.rateOverride,
        destinationOverride: destinationRateOverride ?? current.destination.rateOverride,
        transferOverride: transferRateOverride,
        refreshBudgetRates: true,
      }
    );
  }

  /**
   * Synchronize the partner amount for a transfer (two-leg transfers only).
   * - Partner converted amounts are mirrored (inflow <-> outflow) in budget currency.
   * - Partner originals are recalculated using the partner leg's own date and account currency.
   * - Date, memo, payee, and label remain specific to each leg. Category
   *   edits are synchronized separately by moveTransactionToNewCategory.
   * - Recalculates partner account balances to keep running balances consistent.
   * Skips if there are not exactly two transactions for the TransferID (e.g., split mirrors).
   */
  private async syncTransferPartnerAmounts(transactionId: number): Promise<void> {
    let main: Transaction;
    try {
      main = this.getTransactionByID(transactionId);
    } catch {
      return; // Nothing to sync
    }

    if (!main.TransferID) return;
    const group = this.getTransactionsByTransferID(main.TransferID);
    // Only sync simple two-leg transfers; avoid split-transfer groups
    if (!group || group.length !== 2) return;
    const partner = group.find((t) => t.ID !== main.ID);
    if (!partner) return;

    const { account: mainAcc } = this.queries.getAccountAndBudget(main.AccountID, main.BudgetID);
    const { account: partnerAcc, budget } = this.queries.getAccountAndBudget(
      partner.AccountID,
      main.BudgetID
    );
    if (!mainAcc) return;
    if (!partnerAcc) return;
    if (!budget) return;
    const internalOnBudgetTransfer = isAccountOnBudget(mainAcc) && isAccountOnBudget(partnerAcc);

    // Mirror converted (budget) amounts: partner inflow = main outflow; partner outflow = main inflow
    const pInflowConverted = main.OutflowConverted ?? ZERO_MILLI;
    const pOutflowConverted = main.InflowConverted ?? ZERO_MILLI;

    // Compute originals for partner in partner account currency
    let pInflowOriginal = pInflowConverted;
    let pOutflowOriginal = pOutflowConverted;
    if (partnerAcc.Currency !== budget.DisplayCurrency) {
      if (partner.ExchangeRateOverride && partner.ExchangeRate) {
        // The partner leg carries a manual rate override; honor it instead of the market rate
        // so syncing the other leg doesn't silently overwrite the user's rate. ExchangeRate is
        // account→budget, so original = converted / rate. (ExchangeRate/ExchangeRateOverride are
        // left untouched by updateTransactionWithOriginal, keeping the leg self-consistent.)
        pInflowOriginal = asMilli(
          convertScaled(
            pInflowConverted,
            1 / partner.ExchangeRate,
            budget.DisplayCurrency,
            partnerAcc.Currency
          )
        );
        pOutflowOriginal = asMilli(
          convertScaled(
            pOutflowConverted,
            1 / partner.ExchangeRate,
            budget.DisplayCurrency,
            partnerAcc.Currency
          )
        );
      } else {
        pInflowOriginal = await this.currencyService.convertAmount(
          pInflowConverted,
          budget.DisplayCurrency,
          partnerAcc.Currency,
          partner.Date,
          main.BudgetID
        );
        pOutflowOriginal = await this.currencyService.convertAmount(
          pOutflowConverted,
          budget.DisplayCurrency,
          partnerAcc.Currency,
          partner.Date,
          main.BudgetID
        );
      }
    }

    this.db.transaction(() => {
      this.queries.updateTransactionWithOriginal(
        partner.ID,
        pInflowOriginal,
        pOutflowOriginal,
        pInflowConverted,
        pOutflowConverted,
        partner.CategoryID,
        partner.AccountID,
        partner.Date,
        partner.Memo,
        internalOnBudgetTransfer ? null : (partner.Payee ?? null)
      );
      if (internalOnBudgetTransfer) this.queries.updateTransactionPayee(main.ID, null);
      this.queries.recalculateBalances(partner.AccountID);
    });
  }

  /**
   * UpdateTransactionFromBudgetCurrency - Updates when user edits in budget currency
   * This back-calculates the original amount from the budget currency amount
   */
  async updateTransactionFromBudgetCurrency(
    transactionId: number,
    inflowBudget: MilliUnits,
    outflowBudget: MilliUnits,
    accountId: number,
    categoryId: number,
    date: string,
    memo: string,
    payee?: string
  ): Promise<void> {
    return this.applyAmountEdit(
      transactionId,
      'budget-currency',
      inflowBudget,
      outflowBudget,
      accountId,
      categoryId,
      date,
      memo,
      payee
    );
  }

  /**
   * UpdateTransactionOriginal - Updates original amounts and recalculates converted amounts
   * This handles updates when the user is editing in account currency
   */
  async updateTransactionOriginal(
    transactionId: number,
    inflowOriginal: MilliUnits,
    outflowOriginal: MilliUnits,
    accountId: number,
    categoryId: number,
    date: string,
    memo: string,
    payee?: string
  ): Promise<void> {
    return this.applyAmountEdit(
      transactionId,
      'account-currency',
      inflowOriginal,
      outflowOriginal,
      accountId,
      categoryId,
      date,
      memo,
      payee
    );
  }

  /**
   * Shared scaffolding for the two amount-edit flavors. `editedIn` picks the
   * rate path: 'budget-currency' back-calculates the original amounts from a
   * budget-currency edit; 'account-currency' converts an original-amount edit
   * into budget amounts. The two paths deliberately stay separate — they use
   * different rate sources and rounding directions.
   */
  private async applyAmountEdit(
    transactionId: number,
    editedIn: 'budget-currency' | 'account-currency',
    inflow: MilliUnits,
    outflow: MilliUnits,
    accountId: number,
    categoryId: number,
    date: string,
    memo: string,
    payee?: string
  ): Promise<void> {
    const { account, budget } = this.queries.getAccountAndBudget(accountId);

    if (!account) {
      throw new NotFoundError('Account', accountId);
    }

    if (!budget) {
      throw new NotFoundError('Budget', account.BudgetID);
    }

    const existingTransaction = this.getTransactionByID(transactionId);

    const normalizedPayee = this.resolvePayee(payee, existingTransaction.Payee);

    // Same-currency default: original and converted amounts coincide.
    let inflowOriginal = inflow;
    let outflowOriginal = outflow;
    let inflowConverted = inflow;
    let outflowConverted = outflow;

    if (account.Currency !== budget.DisplayCurrency) {
      if (editedIn === 'budget-currency') {
        const rate = await this.currencyService.getOrFetchRate(
          account.Currency,
          budget.DisplayCurrency,
          date,
          account.BudgetID
        );

        if (!rate) {
          console.warn(
            `No exchange rate available for ${account.Currency} → ${budget.DisplayCurrency} on ${date}`
          );
        }

        // Back-calculate original amounts (inverse conversion) and store the
        // exchange rate on the transaction
        if (rate) {
          inflowOriginal = asMilli(
            convertScaled(inflow, 1 / rate, budget.DisplayCurrency, account.Currency)
          );
          outflowOriginal = asMilli(
            convertScaled(outflow, 1 / rate, budget.DisplayCurrency, account.Currency)
          );
          this.queries.setExchangeRate(transactionId, rate, false);
        }
      } else {
        inflowConverted = await this.currencyService.convertAmount(
          inflow,
          account.Currency,
          budget.DisplayCurrency,
          date,
          account.BudgetID
        );

        outflowConverted = await this.currencyService.convertAmount(
          outflow,
          account.Currency,
          budget.DisplayCurrency,
          date,
          account.BudgetID
        );

        const rate = await this.currencyService.resolveRate(
          account.Currency,
          budget.DisplayCurrency,
          date,
          account.BudgetID
        );
        if (rate) {
          this.queries.setExchangeRate(transactionId, rate, false);
        }
      }
    }

    this.queries.updateTransactionWithOriginal(
      transactionId,
      inflowOriginal ?? 0,
      outflowOriginal ?? 0,
      inflowConverted ?? 0,
      outflowConverted ?? 0,
      categoryId,
      accountId,
      date,
      memo ?? '',
      normalizedPayee ?? null
    );

    this.queries.recalculateBalances(accountId);

    await this.syncTransferPartnerAmounts(transactionId);
  }

  /**
   * UpdateTransactionColumn - Updates a specific column of a transaction with complex balance logic
   * This is a simplified version of the Go method - the full implementation would be quite complex
   */
  async updateTransactionColumn(
    transactionId: number,
    columnName: string,
    newValue: string | number | null,
    exchangeRateOverride?: boolean
  ): Promise<void> {
    const transaction = this.getTransactionByID(transactionId);
    const col = columnName.toLowerCase().replace(/_/g, '');

    switch (col) {
      case 'inflowconverted':
      case 'inflow': // legacy pre-045 name
        // When updating the converted amount (budget currency), we need to back-calculate the original.
        // asMilli doubles as the op-boundary guard: a decimal amount arriving in
        // an op payload throws here instead of being written to an integer column.
        await this.updateTransactionFromBudgetCurrency(
          transactionId,
          asMilli(Number(newValue ?? 0)),
          transaction.OutflowConverted ?? ZERO_MILLI,
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'outflowconverted':
      case 'outflow': // legacy pre-045 name
        // When updating the converted amount (budget currency), we need to back-calculate the original
        await this.updateTransactionFromBudgetCurrency(
          transactionId,
          transaction.InflowConverted ?? ZERO_MILLI,
          asMilli(Number(newValue ?? 0)),
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'inflownative':
      case 'infloworiginal': // legacy pre-045 name
        // When updating original amount, we need to recalculate the converted amount
        await this.updateTransactionOriginal(
          transactionId,
          asMilli(Number(newValue ?? 0)),
          transaction.OutflowNative ?? transaction.OutflowConverted ?? ZERO_MILLI,
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'outflownative':
      case 'outfloworiginal': // legacy pre-045 name
        // When updating original amount, we need to recalculate the converted amount
        await this.updateTransactionOriginal(
          transactionId,
          transaction.InflowNative ?? transaction.InflowConverted ?? ZERO_MILLI,
          asMilli(Number(newValue ?? 0)),
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'categoryid':
        if (this.queries.isOnBudgetToOnBudgetTransfer(transactionId)) {
          throw new ValidationError(
            'On-budget transfer categories are managed automatically and cannot be recategorized'
          );
        }
        this.moveTransactionToNewCategory(transactionId, parseInt(newValue as string));
        break;
      case 'labelid': {
        const parsed =
          typeof newValue === 'number'
            ? newValue
            : typeof newValue === 'string'
              ? parseInt(newValue, 10)
              : NaN;
        const nextLabelId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

        if (nextLabelId !== null) {
          this.assertLabelBelongsToBudget(nextLabelId, transaction.BudgetID);
        }

        this.queries.updateTransactionLabel(transactionId, nextLabelId);
        break;
      }
      case 'date':
        if (transaction.TransferID) {
          this.queries.updateTransactionDate(transactionId, newValue as string);
          this.queries.recalculateBalances(transaction.AccountID);
        } else {
          await this.updateTransaction(
            transactionId,
            transaction.InflowNative ?? transaction.InflowConverted ?? 0,
            transaction.OutflowNative ?? transaction.OutflowConverted ?? 0,
            transaction.AccountID,
            transaction.CategoryID,
            newValue as string,
            transaction.Memo ?? ''
          );
        }
        break;
      case 'memo':
        this.queries.updateTransactionMemo(transactionId, newValue as string);
        break;
      case 'payee':
        if (this.isInternalOnBudgetTransfer(transaction)) {
          const linked = this.getTransactionsByTransferID(transaction.TransferID!);
          this.db.transaction(() => {
            for (const leg of linked) this.queries.updateTransactionPayee(leg.ID, null);
          });
          break;
        }
        if (typeof newValue === 'string' && newValue.trim()) {
          this.queries.insertPayee(transaction.BudgetID, newValue.trim());
        }
        this.queries.updateTransactionPayee(
          transactionId,
          typeof newValue === 'string' ? newValue.trim() || null : null
        );
        break;
      case 'accountid':
        await this.moveTransactionToNewAccount(transactionId, newValue as number);
        break;
      case 'exchangerate': {
        const newRate = Number(newValue);
        assertValidExchangeRate(newRate);
        const overrideFlag = (exchangeRateOverride ?? true) ? 1 : 0;

        const tx = this.getTransactionByID(transactionId);
        const { account: rateAccount, budget: rateBudget } = this.queries.getAccountAndBudget(
          tx.AccountID
        );
        const accountCurrency = rateAccount?.Currency ?? rateBudget?.DisplayCurrency ?? '';
        const budgetCurrency = rateBudget?.DisplayCurrency ?? accountCurrency;

        if (tx.TransferID) {
          // Transfer leg: the budget-currency (converted) amount is the anchor — it is the
          // value moved between the two legs and must stay put. Overriding the rate only
          // changes how much account-currency that value corresponds to, so we hold
          // InflowConverted/OutflowConverted fixed and re-derive the originals. (Without this, raising the rate
          // would inflate the incoming leg's converted amount instead of correcting the
          // original amount the user actually received.)
          const inflowConverted = tx.InflowConverted ?? 0;
          const outflowConverted = tx.OutflowConverted ?? 0;
          // money / rate -> round back to integer storage units before storing
          const newInflowOriginal = newRate
            ? convertScaled(inflowConverted, 1 / newRate, budgetCurrency, accountCurrency)
            : inflowConverted;
          const newOutflowOriginal = newRate
            ? convertScaled(outflowConverted, 1 / newRate, budgetCurrency, accountCurrency)
            : outflowConverted;

          this.db.transaction(() => {
            run(
              this.db,
              `
              UPDATE transactions
              SET InflowNative = ?, OutflowNative = ?,
                  ExchangeRate = ?, ExchangeRateOverride = ?
              WHERE ID = ?
            `,
              newInflowOriginal,
              newOutflowOriginal,
              newRate,
              overrideFlag,
              transactionId
            );
            if (!this.accountHasUnsafeTransactionAmounts(tx.AccountID)) {
              this.queries.recalculateBalances(tx.AccountID);
            }
          });
        } else {
          // Regular transaction: the original (account-currency) amount is ground truth, so
          // overriding the rate re-derives the budget-currency converted amount.
          const inflowOrig = tx.InflowNative ?? tx.InflowConverted ?? 0;
          const outflowOrig = tx.OutflowNative ?? tx.OutflowConverted ?? 0;
          const newInflow = convertScaled(inflowOrig, newRate, accountCurrency, budgetCurrency);
          const newOutflow = convertScaled(outflowOrig, newRate, accountCurrency, budgetCurrency);

          this.db.transaction(() => {
            run(
              this.db,
              `
              UPDATE transactions
              SET InflowConverted = ?, OutflowConverted = ?,
                  ExchangeRate = ?, ExchangeRateOverride = ?
              WHERE ID = ?
            `,
              newInflow,
              newOutflow,
              newRate,
              overrideFlag,
              transactionId
            );
            if (!this.accountHasUnsafeTransactionAmounts(tx.AccountID)) {
              this.queries.recalculateBalances(tx.AccountID);
            }
          });
        }
        break;
      }
      default:
        throw new ValidationError(`Unsupported column: ${columnName}`);
    }
  }

  private isInternalOnBudgetTransfer(transaction: Transaction): boolean {
    if (!transaction.TransferID) return false;
    const linked = this.getTransactionsByTransferID(transaction.TransferID);
    if (linked.length < 2) return false;
    return linked.every((leg) => {
      const { account } = this.queries.getAccountAndBudget(leg.AccountID, leg.BudgetID);
      return account ? isAccountOnBudget(account) : false;
    });
  }

  /**
   * Existing databases may contain more than one corrupt conversion. Allow
   * each offending rate to be repaired independently; balances are rebuilt
   * automatically as soon as the final unsafe source/converted amount is gone.
   */
  private accountHasUnsafeTransactionAmounts(accountId: number): boolean {
    const max = Number.MAX_SAFE_INTEGER;
    const result = getRow<{ count: number }>(
      this.db,
      `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE AccountID = ?
        AND (
          typeof(InflowConverted) <> 'integer' OR InflowConverted > ? OR InflowConverted < ? OR
          typeof(OutflowConverted) <> 'integer' OR OutflowConverted > ? OR OutflowConverted < ? OR
          (InflowNative IS NOT NULL AND (typeof(InflowNative) <> 'integer' OR InflowNative > ? OR InflowNative < ?)) OR
          (OutflowNative IS NOT NULL AND (typeof(OutflowNative) <> 'integer' OR OutflowNative > ? OR OutflowNative < ?))
        )
    `,
      accountId,
      max,
      -max,
      max,
      -max,
      max,
      -max,
      max,
      -max
    );
    return Number(result?.count ?? 0) > 0;
  }

  /**
   * GetTransactionsByCategoryAndMonth - Gets transactions for a specific category and month
   *
   * This method is specific to TypeScript implementation to support the spending drawer
   */
  getTransactionsByCategoryAndMonth(
    budgetId: number,
    categoryName: string,
    month: string
  ): GetTransactionsByCategoryAndMonthRow[] {
    return this.queries.getTransactionsByCategoryAndMonth(budgetId, categoryName, month);
  }

  getTransactionsByCategoryAndRange(
    budgetId: number,
    categoryId: number | null,
    startDate: string,
    endDate: string,
    accountIds?: number[]
  ): GetTransactionsByCategoryAndMonthRow[] {
    return this.queries.getTransactionsByCategoryAndRange(
      budgetId,
      categoryId,
      startDate,
      endDate,
      accountIds
    );
  }

  /**
   * ReconcileAccount - Marks all transactions up to today as reconciled and updates account reconciled_at
   *
   * @param accountId The account to reconcile
   * @param reconcileDate The date to reconcile up to (defaults to today)
   * @returns void
   */
  reconcileAccount(accountId: number, reconcileDate?: string): void {
    const date = reconcileDate || getLocalDateString();
    const timestamp = new Date().toISOString();

    this.db.transaction(() => {
      this.queries.markTransactionsAsReconciled(accountId, date);
      this.queries.updateAccountReconciledAt(accountId, timestamp);
    });
  }

  /**
   * ensureDebtAccountCategory - Ensures a per-account linked category exists for a debt account
   * Creates the category under the "Liabilities" group with the account's name
   * Updates the account's metadata with the linked_category_id
   * Returns the category ID
   */
  private ensureDebtAccountCategory(debtAccountId: number, budgetId: number): number {
    const account = getRow<{ ID: number; Name: string; Metadata: string }>(
      this.db,
      'SELECT ID, Name, Metadata FROM accounts WHERE ID = ?',
      debtAccountId
    );

    if (!account) {
      throw new NotFoundError(`Debt account ${debtAccountId} not found`);
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(account.Metadata || '{}');
      if (metadata.linked_category_id) {
        return metadata.linked_category_id as number;
      }
    } catch {
      // Metadata parsing failed, continue to create category
    }

    // Ensure the "Liabilities" group exists, then create the category with the
    // account name (e.g., "Chase CC")
    const categoryId = this.categoryService.addCategory(
      ensureCategoryGroup(this.categoryService, budgetId, 'Liabilities'),
      budgetId,
      account.Name,
      `Linked category for ${account.Name} debt payments`
    );

    const updatedMetadata = { ...metadata, linked_category_id: categoryId };
    run(
      this.db,
      'UPDATE accounts SET Metadata = ? WHERE ID = ?',
      JSON.stringify(updatedMetadata),
      debtAccountId
    );

    debugLog(
      `✅ Created linked category "${account.Name}" (ID: ${categoryId}) for debt account ${debtAccountId}`
    );

    return categoryId;
  }

  /**
   * UpdateTransferMemosForAccountRename - Updates all transfer memos when an account is renamed
   * Updates "Transfer from {oldName}" and "Transfer to {oldName}" patterns
   */
  updateTransferMemosForAccountRename(budgetId: number, oldName: string, newName: string): void {
    this.queries.updateTransferMemosForAccountRename(budgetId, oldName, newName);
  }
}
