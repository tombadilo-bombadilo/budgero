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

    // Converted values drive budgeting and are therefore the reconciliation
    // anchor. Editors working in an account register may instead submit native
    // values; project those onto the parent's exact stored conversion so line
    // rounding can never make an otherwise balanced split fail.
    const parentNet = (parent.InflowConverted || 0) - (parent.OutflowConverted || 0);
    const parentNativeNet =
      (parent.InflowNative ?? parent.InflowConverted ?? 0) -
      (parent.OutflowNative ?? parent.OutflowConverted ?? 0);
    let preparedSplits = splits.map((split) => ({
      ...split,
      Payee: (split.Payee ?? '').trim(),
    }));
    const hasNativeAmounts =
      preparedSplits.length > 0 &&
      preparedSplits.every((split) => split.InflowNative != null || split.OutflowNative != null);

    if (hasNativeAmounts) {
      const nativeNets = preparedSplits.map(
        (split) => (split.InflowNative ?? 0) - (split.OutflowNative ?? 0)
      );
      const splitsNativeNet = nativeNets.reduce((sum, amount) => sum + amount, 0);

      if (splitsNativeNet !== parentNativeNet) {
        throw new Error(
          `Split amounts must sum to parent total. Remaining: ${toDecimal(asMilli(parentNativeNet - splitsNativeNet))}`
        );
      }

      if (parentNativeNet !== 0) {
        const convertedNets = nativeNets.map((amount) =>
          Math.round((amount * parentNet) / parentNativeNet)
        );
        const convertedTotal = convertedNets.reduce((sum, amount) => sum + amount, 0);
        const remainder = parentNet - convertedTotal;

        if (remainder !== 0) {
          let remainderIndex = 0;
          for (let index = 1; index < nativeNets.length; index++) {
            if (Math.abs(nativeNets[index]) > Math.abs(nativeNets[remainderIndex])) {
              remainderIndex = index;
            }
          }
          convertedNets[remainderIndex] += remainder;
        }

        preparedSplits = preparedSplits.map((split, index) => {
          const convertedNet = asMilli(convertedNets[index]);
          return {
            ...split,
            InflowConverted: convertedNet > 0 ? convertedNet : ZERO_MILLI,
            OutflowConverted: convertedNet < 0 ? asMilli(-Number(convertedNet)) : ZERO_MILLI,
          };
        });
      }
    }

    let splitsNet = 0;
    for (const s of preparedSplits) {
      // Basic validation: exactly one of CategoryID or TransferAccountID may be set
      const hasCat = s.CategoryID != null && s.CategoryID !== undefined;
      const hasTransfer = s.TransferAccountID != null && s.TransferAccountID !== undefined;
      if ((hasCat && hasTransfer) || (!hasCat && !hasTransfer)) {
        throw new Error(
          'Each split must have either CategoryID or TransferAccountID (exclusively)'
        );
      }
      splitsNet += (s.InflowConverted || 0) - (s.OutflowConverted || 0);
    }

    // Integer milliunits compare exactly — splits must reconcile to the milliunit
    if (splitsNet !== parentNet) {
      throw new Error(
        `Split amounts must sum to parent total. Remaining: ${toDecimal(asMilli(parentNet - splitsNet))}`
      );
    }

    // Budget-currency editors use the inverse projection so every newly saved
    // split set has both representations, including rows created by older UI
    // paths that only knew about converted amounts.
    if (!hasNativeAmounts && parentNet !== 0) {
      const convertedNets = preparedSplits.map(
        (split) => (split.InflowConverted ?? 0) - (split.OutflowConverted ?? 0)
      );
      const nativeNets = convertedNets.map((amount) =>
        Math.round((amount * parentNativeNet) / parentNet)
      );
      const nativeTotal = nativeNets.reduce((sum, amount) => sum + amount, 0);
      const remainder = parentNativeNet - nativeTotal;

      if (remainder !== 0) {
        let remainderIndex = 0;
        for (let index = 1; index < convertedNets.length; index++) {
          if (Math.abs(convertedNets[index]) > Math.abs(convertedNets[remainderIndex])) {
            remainderIndex = index;
          }
        }
        nativeNets[remainderIndex] += remainder;
      }

      preparedSplits = preparedSplits.map((split, index) => {
        const nativeNet = asMilli(nativeNets[index]);
        return {
          ...split,
          InflowNative: nativeNet > 0 ? nativeNet : ZERO_MILLI,
          OutflowNative: nativeNet < 0 ? asMilli(-Number(nativeNet)) : ZERO_MILLI,
        };
      });
    }

    // Upsert atomically: delete old, insert new
    // Precompute mirror rows (async conversions) before entering sync transaction
    const { account: sourceAcc, budget } = this.queries.getAccountAndBudget(
      parent.AccountID,
      parent.BudgetID
    );

    type PreparedMirror = {
      targetAccountId: number;
      memo: string;
      payee: string;
      inflowOriginal: MilliUnits;
      outflowOriginal: MilliUnits;
      inflowConverted: MilliUnits;
      outflowConverted: MilliUnits;
    };
    const preparedMirrors: PreparedMirror[] = [];

    if (sourceAcc && budget) {
      for (const s of preparedSplits) {
        if (!s.TransferAccountID) continue;

        const targetAccount = getRow<{ ID: number; Currency: string }>(
          this.db,
          'SELECT ID , Currency FROM accounts WHERE ID = ?',
          s.TransferAccountID
        );
        if (!targetAccount) continue;

        const sourceNetOriginal =
          (s.InflowNative ?? s.InflowConverted ?? 0) - (s.OutflowNative ?? s.OutflowConverted ?? 0);
        const mirrorNetOriginalInTarget = await this.currencyService.convertAmount(
          asMilli(-sourceNetOriginal),
          sourceAcc.Currency,
          targetAccount.Currency,
          parent.Date,
          parent.BudgetID
        );
        const mirrorInflowOriginal =
          mirrorNetOriginalInTarget > 0 ? mirrorNetOriginalInTarget : ZERO_MILLI;
        const mirrorOutflowOriginal =
          mirrorNetOriginalInTarget < 0 ? asMilli(-Number(mirrorNetOriginalInTarget)) : ZERO_MILLI;

        const mirrorInflowConverted = await this.currencyService.convertAmount(
          mirrorInflowOriginal,
          targetAccount.Currency,
          budget.DisplayCurrency,
          parent.Date,
          parent.BudgetID
        );
        const mirrorOutflowConverted = await this.currencyService.convertAmount(
          mirrorOutflowOriginal,
          targetAccount.Currency,
          budget.DisplayCurrency,
          parent.Date,
          parent.BudgetID
        );

        preparedMirrors.push({
          targetAccountId: targetAccount.ID,
          memo: s.Memo ?? parent.Memo ?? '',
          payee: s.Payee || parent.Payee || '',
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
      for (const s of preparedSplits) {
        const row: Omit<TransactionSplit, 'ID'> = {
          TransactionID: transactionId,
          CategoryID: s.CategoryID ?? null,
          TransferAccountID: s.TransferAccountID ?? null,
          Memo: s.Memo ?? parent.Memo ?? '',
          Payee: s.Payee ?? '',
          InflowConverted: s.InflowConverted ?? 0,
          OutflowConverted: s.OutflowConverted ?? 0,
          InflowNative: s.InflowNative ?? null,
          OutflowNative: s.OutflowNative ?? null,
          PairID: s.PairID ?? null,
          OrderIndex: s.OrderIndex ?? orderIndex,
        };
        this.queries.insertSplitLine(row);
        if (row.Payee) this.queries.insertPayee(parent.BudgetID, row.Payee);
        orderIndex++;
      }

      // 2) Mirror handling for transfer split lines
      // Strategy: use a common TransferID for all mirrors of this parent to tie both sides
      const transferId =
        parent.TransferID && parent.TransferID.length > 0
          ? parent.TransferID
          : `split_transfer_${parent.ID}_${parent.Date}`;

      // Clear any previous mirrors for this parent (including ones keyed by an
      // older parent date). Their balance effect is undone by the recalculation
      // below, together with the new mirrors' target accounts.
      const oldMirrors = this.queries.getSplitMirrorTransactions(parent.ID);
      this.queries.deleteTransactions(oldMirrors.map((mirror) => mirror.ID));
      const affectedAccountIds = new Set(oldMirrors.map((mirror) => mirror.AccountID));

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
          pm.payee || null,
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
        affectedAccountIds.add(pm.targetAccountId);
      }

      this.queries.recalculateBalancesForAccounts([...affectedAccountIds]);
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

      // Remove the mirrors and undo their effect on the target accounts.
      const mirrors = this.queries.getSplitMirrorTransactions(parent.ID);
      this.queries.deleteTransactions(mirrors.map((mirror) => mirror.ID));
      this.queries.recalculateBalancesForAccounts(mirrors.map((mirror) => mirror.AccountID));
    });
  }
}
