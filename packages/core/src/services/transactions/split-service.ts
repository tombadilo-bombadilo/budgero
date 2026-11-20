import { DatabaseAdapter } from '../../database/interface.js';
import { atomically, getRow, run } from '../../database/sql.js';
import { asMilli, toDecimal, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import { NotFoundError, ValidationError } from '../../types';
import { TransactionQueries } from './queries.js';
import { CurrencyService } from '../currency/index.js';
import { CategoryService } from '../categories/index.js';
import {
  Transaction,
  TransactionSplit,
  type SplitMirrorAmounts,
  type TransactionSplitWithMirror,
} from './types.js';
import { ensureTransferCategory } from './category-helpers.js';
import { TransactionWriteBatch, isBatchRowRef, type BatchRowRef } from './write-batch.js';
import { linesOutOfStep } from './split-amounts.js';
import { convertScaled, getCurrencyScale } from '../../currencies/index.js';
import { isAccountOnBudget } from './transfer-payee.js';

/** The parent fields split handling reads (an existing row or a queued one). */
export interface SplitParent {
  AccountID: number;
  BudgetID: number;
  Date: string;
  Memo?: string | null;
  Payee?: string | null;
  LabelID?: number | null;
  TransferID?: string | null;
  InflowConverted: number;
  OutflowConverted: number;
  InflowNative?: number | null;
  OutflowNative?: number | null;
}

export type SplitInput = Omit<TransactionSplit, 'ID' | 'TransactionID'> & {
  /**
   * Exact amounts for this line's mirror row (a transfer line to an account in
   * another currency than the parent's): what the target account received or
   * sent, as the op carries it. The mirror is written with exactly this native
   * amount and keeps it when the parent changes later (it is pinned); its
   * budget value is the line's (see SPLIT_MIRROR_PINNED), the carried
   * converted amounts only stand in for a line without one. Ignored on other
   * lines; without it the mirror is converted at the parent's date.
   */
  Mirror?: SplitMirrorAmounts | null;
};

/** A mirror row for one transfer split line, converted ahead of the write. */
interface PreparedMirror {
  targetAccountId: number;
  memo: string;
  payee: string;
  inflowOriginal: MilliUnits;
  outflowOriginal: MilliUnits;
  inflowConverted: MilliUnits;
  outflowConverted: MilliUnits;
  /** Budget rate of the row (1 target currency in the budget currency); null in the budget currency. */
  exchangeRate: number | null;
  /** Amounts entered for the line (carried or kept): the row is marked as pinned. */
  pinned: boolean;
  /** The rate is implied by entered amounts: ExchangeRateOverride (pinned rows only). */
  rateOverride: boolean;
}

/**
 * TransferRateOverride value of a split mirror whose amounts were entered
 * (a received amount, saved by a format-7 op). Older builds only ever write
 * 0 or 1 there (transfer rate edits), so 2 is never mistaken for their data.
 *
 * The pin is on the NATIVE amount (what the other account received). Its
 * budget-currency value is its line's, like the received leg of a non-split
 * transfer with typed amounts: the mirror is worth exactly what left the
 * parent for it (in a target account in the budget currency it is simply its
 * native amount). ExchangeRate is the rate the two imply and is marked as
 * overridden (ExchangeRateOverride = 1), so custom-rate and pending-rate
 * re-conversions leave it alone, as they leave such a transfer leg alone.
 * Re-conversions that rewrite every row from native (a budget or account
 * currency change) value it at market like that leg too, until its parent
 * changes again. A direct exchange-rate edit of the mirror re-derives its
 * budget value from the kept native amount.
 */
export const SPLIT_MIRROR_PINNED = 2;

/** Whether a mirror row keeps entered amounts (see SPLIT_MIRROR_PINNED). */
export const isPinnedMirror = (mirror: { TransferRateOverride?: unknown }) =>
  Number(mirror.TransferRateOverride) === SPLIT_MIRROR_PINNED;

/** Error code: no rate converts a split line's received amount to the budget currency. */
export const SPLIT_MIRROR_RATE_MISSING = 'SPLIT_MIRROR_RATE_MISSING';

export class SplitMirrorRateError extends ValidationError {
  constructor(
    public readonly fromCurrency: string,
    public readonly toCurrency: string
  ) {
    super(
      `A ${fromCurrency} to ${toCurrency} rate is required for this split's transfer line.`,
      'rate',
      SPLIT_MIRROR_RATE_MISSING
    );
  }
}

/** `magnitude` scaled by |to| / |from| in exact integer arithmetic (half away from zero). */
export function scaleMagnitude(magnitude: number, from: number, to: number): number {
  if (from === 0 || Math.abs(from) === Math.abs(to)) return magnitude;
  const numerator = BigInt(Math.round(magnitude)) * BigInt(Math.abs(Math.round(to)));
  const denominator = BigInt(Math.abs(Math.round(from)));
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/** The net of a pair of directional amounts. */
const netOf = (inflow: number | null | undefined, outflow: number | null | undefined) =>
  (inflow ?? 0) - (outflow ?? 0);

/** A line's net in account currency (native, or converted for lines saved without it). */
const lineNativeNet = (line: Partial<SplitInput>) =>
  netOf(line.InflowNative ?? line.InflowConverted, line.OutflowNative ?? line.OutflowConverted);

const isMilli = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A mirror row's stored amounts. */
const storedMirrorAmounts = (mirror: Transaction): SplitMirrorAmounts => ({
  InflowNative: asMilli(mirror.InflowNative ?? mirror.InflowConverted ?? 0),
  OutflowNative: asMilli(mirror.OutflowNative ?? mirror.OutflowConverted ?? 0),
  InflowConverted: asMilli(mirror.InflowConverted ?? 0),
  OutflowConverted: asMilli(mirror.OutflowConverted ?? 0),
});

/** Mirror amounts with `nativeMagnitude` / `convertedMagnitude` facing the other way from `lineNet`. */
function mirrorAmountsFor(
  lineNet: number,
  nativeMagnitude: number,
  convertedMagnitude: number
): SplitMirrorAmounts {
  const inflow = lineNet < 0;
  const outflow = lineNet > 0;
  return {
    InflowNative: asMilli(inflow ? nativeMagnitude : 0),
    OutflowNative: asMilli(outflow ? nativeMagnitude : 0),
    InflowConverted: asMilli(inflow ? convertedMagnitude : 0),
    OutflowConverted: asMilli(outflow ? convertedMagnitude : 0),
  };
}

/**
 * Budget rate entered amounts imply (budget value per unit of the account
 * currency), as the rate column shows it. Null in the budget currency.
 */
function impliedBudgetRate(
  amounts: SplitMirrorAmounts,
  currency: string,
  budgetCurrency: string
): number | null {
  if (currency === budgetCurrency) return null;
  const native = Number(amounts.InflowNative) + Number(amounts.OutflowNative);
  const converted = Number(amounts.InflowConverted) + Number(amounts.OutflowConverted);
  if (!(native > 0) || !(converted > 0)) return null;
  const rate =
    (converted / native) * (getCurrencyScale(currency) / getCurrencyScale(budgetCurrency));
  return Number(rate.toFixed(8));
}

/**
 * A pinned mirror's amounts: `mirror`'s native amount, valued at its line's
 * budget-currency magnitude (`mirror`'s own converted amounts stand in for a
 * line without one), or at the native amount itself when the target account
 * is in the budget currency.
 */
function pinnedMirrorAmounts(
  line: Pick<SplitInput, 'InflowConverted' | 'OutflowConverted'>,
  mirror: SplitMirrorAmounts,
  targetInBudgetCurrency: boolean
): SplitMirrorAmounts {
  const nativeNet = netOf(mirror.InflowNative, mirror.OutflowNative);
  const native = Math.abs(nativeNet);
  const lineConverted = Math.abs(netOf(line.InflowConverted, line.OutflowConverted));
  const converted = targetInBudgetCurrency
    ? native
    : lineConverted || Math.abs(netOf(mirror.InflowConverted, mirror.OutflowConverted));
  return mirrorAmountsFor(-nativeNet, native, converted);
}

/** Mirror rows are keyed by their parent and its current date. */
export const splitMirrorTransferId = (parentId: number, date: string) =>
  `split_transfer_${parentId}_${date}`;

/**
 * Pair a parent's existing mirror rows with the mirrors its transfer lines
 * need (`wanted`, in line order): per target account, the n-th line to that
 * account gets the n-th existing mirror there (by ID, i.e. creation order).
 * Lines carry no link to their mirror, so this is the stable, deterministic
 * rule every device applies the same way. Unmatched entries are undefined.
 */
export function matchMirrors<T extends { ID: number; AccountID: number }>(
  existing: readonly T[],
  wanted: readonly { targetAccountId: number }[]
): (T | undefined)[] {
  const queues = new Map<number, T[]>();
  for (const mirror of [...existing].sort((a, b) => a.ID - b.ID)) {
    const queue = queues.get(mirror.AccountID) ?? [];
    queue.push(mirror);
    queues.set(mirror.AccountID, queue);
  }
  return wanted.map((pm) => queues.get(pm.targetAccountId)?.shift());
}

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
    transactionId: number | BatchRowRef,
    splits: SplitInput[],
    // With a batch the lines are only queued; batch.commit() writes them
    // together with the batch's other steps (e.g. the new parent row).
    batch?: TransactionWriteBatch,
    // IDs for the transfer lines' mirror rows, in line order (a redo puts
    // them back under the IDs they first got); missing ones are new rows.
    mirrorIds?: readonly number[]
  ): Promise<void> {
    let parent: SplitParent;
    if (isBatchRowRef(transactionId)) {
      if (!batch) throw new Error('A queued parent needs the batch it was queued in.');
      parent = batch.pendingRow(transactionId);
    } else {
      const row = this.queries.getTransactionByID(transactionId);
      if (!row) throw new NotFoundError('Transaction', transactionId);
      parent = row;
    }

    const preparedSplits = this.prepareLines(parent, splits);
    const preparedMirrors = await this.prepareMirrors(parent, preparedSplits);
    const write = (results: unknown[]) =>
      this.writeSplits(
        TransactionWriteBatch.idOf(results, transactionId),
        parent,
        preparedSplits,
        preparedMirrors,
        mirrorIds
      );
    if (batch) {
      batch.queue(write);
      return;
    }
    atomically(this.db, () => write([]));
  }

  /**
   * IDs of reconciled mirror rows of `parentId` a save of `splits` under
   * `parent` (the parent as it will be) changes: their signed bank (native)
   * amount moves, so they go back to uncleared, or their line is removed or
   * retargeted, so they are deleted. No writes.
   */
  async mirrorsUnlockedBySave(
    parentId: number,
    parent: SplitParent,
    splits: SplitInput[]
  ): Promise<number[]> {
    const existing = this.queries.getSplitMirrorTransactions(parentId);
    if (!existing.some((mirror) => mirror.Reconciled)) return [];
    const prepared = await this.prepareMirrors(parent, this.prepareLines(parent, splits));
    const matched = matchMirrors(existing, prepared);
    const kept = new Set(matched.flatMap((mirror) => (mirror ? [mirror.ID] : [])));
    // Reconciled mirrors of removed or retargeted lines are deleted.
    const removed = existing.filter((mirror) => mirror.Reconciled && !kept.has(mirror.ID));
    const changed = prepared.flatMap((pm, index) => {
      const mirror = matched[index];
      if (!mirror?.Reconciled) return [];
      const moved =
        netOf(
          mirror.InflowNative ?? mirror.InflowConverted,
          mirror.OutflowNative ?? mirror.OutflowConverted
        ) !== netOf(pm.inflowOriginal, pm.outflowOriginal);
      return moved ? [mirror.ID] : [];
    });
    return [...changed, ...removed.map((mirror) => mirror.ID)];
  }

  /**
   * Exact mirror amounts for the lines that come with an entered received
   * (or sent) amount, as the originating device quotes them for an op to
   * carry: `received[index]` is the magnitude in the target account's
   * currency. One entry per line; null for lines without one, lines that are
   * no transfer or whose target shares the parent's currency. The mirror's
   * budget value is its line's when it is written (see SPLIT_MIRROR_PINNED),
   * so no rate is needed: the converted amounts quoted here are only an
   * estimate (the line's own value when it has one, else the market rate at
   * the parent's date, else the native amount) for a line saved without one.
   */
  async quoteMirrorAmounts(
    parent: Pick<SplitParent, 'AccountID' | 'BudgetID' | 'Date'>,
    lines: readonly Pick<
      SplitInput,
      | 'TransferAccountID'
      | 'InflowConverted'
      | 'OutflowConverted'
      | 'InflowNative'
      | 'OutflowNative'
    >[],
    received: readonly (number | null | undefined)[]
  ): Promise<(SplitMirrorAmounts | null)[]> {
    const { account: source, budget } = this.queries.getAccountAndBudget(
      parent.AccountID,
      parent.BudgetID
    );
    return Promise.all(
      lines.map(async (line, index) => {
        const amount = received[index];
        if (!source || !budget || !line.TransferAccountID || !amount || amount <= 0) return null;
        const target = this.accountOf(Number(line.TransferAccountID));
        if (!target || target.Currency === source.Currency) return null;
        const lineNet = lineNativeNet(line);
        if (lineNet === 0) return null;
        const native = asMilli(amount);
        if (target.Currency === budget.DisplayCurrency) {
          return mirrorAmountsFor(lineNet, native, native);
        }
        if (source.Currency === budget.DisplayCurrency) {
          return mirrorAmountsFor(lineNet, native, Math.abs(lineNet));
        }
        const lineConverted = Math.abs(netOf(line.InflowConverted, line.OutflowConverted));
        if (lineConverted > 0) return mirrorAmountsFor(lineNet, native, lineConverted);
        const rate = await this.currencyService.resolveRate(
          target.Currency,
          budget.DisplayCurrency,
          parent.Date,
          parent.BudgetID
        );
        const converted = rate
          ? asMilli(convertScaled(native, rate, target.Currency, budget.DisplayCurrency))
          : native;
        return mirrorAmountsFor(lineNet, native, converted);
      })
    );
  }

  private accountOf(accountId: number) {
    return getRow<{ ID: number; Name: string; Currency: string; OnBudget: boolean | number }>(
      this.db,
      'SELECT ID, Name, Currency, OnBudget FROM accounts WHERE ID = ?',
      accountId
    );
  }

  /**
   * Whether a transfer line from `parentAccountId` to `targetAccountId` may
   * also carry a budget category: money leaving the budget for an off-budget
   * (tracking) account, like a non-split transfer's on-budget leg, can be
   * spending in a category (e.g. a mortgage payment) instead of leaving Ready
   * to Assign. Transfers between on-budget accounts never have one.
   */
  transferLineTakesCategory(parentAccountId: number, targetAccountId: number): boolean {
    const parent = this.accountOf(parentAccountId);
    const target = this.accountOf(targetAccountId);
    return Boolean(parent && target && isAccountOnBudget(parent) && !isAccountOnBudget(target));
  }

  private isTransfersCategory(categoryId: number): boolean {
    return Boolean(
      getRow(
        this.db,
        `SELECT 1 AS Found FROM categories c JOIN category_groups cg ON cg.ID = c.CategoryGroupID
          WHERE c.ID = ? AND cg.Name = 'Transfers'`,
        categoryId
      )
    );
  }

  /**
   * Validate `splits` against `parent` and fill in both representations of
   * every line's amount (see upsertSplits). No writes.
   */
  private prepareLines(parent: SplitParent, splits: SplitInput[]): SplitInput[] {
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
    let preparedSplits: SplitInput[] = splits.map((split) => {
      const line = { ...split, Payee: (split.Payee ?? '').trim() };
      // A transfer line keeps a category only while it goes from an on-budget
      // parent to an off-budget account; the Transfers category means none.
      // Anything else drops it instead of failing: the op's prepare checked
      // it on the originating device, and an account that changed since
      // (e.g. a concurrent on-budget switch) must not make devices disagree.
      if (
        line.CategoryID != null &&
        line.TransferAccountID != null &&
        (this.isTransfersCategory(line.CategoryID) ||
          !this.transferLineTakesCategory(parent.AccountID, Number(line.TransferAccountID)))
      ) {
        line.CategoryID = null;
      }
      return line;
    });
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
      if (!hasCat && !hasTransfer) {
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

    return preparedSplits.map((line) => this.checkedMirror(parent, line));
  }

  /**
   * `line` with its carried mirror amounts checked: kept only on a transfer
   * line to an account in another currency than the parent's, and refused
   * unless they are whole non-negative milliunits that move the other way
   * from the line (one direction, a non-zero bank amount).
   */
  private checkedMirror(parent: SplitParent, line: SplitInput): SplitInput {
    const mirror = line.Mirror;
    if (!mirror) return line.Mirror === undefined ? line : { ...line, Mirror: undefined };
    const source = this.accountOf(parent.AccountID);
    const target = line.TransferAccountID ? this.accountOf(Number(line.TransferAccountID)) : null;
    if (!source || !target || source.Currency === target.Currency) {
      return { ...line, Mirror: undefined };
    }
    const values = [
      mirror.InflowNative,
      mirror.OutflowNative,
      mirror.InflowConverted,
      mirror.OutflowConverted,
    ];
    const lineNet = lineNativeNet(line);
    const nativeNet = netOf(mirror.InflowNative, mirror.OutflowNative);
    const convertedNet = netOf(mirror.InflowConverted, mirror.OutflowConverted);
    const valid =
      values.every(isMilli) &&
      (mirror.InflowNative === 0 || mirror.OutflowNative === 0) &&
      (mirror.InflowConverted === 0 || mirror.OutflowConverted === 0) &&
      lineNet !== 0 &&
      Math.sign(nativeNet) === -Math.sign(lineNet) &&
      Math.sign(convertedNet) === Math.sign(nativeNet);
    if (!valid) {
      throw new ValidationError(
        'The amount received for a split transfer line must be greater than zero.',
        'mirror'
      );
    }
    return line;
  }

  /** Convert the mirror rows for the transfer lines (async, before any write). */
  private async prepareMirrors(
    parent: SplitParent,
    lines: Pick<
      SplitInput,
      | 'TransferAccountID'
      | 'InflowConverted'
      | 'OutflowConverted'
      | 'InflowNative'
      | 'OutflowNative'
      | 'Memo'
      | 'Payee'
      | 'Mirror'
    >[]
  ): Promise<PreparedMirror[]> {
    const { account: sourceAcc, budget } = this.queries.getAccountAndBudget(
      parent.AccountID,
      parent.BudgetID
    );
    const preparedMirrors: PreparedMirror[] = [];
    if (!sourceAcc || !budget) return preparedMirrors;

    for (const s of lines) {
      if (!s.TransferAccountID) continue;

      const targetAccount = getRow<{ ID: number; Currency: string }>(
        this.db,
        'SELECT ID , Currency FROM accounts WHERE ID = ?',
        s.TransferAccountID
      );
      if (!targetAccount) continue;

      // Entered amounts (carried by the op, or kept by a parent change) win,
      // so every device writes the same mirror, valued at its line (see
      // SPLIT_MIRROR_PINNED). The rest convert here.
      if (s.Mirror && targetAccount.Currency !== sourceAcc.Currency) {
        const amounts = pinnedMirrorAmounts(
          s,
          s.Mirror,
          targetAccount.Currency === budget.DisplayCurrency
        );
        const exchangeRate = impliedBudgetRate(
          amounts,
          targetAccount.Currency,
          budget.DisplayCurrency
        );
        preparedMirrors.push({
          targetAccountId: targetAccount.ID,
          memo: s.Memo ?? parent.Memo ?? '',
          payee: s.Payee || parent.Payee || '',
          inflowOriginal: amounts.InflowNative,
          outflowOriginal: amounts.OutflowNative,
          inflowConverted: amounts.InflowConverted,
          outflowConverted: amounts.OutflowConverted,
          exchangeRate,
          pinned: true,
          rateOverride: exchangeRate !== null,
        });
        continue;
      }

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
        exchangeRate:
          targetAccount.Currency === budget.DisplayCurrency
            ? null
            : await this.currencyService.resolveRate(
                targetAccount.Currency,
                budget.DisplayCurrency,
                parent.Date,
                parent.BudgetID
              ),
        pinned: false,
        rateOverride: false,
      });
    }
    return preparedMirrors;
  }

  /** Replace the parent's lines and mirror rows (synchronous; caller holds the transaction). */
  private writeSplits(
    transactionId: number,
    parent: SplitParent,
    preparedSplits: SplitInput[],
    preparedMirrors: PreparedMirror[],
    mirrorIds?: readonly number[]
  ): void {
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

    // 2) Mirror rows for the transfer lines
    this.reconcileMirrors(transactionId, parent, preparedMirrors, { mirrorIds, withText: true });
  }

  /**
   * Bring the parent's mirror rows to `preparedMirrors` (one per transfer
   * line, in line order) in place. Existing mirrors are matched to the lines
   * per target account, in order (see matchMirrors): a matched row keeps its
   * ID, Cleared / Reconciled state, label, category and import provenance and
   * only gets the line's amount, date and key (and memo / payee with
   * `withText`). Like a normal transfer edit syncing its partner leg
   * (TransactionService.preparePartnerSync), a reconciled mirror whose bank
   * amount changes goes back to uncleared; other flags stay. Unmatched old mirrors (line
   * removed or retargeted) are deleted; lines without a match get a new row,
   * under `mirrorIds[index]` when given (a redo) or the next ID otherwise, so
   * every device replaying the op assigns the same IDs.
   */
  private reconcileMirrors(
    parentId: number,
    parent: SplitParent,
    preparedMirrors: PreparedMirror[],
    options: { mirrorIds?: readonly number[]; withText: boolean }
  ): void {
    // Strategy: use a common TransferID for all mirrors of this parent to tie both sides
    const transferId =
      parent.TransferID && parent.TransferID.length > 0
        ? parent.TransferID
        : splitMirrorTransferId(parentId, parent.Date);

    // Existing mirrors, including ones keyed by an older parent date.
    const oldMirrors = this.queries.getSplitMirrorTransactions(parentId);
    const kept = matchMirrors(oldMirrors, preparedMirrors);
    const keptIds = new Set(kept.flatMap((mirror) => (mirror ? [mirror.ID] : [])));
    this.queries.deleteTransactions(
      oldMirrors.filter((mirror) => !keptIds.has(mirror.ID)).map((mirror) => mirror.ID)
    );
    const affectedAccountIds = new Set(oldMirrors.map((mirror) => mirror.AccountID));
    let changed = oldMirrors.length !== keptIds.size;

    for (const [index, pm] of preparedMirrors.entries()) {
      const mirror = kept[index];
      if (mirror) {
        const memo = options.withText ? pm.memo : mirror.Memo;
        const payee = options.withText ? pm.payee || null : (mirror.Payee ?? null);
        const inStep =
          mirror.Date === parent.Date &&
          mirror.TransferID === transferId &&
          mirror.InflowNative === pm.inflowOriginal &&
          mirror.OutflowNative === pm.outflowOriginal &&
          mirror.InflowConverted === pm.inflowConverted &&
          mirror.OutflowConverted === pm.outflowConverted &&
          mirror.Memo === memo &&
          (mirror.Payee ?? null) === payee &&
          (mirror.ExchangeRate ?? null) === pm.exchangeRate &&
          pm.pinned === isPinnedMirror(mirror) &&
          (!pm.pinned || Boolean(mirror.ExchangeRateOverride) === pm.rateOverride);
        if (inStep) continue;
        // Entered amounts pin the row (and the rate they imply) and other
        // amounts unpin it; a flag older builds wrote (0 / 1, transfer rate
        // edits) is left as it is, and so is a rate override on a row that was
        // no pin. (SET expressions read the row's old TransferRateOverride.)
        run(
          this.db,
          `UPDATE transactions
              SET Date = ?, TransferID = ?, InflowNative = ?, OutflowNative = ?,
                  InflowConverted = ?, OutflowConverted = ?, Memo = ?, Payee = ?, ExchangeRate = ?,
                  ExchangeRateOverride = CASE WHEN ${pm.pinned ? 1 : 0}
                    THEN ${pm.rateOverride ? 1 : 0}
                    WHEN TransferRateOverride = ${SPLIT_MIRROR_PINNED} THEN 0
                    ELSE ExchangeRateOverride END,
                  TransferRateOverride = CASE WHEN ${pm.pinned ? 1 : 0} THEN ${SPLIT_MIRROR_PINNED}
                    WHEN TransferRateOverride = ${SPLIT_MIRROR_PINNED} THEN 0
                    ELSE TransferRateOverride END
            WHERE ID = ?`,
          parent.Date,
          transferId,
          pm.inflowOriginal,
          pm.outflowOriginal,
          pm.inflowConverted,
          pm.outflowConverted,
          memo,
          payee,
          pm.exchangeRate,
          mirror.ID
        );
        this.queries.unreconcileIfNativeChanged(mirror.ID, mirror);
        changed = true;
        continue;
      }

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
        pm.exchangeRate,
        parent.LabelID ?? null,
        pm.rateOverride,
        false,
        false,
        options.mirrorIds?.[index]
      );
      if (pm.pinned) {
        run(
          this.db,
          'UPDATE transactions SET TransferRateOverride = ? WHERE ID = ?',
          SPLIT_MIRROR_PINNED,
          mirrorId
        );
      }

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
      changed = true;
    }

    // A lines save always recalculates the mirror accounts (as replacing them
    // did, which also repairs balances older builds left off); a parent
    // change only when a mirror moved.
    for (const pm of preparedMirrors) affectedAccountIds.add(pm.targetAccountId);
    if (changed || options.withText) {
      this.queries.recalculateBalancesForAccounts([...affectedAccountIds]);
    }
  }

  /**
   * Keep a split parent's lines and mirror rows in step with a change to the
   * parent itself (amount, date, account or rate): lines are rescaled to the
   * parent's new amounts (see split-amounts.ts) and mirrors are re-converted
   * at the parent's date and re-keyed to it. Conversions run now; the returned
   * step writes everything and must run in the same DB transaction as the
   * parent's own update. Null when the parent has no split lines.
   */
  async prepareParentChange(parentId: number, after: SplitParent): Promise<(() => void) | null> {
    const lines = this.queries.getSplitsForTransaction(parentId);
    if (lines.length === 0) return null;
    const rescaled = linesOutOfStep(lines, after);
    const nextLines = rescaled.length ? rescaled : lines;
    const hasTransferLines = nextLines.some((line) => line.TransferAccountID);
    const mirrorLines = [...nextLines].sort((a, b) => a.ID - b.ID);
    const preparedMirrors = hasTransferLines
      ? await this.prepareMirrors(
          after,
          this.keepPinnedMirrors(parentId, after, mirrorLines, lines)
        )
      : [];

    return () => {
      for (const line of rescaled) this.queries.updateSplitLineAmounts(line);
      if (hasTransferLines) this.refreshMirrors(parentId, after, preparedMirrors);
    };
  }

  /**
   * `lines` (sorted by ID) with the amounts their pinned mirrors (an entered
   * received amount) keep through a parent change: unchanged while the line
   * keeps its amount (a date or rate edit), scaled with the line when a new
   * parent total rescales it (150 -> 300 doubles the received amount too;
   * the budget value is the line's anyway, see SPLIT_MIRROR_PINNED),
   * the direction following the line. A line that drops to zero leaves the
   * mirror as it is, so its amount comes back with the line. A move of the
   * parent to an account in another currency keeps the amounts as they are
   * (only the direction follows). Only mirrors still in another currency
   * than the parent's stay pinned: a move into the mirror's own currency
   * unpins it and it then mirrors the line exactly (same currency, no rate),
   * like any same-currency transfer line. Integer arithmetic on stored data only, so every device
   * replaying the edit writes the same amounts.
   */
  private keepPinnedMirrors(
    parentId: number,
    after: SplitParent,
    lines: readonly TransactionSplit[],
    before: readonly TransactionSplit[]
  ): SplitInput[] {
    const mirrors = this.queries.getSplitMirrorTransactions(parentId);
    if (!mirrors.some(isPinnedMirror)) return [...lines];
    const beforeNet = new Map(before.map((line) => [line.ID, lineNativeNet(line)]));
    const source = this.accountOf(after.AccountID);
    // Line amounts compare only in one currency: a move to an account in
    // another currency converts them, and the received amount must not
    // follow that rate (the parent row is still unwritten here).
    const previous = this.queries.getTransactionByID(parentId);
    const sameCurrency =
      Boolean(previous && source) &&
      this.accountOf(previous!.AccountID)?.Currency === source!.Currency;
    const scale = (magnitude: number, line: TransactionSplit, lineNet: number) =>
      sameCurrency
        ? scaleMagnitude(magnitude, beforeNet.get(line.ID) ?? lineNet, lineNet)
        : magnitude;
    const transfer = lines.filter(
      (line) => line.TransferAccountID && this.accountOf(Number(line.TransferAccountID))
    );
    const matched = matchMirrors(
      mirrors,
      transfer.map((line) => ({ targetAccountId: Number(line.TransferAccountID) }))
    );
    const kept = new Map<number, SplitMirrorAmounts>();
    transfer.forEach((line, index) => {
      const mirror = matched[index];
      if (!mirror || !isPinnedMirror(mirror) || !source) return;
      if (this.accountOf(mirror.AccountID)?.Currency === source.Currency) return;
      const stored = storedMirrorAmounts(mirror);
      const lineNet = lineNativeNet(line);
      // A line that drops to zero leaves the entered amount as it is (like a
      // transfer leg edited to zero keeps the partner), so it comes back when
      // the line gets an amount again.
      kept.set(
        line.ID,
        lineNet === 0
          ? stored
          : mirrorAmountsFor(
              lineNet,
              scale(Math.abs(netOf(stored.InflowNative, stored.OutflowNative)), line, lineNet),
              scale(Math.abs(netOf(stored.InflowConverted, stored.OutflowConverted)), line, lineNet)
            )
      );
    });
    return lines.map((line) => (kept.has(line.ID) ? { ...line, Mirror: kept.get(line.ID) } : line));
  }

  /**
   * A parent's lines with their transfer mirrors' stored state attached
   * (amounts, pinned, reconciled), matched the way saves match them.
   */
  getSplitsWithMirrors(parentId: number): TransactionSplitWithMirror[] {
    const lines = this.queries.getSplitsForTransaction(parentId);
    const transfer = [...lines]
      .sort((a, b) => a.ID - b.ID)
      .filter((line) => line.TransferAccountID && this.accountOf(Number(line.TransferAccountID)));
    if (!transfer.length) return lines;
    const matched = matchMirrors(
      this.queries.getSplitMirrorTransactions(parentId),
      transfer.map((line) => ({ targetAccountId: Number(line.TransferAccountID) }))
    );
    const byLine = new Map<number, Transaction>();
    transfer.forEach((line, index) => {
      const mirror = matched[index];
      if (mirror) byLine.set(line.ID, mirror);
    });
    return lines.map((line) => {
      const mirror = byLine.get(line.ID);
      if (!mirror) return line;
      return {
        ...line,
        Mirror: storedMirrorAmounts(mirror),
        MirrorPinned: isPinnedMirror(mirror),
        MirrorReconciled: Boolean(mirror.Reconciled),
      };
    });
  }

  /** Whether any of these split parents has a pinned mirror (an entered received amount). */
  hasPinnedMirrors(parentIds: readonly number[]): boolean {
    return parentIds.some((id) => this.queries.getSplitMirrorTransactions(id).some(isPinnedMirror));
  }

  /**
   * Bring existing mirror rows to `preparedMirrors` in place after a parent
   * change (same IDs, so history entries that reference them stay valid).
   * Memo and payee are left as they are.
   */
  private refreshMirrors(
    parentId: number,
    parent: SplitParent,
    preparedMirrors: PreparedMirror[]
  ): void {
    this.reconcileMirrors(parentId, parent, preparedMirrors, { withText: false });
  }

  /** IDs of a parent's split-transfer mirror rows, in the order they were created. */
  getSplitMirrorTransactionIds(parentId: number): number[] {
    return this.queries
      .getSplitMirrorTransactions(parentId)
      .map((mirror: Transaction) => mirror.ID)
      .sort((a: number, b: number) => a - b);
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
    this.clearSplitsNow(transactionId);
  }

  /** clearSplits, synchronously (usable as a write-batch step). */
  clearSplitsNow(transactionId: number): void {
    const parent = this.queries.getTransactionByID(transactionId);
    if (!parent) throw new NotFoundError('Transaction', transactionId);

    const existingSplits = this.queries.getSplitsForTransaction(transactionId);
    if (existingSplits.length === 0) {
      return; // Nothing to clear
    }

    atomically(this.db, () => {
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
