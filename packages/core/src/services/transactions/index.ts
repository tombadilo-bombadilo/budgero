import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, run } from '../../database/sql.js';
import {
  Transaction,
  GetTransactionsByAccountRow,
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
import { asMilli, convertAtRate, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import { getLocalDateString } from '../../utils/date.js';

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
    labelId?: number | null
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
    });

    const { account, budget } = this.queries.getAccountAndBudget(accountId, budgetId);

    // Calculate converted amounts (will be same as original if currencies match)
    let inflowConverted: MilliUnits = inflowOriginal;
    let outflowConverted: MilliUnits = outflowOriginal;
    let resolvedExchangeRate: number | null = null;

    if (account && budget && account.Currency !== budget.DisplayCurrency) {
      const month = date.substring(0, 7); // Extract YYYY-MM from date

      // Use full resolution chain: custom date-range → official → manual → fallback → 1:1
      let rate = await this.currencyService.resolveRate(
        account.Currency,
        budget.DisplayCurrency,
        date,
        month,
        budgetId
      );

      if (!rate) {
        // No rate found; use 1:1 temporary (pending is computed separately below)
        rate = 1;
      }

      resolvedExchangeRate = rate;
      inflowConverted = convertAtRate(inflowOriginal, rate || 1);
      outflowConverted = convertAtRate(outflowOriginal, rate || 1);
    }

    // Capture whether we need to mark this row pending (manual/adjacent/1:1)
    let markPending = false;
    if (account && budget && account.Currency !== budget.DisplayCurrency) {
      const month = date.substring(0, 7);
      const official = await this.currencyService.getLocalRate(
        account.Currency,
        budget.DisplayCurrency,
        month,
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

    return this.db.transaction(() => {
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
          Balance: number;
          Metadata: string;
        }>(
          this.db,
          `SELECT t.AccountID, t.Inflow as TxInflow, t.Outflow as TxOutflow,
                  a.Type, a.OnBudget, a.Balance, a.Metadata
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
          ? partner.Balance - (partner.TxInflow || 0) + (partner.TxOutflow || 0)
          : 0;

        debugLog('🔍 Partner account info:', {
          partnerId: partner?.AccountID,
          partnerType: partner?.Type,
          isPartnerDebt,
          isPartnerOnBudget,
          partnerBalance: partner?.Balance,
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
        // 3. The current account is on-budget and has outflow (source side of transfer)
        // Note: We can't check the partner account here because for the source transaction,
        // the partner transaction doesn't exist yet. The frontend handles the detection.
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
          isCurrentOutflow &&
          isCurrentOnBudget &&
          !useDebtCategory &&
          categoryId !== 0 &&
          categoryId !== transfersCategoryId;

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

      // 3. Get previous running balances (both original and converted)
      const prevBalanceConverted = this.queries.getRunningBalanceBefore(accountId, date) || 0;
      const prevBalanceOriginal =
        this.queries.getRunningBalanceOriginalBefore(accountId, date) || 0;

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
        normalizedLabelId
      );

      // If rate was manual/adjacent/1:1, mark pending for later recalc
      if (markPending) this.queries.setConversionPending(id, true);

      // 6. Bump future balances (both converted and original)
      this.queries.bumpFutureBalances(accountId, date, id, deltaConverted);
      this.queries.bumpFutureBalancesOriginal(accountId, date, id, deltaOriginal);

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
            Inflow: ZERO_MILLI,
            Outflow: spendingAmount,
            InflowOriginal: ZERO_MILLI,
            OutflowOriginal: spendingAmount,
            OrderIndex: 0,
          });
        }

        // Split 2: Overpayment amount to Transfers category
        this.queries.insertSplitLine({
          TransactionID: id,
          CategoryID: transfersCategoryIdForSplit,
          Memo: 'Overpayment',
          Inflow: ZERO_MILLI,
          Outflow: overpaymentAmount,
          InflowOriginal: ZERO_MILLI,
          OutflowOriginal: overpaymentAmount,
          OrderIndex: 1,
        });

        debugLog('✅ Created overpayment splits');
      }

      debugLog('✅ Transaction added successfully with ID:', id);
      return id;
    });
  }

  /**
   * GetAllTransactions - Gets all transactions for a budget
   */
  getAllTransactions(budgetId: number): GetAllTransactions[] {
    return this.queries.getAllTransactions(budgetId);
  }

  /**
   * GetAllTransactionsDetailed - Gets all transactions for a budget with full details
   * Returns same format as getTransactionsByAccount but includes Account field for all accounts
   */
  getAllTransactionsDetailed(budgetId: number): GetTransactionsByAccountRow[] {
    return this.queries.getAllTransactionsDetailed(budgetId);
  }

  /**
   * GetTransactionsByAccount - Gets transactions for a specific account
   */
  getTransactionsByAccount(accountId: number): GetTransactionsByAccountRow[] {
    return this.queries.getTransactionsByAccount(accountId);
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
      const month = date.substring(0, 7);

      const rate = await this.currencyService.getOrFetchRate(
        account.Currency,
        budget.DisplayCurrency,
        month,
        budgetId
      );

      if (!rate) {
        console.warn(
          `No exchange rate available for ${account.Currency} → ${budget.DisplayCurrency} in ${month}`
        );
      }

      inflow = await this.currencyService.convertAmount(
        inflow,
        account.Currency,
        budget.DisplayCurrency,
        month,
        budgetId,
        date
      );

      outflow = await this.currencyService.convertAmount(
        outflow,
        account.Currency,
        budget.DisplayCurrency,
        month,
        budgetId,
        date
      );
    }

    // No pending-flag handling in updateTransaction; pending recalculation is tracked on add/move flows

    const normalizedPayee = this.resolvePayee(payee, transaction.Payee);

    this.db.transaction(() => {
      // 1. Fetch original transaction
      const oldTxn = this.getTransactionByID(id);

      // 2. Calculate deltas (using converted amounts)
      const oldDelta = oldTxn.Inflow - oldTxn.Outflow;
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
        inflowOriginal - (oldTxn.InflowOriginal ?? oldTxn.Inflow ?? 0),
        outflowOriginal - (oldTxn.OutflowOriginal ?? oldTxn.Outflow ?? 0),
        inflow - (oldTxn.Inflow ?? 0),
        outflow - (oldTxn.Outflow ?? 0)
      );
    });

    // Recalculate balances to ensure both converted and original running balances are consistent
    this.queries.recalculateBalances(accountId);

    await this.syncTransferPartner(id);
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

      // 3. Delete the main transaction
      this.queries.deleteTransaction(id);

      // 4. Bump future balances negatively for main transaction (both converted and original)
      const deltaConverted = -(txn.Inflow - txn.Outflow);
      const deltaOriginal = -(
        (txn.InflowOriginal ?? txn.Inflow ?? 0) - (txn.OutflowOriginal ?? txn.Outflow ?? 0)
      );

      this.queries.bumpFutureBalances(txn.AccountID, txn.Date, txn.ID, deltaConverted);
      this.queries.bumpFutureBalancesOriginal(txn.AccountID, txn.Date, txn.ID, deltaOriginal);

      // 5. Update account balance for main transaction (both original and converted)
      // When deleting: subtract previous inflows, add back previous outflows
      // We pass outflow as inflow (to add it back) and inflow as outflow (to subtract it)
      this.queries.updateAccountBalance(
        txn.AccountID,
        txn.OutflowOriginal ?? txn.Outflow ?? 0, // Add back the outflow (pass as inflow param)
        txn.InflowOriginal ?? txn.Inflow ?? 0, // Subtract the inflow (pass as outflow param)
        txn.Outflow ?? 0, // Add back the outflow converted
        txn.Inflow ?? 0 // Subtract the inflow converted
      );

      // 6. Delete partner transactions if this was a transfer
      for (const partner of partnerTransactions) {
        debugLog(`🗑️ Deleting partner transaction ${partner.ID} in account ${partner.AccountID}`);

        this.queries.deleteTransaction(partner.ID);

        const partnerDeltaConverted = -(partner.Inflow - partner.Outflow);
        const partnerDeltaOriginal = -(
          (partner.InflowOriginal ?? partner.Inflow ?? 0) -
          (partner.OutflowOriginal ?? partner.Outflow ?? 0)
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
          partner.OutflowOriginal ?? partner.Outflow ?? 0,
          partner.InflowOriginal ?? partner.Inflow ?? 0,
          partner.Outflow ?? 0,
          partner.Inflow ?? 0
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
    let newInflowConverted = tx.Inflow ?? 0;
    let newOutflowConverted = tx.Outflow ?? 0;
    // New originals in target account currency
    let newInflowOriginal = tx.InflowOriginal ?? tx.Inflow ?? 0;
    let newOutflowOriginal = tx.OutflowOriginal ?? tx.Outflow ?? 0;

    if (newAccount && oldAccount && budget) {
      needsRecalculation = newAccount.Currency !== oldAccount.Currency;

      if (needsRecalculation) {
        const month = tx.Date.substring(0, 7);

        // Determine old originals reliably (fall back by back-calculating from converted if needed)
        let oldInflowOriginal = tx.InflowOriginal;
        let oldOutflowOriginal = tx.OutflowOriginal;
        if (oldInflowOriginal == null && (tx.Inflow ?? 0) !== 0) {
          // convert from budget to old account currency
          oldInflowOriginal = await this.currencyService.convertAmount(
            tx.Inflow,
            budget.DisplayCurrency,
            oldAccount.Currency,
            month,
            tx.BudgetID,
            tx.Date
          );
        }
        if (oldOutflowOriginal == null && (tx.Outflow ?? 0) !== 0) {
          oldOutflowOriginal = await this.currencyService.convertAmount(
            tx.Outflow,
            budget.DisplayCurrency,
            oldAccount.Currency,
            month,
            tx.BudgetID,
            tx.Date
          );
        }

        // Compute new originals in target account currency
        newInflowOriginal = await this.currencyService.convertAmount(
          oldInflowOriginal ?? ZERO_MILLI,
          oldAccount.Currency,
          newAccount.Currency,
          month,
          tx.BudgetID,
          tx.Date
        );
        newOutflowOriginal = await this.currencyService.convertAmount(
          oldOutflowOriginal ?? ZERO_MILLI,
          oldAccount.Currency,
          newAccount.Currency,
          month,
          tx.BudgetID,
          tx.Date
        );

        // Now compute converted (budget currency) using target account currency
        if (newAccount.Currency !== budget.DisplayCurrency) {
          newInflowConverted = await this.currencyService.convertAmount(
            newInflowOriginal,
            newAccount.Currency,
            budget.DisplayCurrency,
            month,
            tx.BudgetID,
            tx.Date
          );
          newOutflowConverted = await this.currencyService.convertAmount(
            newOutflowOriginal,
            newAccount.Currency,
            budget.DisplayCurrency,
            month,
            tx.BudgetID,
            tx.Date
          );
        } else {
          // Target account in budget currency: converted equals originals
          newInflowConverted = newInflowOriginal;
          newOutflowConverted = newOutflowOriginal;
        }
      } else if (newAccount.Currency === budget.DisplayCurrency) {
        // No recalculation needed, and target is budget currency → converted equals originals
        newInflowConverted = tx.InflowOriginal ?? tx.Inflow ?? 0;
        newOutflowConverted = tx.OutflowOriginal ?? tx.Outflow ?? 0;
        newInflowOriginal = tx.InflowOriginal ?? tx.Inflow ?? 0;
        newOutflowOriginal = tx.OutflowOriginal ?? tx.Outflow ?? 0;
      }
    }

    // Compute pending flag for this move based on availability of official/manual rates
    let markPendingMove = false;
    if (needsRecalculation && newAccount && oldAccount && budget) {
      const month = tx.Date.substring(0, 7);
      const officialOldToNew = await this.currencyService.getLocalRate(
        oldAccount.Currency,
        newAccount.Currency,
        month,
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
        month,
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
      const deltaConverted = tx.Inflow - tx.Outflow;
      const oldDeltaOriginal =
        (tx.InflowOriginal ?? tx.Inflow ?? 0) - (tx.OutflowOriginal ?? tx.Outflow ?? 0);

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
        -Number(tx.InflowOriginal ?? tx.Inflow ?? 0),
        -Number(tx.OutflowOriginal ?? tx.Outflow ?? 0),
        -Number(tx.Inflow ?? 0),
        -Number(tx.Outflow ?? 0)
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

    await this.syncTransferPartner(transactionId);
  }

  /**
   * MoveTransactionToNewCategory - Changes the category of a transaction
   */
  moveTransactionToNewCategory(transactionId: number, categoryId: number): void {
    this.queries.recategorizeTransaction(transactionId, categoryId);
  }

  /**
   * ReassignTransactions - Moves all transactions from one category to another
   */
  reassignTransactions(newCategoryId: number, oldCategoryId: number): void {
    this.queries.reassignTransactionCategories(newCategoryId, oldCategoryId);
  }

  /**
   * GetTransactionsByTransferID - Gets transactions by transfer ID
   */
  getTransactionsByTransferID(transferId: string): Transaction[] {
    return this.queries.getTransactionsByTransferID(transferId);
  }

  /**
   * Synchronize the partner transaction for a transfer (two-leg transfers only).
   * Mirrors date, memo, and amounts to the counterpart leg.
   * - Partner converted amounts are mirrored (inflow <-> outflow) in budget currency.
   * - Partner originals are recalculated using current month rates for partner account currency.
   * - Recalculates partner account balances to keep running balances consistent.
   * Skips if there are not exactly two transactions for the TransferID (e.g., split mirrors).
   */
  private async syncTransferPartner(transactionId: number): Promise<void> {
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

    const { account: partnerAcc, budget } = this.queries.getAccountAndBudget(
      partner.AccountID,
      main.BudgetID
    );
    if (!partnerAcc) return;
    if (!budget) return;

    const month = (main.Date || '').substring(0, 7);

    // Mirror converted (budget) amounts: partner inflow = main outflow; partner outflow = main inflow
    const pInflowConverted = main.Outflow ?? ZERO_MILLI;
    const pOutflowConverted = main.Inflow ?? ZERO_MILLI;

    // Compute originals for partner in partner account currency
    let pInflowOriginal = pInflowConverted;
    let pOutflowOriginal = pOutflowConverted;
    if (partnerAcc.Currency !== budget.DisplayCurrency) {
      if (partner.ExchangeRateOverride && partner.ExchangeRate) {
        // The partner leg carries a manual rate override; honor it instead of the market rate
        // so syncing the other leg doesn't silently overwrite the user's rate. ExchangeRate is
        // account→budget, so original = converted / rate. (ExchangeRate/ExchangeRateOverride are
        // left untouched by updateTransactionWithOriginal, keeping the leg self-consistent.)
        pInflowOriginal = convertAtRate(pInflowConverted, 1 / partner.ExchangeRate);
        pOutflowOriginal = convertAtRate(pOutflowConverted, 1 / partner.ExchangeRate);
      } else {
        pInflowOriginal = await this.currencyService.convertAmount(
          pInflowConverted,
          budget.DisplayCurrency,
          partnerAcc.Currency,
          month,
          main.BudgetID,
          main.Date
        );
        pOutflowOriginal = await this.currencyService.convertAmount(
          pOutflowConverted,
          budget.DisplayCurrency,
          partnerAcc.Currency,
          month,
          main.BudgetID,
          main.Date
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
        main.Date,
        main.Memo,
        main.Payee ?? null
      );
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
      const month = date.substring(0, 7);

      if (editedIn === 'budget-currency') {
        const rate = await this.currencyService.getOrFetchRate(
          account.Currency,
          budget.DisplayCurrency,
          month,
          account.BudgetID
        );

        if (!rate) {
          console.warn(
            `No exchange rate available for ${account.Currency} → ${budget.DisplayCurrency} in ${month}`
          );
        }

        // Back-calculate original amounts (inverse conversion) and store the
        // exchange rate on the transaction
        if (rate) {
          inflowOriginal = convertAtRate(inflow, 1 / rate);
          outflowOriginal = convertAtRate(outflow, 1 / rate);
          this.queries.setExchangeRate(transactionId, rate, false);
        }
      } else {
        inflowConverted = await this.currencyService.convertAmount(
          inflow,
          account.Currency,
          budget.DisplayCurrency,
          month,
          account.BudgetID,
          date
        );

        outflowConverted = await this.currencyService.convertAmount(
          outflow,
          account.Currency,
          budget.DisplayCurrency,
          month,
          account.BudgetID,
          date
        );

        const rate = await this.currencyService.resolveRate(
          account.Currency,
          budget.DisplayCurrency,
          date,
          month,
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

    await this.syncTransferPartner(transactionId);
  }

  /**
   * UpdateTransactionColumn - Updates a specific column of a transaction with complex balance logic
   * This is a simplified version of the Go method - the full implementation would be quite complex
   */
  async updateTransactionColumn(
    transactionId: number,
    columnName: string,
    newValue: string | number | null
  ): Promise<void> {
    const transaction = this.getTransactionByID(transactionId);
    const col = columnName.toLowerCase().replace(/_/g, '');

    switch (col) {
      case 'inflow':
        // When updating the converted amount (budget currency), we need to back-calculate the original.
        // asMilli doubles as the op-boundary guard: a decimal amount arriving in
        // an op payload throws here instead of being written to an integer column.
        await this.updateTransactionFromBudgetCurrency(
          transactionId,
          asMilli(Number(newValue ?? 0)),
          transaction.Outflow ?? ZERO_MILLI,
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'outflow':
        // When updating the converted amount (budget currency), we need to back-calculate the original
        await this.updateTransactionFromBudgetCurrency(
          transactionId,
          transaction.Inflow ?? ZERO_MILLI,
          asMilli(Number(newValue ?? 0)),
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'infloworiginal':
        // When updating original amount, we need to recalculate the converted amount
        await this.updateTransactionOriginal(
          transactionId,
          asMilli(Number(newValue ?? 0)),
          transaction.OutflowOriginal ?? transaction.Outflow ?? ZERO_MILLI,
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'outfloworiginal':
        // When updating original amount, we need to recalculate the converted amount
        await this.updateTransactionOriginal(
          transactionId,
          transaction.InflowOriginal ?? transaction.Inflow ?? ZERO_MILLI,
          asMilli(Number(newValue ?? 0)),
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? ''
        );
        break;
      case 'categoryid':
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
        await this.updateTransaction(
          transactionId,
          transaction.InflowOriginal ?? transaction.Inflow ?? 0,
          transaction.OutflowOriginal ?? transaction.Outflow ?? 0,
          transaction.AccountID,
          transaction.CategoryID,
          newValue as string,
          transaction.Memo ?? ''
        );
        break;
      case 'memo':
        await this.updateTransaction(
          transactionId,
          transaction.InflowOriginal ?? transaction.Inflow ?? 0,
          transaction.OutflowOriginal ?? transaction.Outflow ?? 0,
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          newValue as string
        );
        break;
      case 'payee':
        if (typeof newValue === 'string' && newValue.trim()) {
          this.queries.insertPayee(transaction.BudgetID, newValue.trim());
        }
        await this.updateTransaction(
          transactionId,
          transaction.InflowOriginal ?? transaction.Inflow ?? 0,
          transaction.OutflowOriginal ?? transaction.Outflow ?? 0,
          transaction.AccountID,
          transaction.CategoryID,
          transaction.Date,
          transaction.Memo ?? '',
          typeof newValue === 'string' ? newValue : String(newValue ?? '')
        );
        break;
      case 'accountid':
        await this.moveTransactionToNewAccount(transactionId, newValue as number);
        break;
      case 'exchangerate': {
        const newRate = newValue as number;
        // Set the rate and mark as manual override
        this.queries.setExchangeRate(transactionId, newRate, true);

        const tx = this.getTransactionByID(transactionId);

        if (tx.TransferID) {
          // Transfer leg: the budget-currency (converted) amount is the anchor — it is the
          // value moved between the two legs and must stay put. Overriding the rate only
          // changes how much account-currency that value corresponds to, so we hold
          // Inflow/Outflow fixed and re-derive the originals. (Without this, raising the rate
          // would inflate the incoming leg's converted amount instead of correcting the
          // original amount the user actually received.)
          const inflowConverted = tx.Inflow ?? 0;
          const outflowConverted = tx.Outflow ?? 0;
          // money / rate -> round back to integer milliunits before storing
          const newInflowOriginal = newRate
            ? Math.round(inflowConverted / newRate)
            : inflowConverted;
          const newOutflowOriginal = newRate
            ? Math.round(outflowConverted / newRate)
            : outflowConverted;

          run(
            this.db,
            `
            UPDATE transactions SET InflowOriginal = ?, OutflowOriginal = ? WHERE ID = ?
          `,
            newInflowOriginal,
            newOutflowOriginal,
            transactionId
          );
        } else {
          // Regular transaction: the original (account-currency) amount is ground truth, so
          // overriding the rate re-derives the budget-currency converted amount.
          const inflowOrig = tx.InflowOriginal ?? tx.Inflow ?? 0;
          const outflowOrig = tx.OutflowOriginal ?? tx.Outflow ?? 0;
          const newInflow = Math.round(inflowOrig * newRate);
          const newOutflow = Math.round(outflowOrig * newRate);

          run(
            this.db,
            `
            UPDATE transactions SET Inflow = ?, Outflow = ? WHERE ID = ?
          `,
            newInflow,
            newOutflow,
            transactionId
          );
        }

        this.queries.recalculateBalances(tx.AccountID);
        break;
      }
      default:
        throw new ValidationError(`Unsupported column: ${columnName}`);
    }
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
