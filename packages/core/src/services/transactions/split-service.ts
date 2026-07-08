import { DatabaseAdapter } from '../../database/interface.js';
import { getRow } from '../../database/sql.js';
import { asMilli, toDecimal, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import { NotFoundError } from '../../types';
import { TransactionQueries } from './queries.js';
import { CurrencyService } from '../currency/index.js';
import { CategoryService } from '../categories/index.js';
import { TransactionSplit } from './types.js';
import { ensureTransferCategory } from './category-helpers.js';

/**
 * SplitService - manages split transactions, including mirrored rows for transfer split lines.
 */
export class SplitService {
  private queries: TransactionQueries;

  private currencyService: CurrencyService;

  private categoryService: CategoryService;

  constructor(private db: DatabaseAdapter) {
    this.queries = new TransactionQueries(db);
    this.currencyService = new CurrencyService(db);
    this.categoryService = new CategoryService(db);
  }

  /**
   * Upsert a split transaction atomically. Replaces existing splits.
   * Validates: sum(inflow-outflow) across splits equals parent inflow-outflow.
   * For transfer split lines, does not create separate parent rows; instead stores TransferAccountID for later reporting.
   */
  async upsertSplits(
    transactionId: number,
    splits: Omit<TransactionSplit, 'ID' | 'TransactionID'>[]
  ): Promise<void> {
    const parent = this.queries.getTransactionByID(transactionId);
    if (!parent) throw new NotFoundError('Transaction', transactionId);

    // Transfers move money between two of your own accounts and are already
    // mirrored as a linked pair. Splitting one would have to reconcile the
    // split lines against the partner row and its balance mechanics — a lot of
    // complexity for no real budgeting benefit — so it is not allowed. (A split
    // may still contain a transfer LINE via TransferAccountID; that is a
    // different thing from splitting an existing transfer.)
    if (parent.TransferID && parent.TransferID.trim() !== '') {
      throw new Error('Transfer transactions cannot be split.');
    }

    // Compute parent net in account currency
    const parentNet = (parent.Inflow || 0) - (parent.Outflow || 0);

    let splitsNet = 0;
    for (const s of splits) {
      // Basic validation: exactly one of CategoryID or TransferAccountID may be set
      const hasCat = s.CategoryID != null && s.CategoryID !== undefined;
      const hasTransfer = s.TransferAccountID != null && s.TransferAccountID !== undefined;
      if ((hasCat && hasTransfer) || (!hasCat && !hasTransfer)) {
        throw new Error(
          'Each split must have either CategoryID or TransferAccountID (exclusively)'
        );
      }
      splitsNet += (s.Inflow || 0) - (s.Outflow || 0);
    }

    // Integer milliunits compare exactly — splits must reconcile to the milliunit
    if (splitsNet !== parentNet) {
      throw new Error(
        `Split amounts must sum to parent total. Remaining: ${toDecimal(asMilli(parentNet - splitsNet))}`
      );
    }

    // Upsert atomically: delete old, insert new
    // Precompute mirror rows (async conversions) before entering sync transaction
    const { account: sourceAcc, budget } = this.queries.getAccountAndBudget(
      parent.AccountID,
      parent.BudgetID
    );

    const month = parent.Date.substring(0, 7);

    type PreparedMirror = {
      targetAccountId: number;
      memo: string;
      inflowOriginal: MilliUnits;
      outflowOriginal: MilliUnits;
      inflowConverted: MilliUnits;
      outflowConverted: MilliUnits;
    };
    const preparedMirrors: PreparedMirror[] = [];

    if (sourceAcc && budget) {
      for (const s of splits) {
        if (!s.TransferAccountID) continue;

        const targetAccount = getRow<{ ID: number; Currency: string }>(
          this.db,
          'SELECT ID , Currency FROM accounts WHERE ID = ?',
          s.TransferAccountID
        );
        if (!targetAccount) continue;

        const sourceNetOriginal =
          (s.InflowOriginal ?? s.Inflow ?? 0) - (s.OutflowOriginal ?? s.Outflow ?? 0);
        const mirrorNetOriginalInTarget = await this.currencyService.convertAmount(
          asMilli(-sourceNetOriginal),
          sourceAcc.Currency,
          targetAccount.Currency,
          month,
          parent.BudgetID,
          parent.Date
        );
        const mirrorInflowOriginal =
          mirrorNetOriginalInTarget > 0 ? mirrorNetOriginalInTarget : ZERO_MILLI;
        const mirrorOutflowOriginal =
          mirrorNetOriginalInTarget < 0 ? asMilli(-Number(mirrorNetOriginalInTarget)) : ZERO_MILLI;

        const mirrorInflowConverted = await this.currencyService.convertAmount(
          mirrorInflowOriginal,
          targetAccount.Currency,
          budget.DisplayCurrency,
          month,
          parent.BudgetID,
          parent.Date
        );
        const mirrorOutflowConverted = await this.currencyService.convertAmount(
          mirrorOutflowOriginal,
          targetAccount.Currency,
          budget.DisplayCurrency,
          month,
          parent.BudgetID,
          parent.Date
        );

        preparedMirrors.push({
          targetAccountId: targetAccount.ID,
          memo: s.Memo ?? parent.Memo ?? '',
          inflowOriginal: mirrorInflowOriginal,
          outflowOriginal: mirrorOutflowOriginal,
          inflowConverted: mirrorInflowConverted,
          outflowConverted: mirrorOutflowConverted,
        });
      }
    }

    this.db.transaction(() => {
      // 1) Replace existing splits
      this.queries.deleteSplitsForTransaction(transactionId);
      let orderIndex = 0;
      for (const s of splits) {
        const row: Omit<TransactionSplit, 'ID'> = {
          TransactionID: transactionId,
          CategoryID: s.CategoryID ?? null,
          TransferAccountID: s.TransferAccountID ?? null,
          Memo: s.Memo ?? parent.Memo ?? '',
          Inflow: s.Inflow ?? 0,
          Outflow: s.Outflow ?? 0,
          InflowOriginal: s.InflowOriginal ?? null,
          OutflowOriginal: s.OutflowOriginal ?? null,
          PairID: s.PairID ?? null,
          OrderIndex: s.OrderIndex ?? orderIndex,
        };
        this.queries.insertSplitLine(row);
        orderIndex++;
      }

      // 2) Mirror handling for transfer split lines
      // Strategy: use a common TransferID for all mirrors of this parent to tie both sides
      const transferId =
        parent.TransferID && parent.TransferID.length > 0
          ? parent.TransferID
          : `split_transfer_${parent.ID}_${parent.Date}`;

      // Clear any previous mirrors for this TransferID to avoid duplicates
      this.queries.deleteTransactionsByTransferID(transferId);

      // Create mirror transactions per transfer split
      for (const pm of preparedMirrors) {
        const transfersCategoryId = ensureTransferCategory(this.categoryService, parent.BudgetID);
        const prevBalanceConverted =
          this.queries.getRunningBalanceBefore(pm.targetAccountId, parent.Date) || 0;
        const prevBalanceOriginal =
          this.queries.getRunningBalanceOriginalBefore(pm.targetAccountId, parent.Date) || 0;
        const deltaConverted = pm.inflowConverted - pm.outflowConverted;
        const deltaOriginal = pm.inflowOriginal - pm.outflowOriginal;
        const newBalanceConverted = prevBalanceConverted + deltaConverted;
        const newBalanceOriginal = prevBalanceOriginal + deltaOriginal;

        const mirrorId = this.queries.insertTransactionWithBalance(
          pm.inflowConverted,
          pm.outflowConverted,
          pm.inflowOriginal,
          pm.outflowOriginal,
          transfersCategoryId,
          pm.targetAccountId,
          parent.Date,
          pm.memo,
          parent.Payee ?? null,
          parent.BudgetID,
          newBalanceConverted,
          newBalanceOriginal,
          transferId,
          undefined,
          parent.LabelID ?? null
        );

        this.queries.bumpFutureBalances(pm.targetAccountId, parent.Date, mirrorId, deltaConverted);
        this.queries.bumpFutureBalancesOriginal(
          pm.targetAccountId,
          parent.Date,
          mirrorId,
          deltaOriginal
        );
        this.queries.updateAccountBalance(
          pm.targetAccountId,
          pm.inflowOriginal,
          pm.outflowOriginal,
          pm.inflowConverted,
          pm.outflowConverted
        );
      }
    });
  }

  /**
   * Get splits for a transaction
   */
  getSplits(transactionId: number): TransactionSplit[] {
    return this.queries.getSplitsForTransaction(transactionId);
  }

  /**
   * Clear all splits for a transaction, returning it to a regular entry.
   * Removes any mirrored transfer rows created for split lines.
   */
  async clearSplits(transactionId: number): Promise<void> {
    const parent = this.queries.getTransactionByID(transactionId);
    if (!parent) throw new NotFoundError('Transaction', transactionId);

    const existingSplits = this.queries.getSplitsForTransaction(transactionId);
    if (existingSplits.length === 0) {
      return; // Nothing to clear
    }

    this.db.transaction(() => {
      this.queries.deleteSplitsForTransaction(transactionId);

      const hasTransferSplits = existingSplits.some((s) => !!s.TransferAccountID);
      if (!hasTransferSplits) return;

      const transferId =
        parent.TransferID && parent.TransferID.length > 0
          ? parent.TransferID
          : `split_transfer_${parent.ID}_${parent.Date}`;
      this.queries.deleteTransactionsByTransferID(transferId);
    });
  }
}
