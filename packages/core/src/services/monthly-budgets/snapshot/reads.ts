/**
 * Snapshot-backed versions of the MonthlyBudgetQueries reads that used to scan
 * all of history. Same signatures and result shapes (key order, Map insertion
 * order, rounding) as the full queries in ../queries.ts, which stay the
 * fallback and the reference for BUDGERO_SNAPSHOT_VERIFY. Cheap month-bounded
 * or table-small reads are delegated to the full queries unchanged.
 */
import type { DatabaseAdapter } from '../../../database/interface.js';
import { allRows, getRow } from '../../../database/sql.js';
import { asMilli } from '../../../money/index.js';
import type { MonthlyBudgetQueries } from '../queries.js';
import type { GetMonthlyBudgetRow, ReadyToAssignBreakdown } from '../types.js';
import type { RtaMode } from '../../budgets/types.js';
import {
  GROUP_CC_PAYMENTS,
  GROUP_INCOME,
  GROUP_TRANSFERS,
  GROUP_UNCATEGORIZED,
  activityByKindAt,
  activityInMonth,
  availableThrough,
  cashAdvanceDays,
  ccRefundsFlat,
  ccRefundsThrough,
  ccSpendingAt,
  overspendBefore,
  rollforwardAt,
  sumAccountsOver,
  sumAssignedOver,
  sumCategoriesOver,
  toMonthIndex,
  type CategoryKey,
  type CategoryNames,
  type MonthlyFold,
  type RollforwardAt,
} from './model.js';
import type { SnapshotHandle } from './store.js';

/** The reads getMonthlyBudget / Ready to Assign are built from (full or snapshot). */
export type MonthlyBudgetSource = Pick<
  MonthlyBudgetQueries,
  | 'getMonthlyBudget'
  | 'getRtaMode'
  | 'getActivityByAccountKind'
  | 'getCCPaymentAdjustments'
  | 'getCCSpendingByCategoryAndAccount'
  | 'getCCRefundsByCategoryAndAccount'
  | 'getCCAccountPaymentCategoryMap'
  | 'getCCAccountBalances'
  | 'getAssignedPriorToMonthByCategory'
  | 'computeMonthlyRollforward'
  | 'readyToAssign'
  | 'readyToAssignMonthly'
  | 'readyToAssignMonthlyBatch'
>;

// Category / group rows of getMonthlyBudget without the history sums.
const BUDGET_ROWS_SQL = `
  SELECT
    COALESCE(c.Name, '') AS Category,
    COALESCE(c.ID, -1) as CategoryID,
    COALESCE(c.FundingPriority, 3) AS FundingPriority,
    cg.Name AS CategoryGroup,
    cg.ID as CategoryGroupID,
    c.ID AS SnapshotCategoryID
  FROM category_groups cg
  LEFT JOIN categories c ON c.CategoryGroupID = cg.ID
  WHERE cg.Name != 'Income' and cg.Name != 'Transfers' and cg.Name != 'Uncategorized' and cg.BudgetID = ?1
  ORDER BY CASE WHEN cg.Name = 'Hidden Categories' THEN 1 ELSE 0 END, cg.Position, cg.Name, c.Position, c.Name
`;

// readyToAssign's date-bounded sums, restricted to Month >= ?3 (the snapshot
// holds every earlier month; see readyToAssign below).
const RECENT_INCOME_SQL = `
  SELECT IFNULL(SUM(t.InflowConverted - t.OutflowConverted), 0) as total_income
  FROM category_groups cg
  CROSS JOIN categories c ON c.CategoryGroupID = cg.ID
  CROSS JOIN transactions t ON t.CategoryID = c.ID
  INNER JOIN accounts acc ON t.AccountID = acc.ID
  WHERE cg.Name = 'Income'
    AND +t.BudgetID = ?1
    AND acc.OnBudget = TRUE
    AND (t.TransferID IS NULL OR t.TransferID = '')
    AND DATE(t.Date) <= DATE(?2)
    AND t.Month >= ?3
`;
const RECENT_TRANSFERS_SQL = `
  SELECT
    IFNULL(SUM(CASE WHEN t.OutflowConverted > 0 THEN t.OutflowConverted ELSE 0 END), 0) AS off_budget,
    IFNULL(SUM(CASE WHEN t.InflowConverted > 0 THEN t.InflowConverted ELSE 0 END), 0) AS in_budget
  FROM transactions t
  INNER JOIN accounts src ON t.AccountID = src.ID
  WHERE t.BudgetID = ?1 AND t.Month >= ?3
    AND t.TransferID <> ''
    AND +t.CategoryID IN (
      SELECT c.ID FROM categories c JOIN category_groups cg ON c.CategoryGroupID = cg.ID
      WHERE cg.Name = 'Transfers')
    AND src.OnBudget = TRUE
    AND t.ExcludeFromReadyToAssign = FALSE
    AND DATE(t.Date) <= DATE(?2)
    AND EXISTS (SELECT 1 FROM transactions mirror JOIN accounts oa ON oa.ID = mirror.AccountID
      WHERE mirror.TransferID = t.TransferID AND mirror.TransferID != ''
        AND oa.OnBudget = FALSE AND LOWER(oa.Type) NOT IN ('credit', 'loan', 'mortgage'))
`;
const REVALUATIONS_SQL = `
  SELECT IFNULL(SUM(r.DeltaConverted), 0) as total_revaluations
  FROM account_revaluations r
  INNER JOIN accounts a ON r.AccountID = a.ID
  WHERE r.BudgetID = ?1
    AND a.OnBudget = TRUE
    AND DATE(r.Date) <= DATE(?2)
`;
const MONTHLY_REVALUATIONS_SQL = `
  SELECT strftime('%Y-%m', r.Date) as Month, IFNULL(SUM(r.DeltaConverted), 0) as total
  FROM account_revaluations r
  INNER JOIN accounts a ON r.AccountID = a.ID
  WHERE r.BudgetID = ?1 AND a.OnBudget = TRUE AND strftime('%Y-%m', r.Date) <= ?2
  GROUP BY strftime('%Y-%m', r.Date)
`;

const shiftMonthIndex = (index: number, delta: number) => index + delta;

export class SnapshotMonthlyBudgetQueries implements MonthlyBudgetSource {
  private cardMap: Map<number, number> | null = null;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly full: MonthlyBudgetQueries,
    private readonly snap: SnapshotHandle
  ) {}

  private get data() {
    return this.snap.data;
  }

  private groupOf(cat: CategoryKey): string | undefined {
    return cat === null ? undefined : this.snap.groupMap().get(cat);
  }

  private inGroup = (name: string) => (cat: CategoryKey) => this.groupOf(cat) === name;

  private monthIndex(month: string): number {
    const index = toMonthIndex(month);
    if (index < 0) throw new Error(`Budget snapshot: bad month ${month}`);
    return index;
  }

  private foldFor(budgetId: number): MonthlyFold {
    return this.snap.fold(this.getCCAccountPaymentCategoryMap(budgetId));
  }

  // -------------------------------------------------------------- delegated

  getRtaMode(budgetId: number): RtaMode {
    return this.full.getRtaMode(budgetId);
  }

  getCCAccountPaymentCategoryMap(budgetId: number): Map<number, number> {
    this.cardMap ??= this.full.getCCAccountPaymentCategoryMap(budgetId);
    return new Map(this.cardMap);
  }

  getAssignedPriorToMonthByCategory(categoryIds: number[], month: string): Map<number, number> {
    return this.full.getAssignedPriorToMonthByCategory(categoryIds, month);
  }

  // -------------------------------------------------------------- getMonthlyBudget parts

  getMonthlyBudget(month: string, budgetId: number): GetMonthlyBudgetRow[] {
    const index = this.monthIndex(month);
    const available = this.snap.memo(`available:${index}`, () =>
      availableThrough(this.data, index)
    );
    const activity = activityInMonth(this.data, index);
    const assigned = this.data.assigned.get(index);
    const rows = allRows<
      Omit<GetMonthlyBudgetRow, 'Assigned' | 'Activity' | 'Available'> & {
        SnapshotCategoryID: number | null;
      }
    >(this.db, BUDGET_ROWS_SQL, budgetId);
    return rows.map((r) => {
      const id = r.SnapshotCategoryID;
      return {
        Category: r.Category,
        CategoryID: r.CategoryID,
        FundingPriority: r.FundingPriority,
        CategoryGroup: r.CategoryGroup,
        CategoryGroupID: r.CategoryGroupID,
        Assigned: asMilli(id === null ? 0 : (assigned?.get(id) ?? 0)),
        Activity: asMilli(id === null ? 0 : (activity.get(id) ?? 0)),
        Available: asMilli(id === null ? 0 : (available.get(id) ?? 0)),
      } as GetMonthlyBudgetRow;
    });
  }

  getActivityByAccountKind(
    month: string,
    budgetId: number,
    monthly = false
  ): Map<number, { cash: number; credit: number }> {
    const index = this.monthIndex(month);
    return activityByKindAt(this.data, monthly ? this.foldFor(budgetId) : null, index);
  }

  getCCPaymentAdjustments(
    month: string,
    budgetId: number
  ): Map<number, { payments: number; priorPayments: number }> {
    const index = this.monthIndex(month);
    const result = new Map<number, { payments: number; priorPayments: number }>();
    const ccAccounts = allRows<{ ID: number; Metadata: string }>(
      this.db,
      `
      SELECT ID, Metadata
      FROM accounts
      WHERE BudgetID = ? AND LOWER(Type) = 'credit' AND Metadata IS NOT NULL
    `,
      budgetId
    );
    const current = this.data.tx.get(index)?.cardPayments;
    const prior = this.snap.memo(`cardPaymentsPrior:${index}`, () =>
      sumAccountsOver(this.data, (m) => m.cardPayments, -Infinity, index - 1)
    );
    for (const cc of ccAccounts) {
      let ccPaymentCategoryId: number | undefined;
      try {
        const metadata = JSON.parse(cc.Metadata || '{}');
        ccPaymentCategoryId = metadata.cc_payment_category_id;
      } catch {
        continue;
      }
      if (!ccPaymentCategoryId) continue;
      const existing = result.get(ccPaymentCategoryId) || { payments: 0, priorPayments: 0 };
      result.set(ccPaymentCategoryId, {
        payments: existing.payments + (current?.get(cc.ID) || 0),
        priorPayments: existing.priorPayments + (prior.get(cc.ID) || 0),
      });
    }
    return result;
  }

  getCCSpendingByCategoryAndAccount(
    month: string,
    _budgetId: number
  ): Map<number, Map<number, { current: number; prior: number }>> {
    const index = this.monthIndex(month);
    const excluded = new Set([
      GROUP_INCOME,
      GROUP_TRANSFERS,
      GROUP_UNCATEGORIZED,
      GROUP_CC_PAYMENTS,
    ]);
    return ccSpendingAt(this.data, index, (cat) => {
      const group = this.groupOf(cat);
      return group !== undefined && !excluded.has(group);
    });
  }

  getCCRefundsByCategoryAndAccount(
    month: string,
    _budgetId: number
  ): Map<number, Map<number, number>> {
    const index = this.monthIndex(month);
    const excluded = new Set([
      GROUP_INCOME,
      GROUP_TRANSFERS,
      GROUP_UNCATEGORIZED,
      GROUP_CC_PAYMENTS,
    ]);
    const keep = (cat: CategoryKey) => {
      const group = this.groupOf(cat);
      return group !== undefined && !excluded.has(group);
    };
    const flat = this.snap.txMemo('ccRefundsFlat', () => ccRefundsFlat(this.data, keep));
    return this.snap.txMemo(`ccRefunds:${index}`, () => ccRefundsThrough(flat, index));
  }

  getCCAccountBalances(month: string, _budgetId: number): Map<number, number> {
    const index = this.monthIndex(month);
    return new Map(
      this.snap.memo(`cardNet:${index}`, () =>
        sumAccountsOver(this.data, (m) => m.cardNet, -Infinity, index)
      )
    );
  }

  computeMonthlyRollforward(budgetId: number, month: string): RollforwardAt {
    return rollforwardAt(
      this.foldFor(budgetId),
      this.monthIndex(month),
      this.categoryNames(budgetId)
    );
  }

  private categoryNames(budgetId: number): CategoryNames {
    const names: CategoryNames = new Map();
    for (const r of allRows<{ ID: number; Name: string; GroupName: string }>(
      this.db,
      `
      SELECT c.ID, c.Name, cg.Name AS GroupName
      FROM categories c
      JOIN category_groups cg ON cg.ID = c.CategoryGroupID
      WHERE c.BudgetID = ?
    `,
      budgetId
    ))
      names.set(r.ID, { name: r.Name, groupName: r.GroupName });
    return names;
  }

  // -------------------------------------------------------------- Ready to Assign

  /**
   * Cumulative RTA as of `asOfDate`. Complete months before the previous month
   * come from the snapshot (every row there is dated <= asOfDate: a date
   * normalises at most a few days forward, and rows without a valid DATE make
   * the budget fall back); the previous and current months are summed live
   * with the full query's `DATE(t.Date) <= DATE(asOfDate)` bound.
   */
  readyToAssign(budgetId: number, asOfDate: string): ReadyToAssignBreakdown {
    const today = this.monthIndex(asOfDate.slice(0, 7));
    const liveFrom = shiftMonthIndex(today, -1);
    const liveFromLabel = monthLabelOf(liveFrom);

    const snapIncome = this.snap.memo(`rtaIncome:${liveFrom}`, () =>
      sumCategoriesOver(
        this.data,
        (m) => m.income,
        -Infinity,
        liveFrom - 1,
        this.inGroup(GROUP_INCOME)
      )
    );
    const snapOff = this.snap.memo(`rtaOff:${liveFrom}`, () =>
      sumCategoriesOver(
        this.data,
        (m) => m.offBudgetTransfers,
        -Infinity,
        liveFrom - 1,
        this.inGroup(GROUP_TRANSFERS)
      )
    );
    const snapIn = this.snap.memo(`rtaIn:${liveFrom}`, () =>
      sumCategoriesOver(
        this.data,
        (m) => m.inBudgetTransfers,
        -Infinity,
        liveFrom - 1,
        this.inGroup(GROUP_TRANSFERS)
      )
    );
    const recentIncome = getRow<{ total_income: number }>(
      this.db,
      RECENT_INCOME_SQL,
      budgetId,
      asOfDate,
      liveFromLabel
    );
    const recentTransfers = getRow<{ off_budget: number; in_budget: number }>(
      this.db,
      RECENT_TRANSFERS_SQL,
      budgetId,
      asOfDate,
      liveFromLabel
    );
    const totalIncome = snapIncome + (recentIncome?.total_income ?? 0);
    const totalAssignments = this.snap.memo('rtaAssignments', () =>
      sumAssignedOver(this.data, -Infinity, Infinity)
    );
    // split-transfer legs to / from off-budget accounts, dated up to today
    const legs = this.snap.txMemo('splitLegs', () => {
      const all: { day: string; off: number; inb: number }[] = [];
      for (const tx of this.data.tx.values()) all.push(...tx.splitLegs);
      return all;
    });
    let splitOff = 0;
    let splitIn = 0;
    for (const leg of legs)
      if (leg.day <= asOfDate) {
        splitOff += leg.off;
        splitIn += leg.inb;
      }
    const totalOffBudgetTransfers = snapOff + (recentTransfers?.off_budget ?? 0) + splitOff;
    const totalInBudgetTransfers = snapIn + (recentTransfers?.in_budget ?? 0) + splitIn;
    const totalRevaluations =
      getRow<{ total_revaluations: number }>(this.db, REVALUATIONS_SQL, budgetId, asOfDate)
        ?.total_revaluations ?? 0;

    const advances = this.snap.txMemo('cashAdvanceDays', () =>
      cashAdvanceDays(this.data, this.snap.groupMap())
    );
    let totalDebtInflows = 0;
    for (let i = 0; i < advances.day.length; i++)
      if (advances.day[i] <= asOfDate) totalDebtInflows += advances.amount[i];

    const readyToAssign =
      totalIncome -
      totalAssignments -
      totalOffBudgetTransfers +
      totalInBudgetTransfers +
      totalDebtInflows +
      totalRevaluations;

    return {
      mode: 'cumulative',
      month: asOfDate,
      income: asMilli(totalIncome),
      assignments: asMilli(totalAssignments),
      futureAssignments: asMilli(0),
      offBudgetTransfers: asMilli(totalOffBudgetTransfers),
      inBudgetTransfers: asMilli(totalInBudgetTransfers),
      debtInflows: asMilli(totalDebtInflows),
      revaluations: asMilli(totalRevaluations),
      priorCashOverspend: asMilli(0),
      readyToAssign: asMilli(readyToAssign),
    };
  }

  readyToAssignMonthly(budgetId: number, month: string): ReadyToAssignBreakdown {
    const result = this.readyToAssignMonthlyBatch(budgetId, [month]).get(month);
    if (!result) {
      throw new Error(`Failed to calculate monthly Ready to Assign for ${month}`);
    }
    return result;
  }

  readyToAssignMonthlyBatch(
    budgetId: number,
    months: string[]
  ): Map<string, ReadyToAssignBreakdown> {
    const result = new Map<string, ReadyToAssignBreakdown>();
    if (months.length === 0) return result;
    const maxMonth = months.reduce((max, m) => (m > max ? m : max), months[0]);
    const fold = this.foldFor(budgetId);
    const names = this.categoryNames(budgetId);
    const revalRows = allRows<{ Month: string | null; total: number }>(
      this.db,
      MONTHLY_REVALUATIONS_SQL,
      budgetId,
      maxMonth
    );
    const transfers = this.inGroup(GROUP_TRANSFERS);

    for (const month of months) {
      const index = this.monthIndex(month);
      const inc = this.snap.memo(`mIncome:${index}`, () => {
        let total = 0;
        for (const [m, v] of fold.income) if (m <= index) total += v;
        return total;
      });
      const ass = this.snap.memo(`mAssigned:${index}`, () =>
        sumAssignedOver(this.data, -Infinity, index)
      );
      const off = this.snap.memo(`mOff:${index}`, () =>
        sumCategoriesOver(this.data, (m) => m.offBudgetTransfers, -Infinity, index, transfers)
      );
      const inB = this.snap.memo(`mIn:${index}`, () =>
        sumCategoriesOver(this.data, (m) => m.inBudgetTransfers, -Infinity, index, transfers)
      );
      const split = this.snap.memo(`mSplit:${index}`, () => {
        let o = 0;
        let i = 0;
        for (const [m, tx] of this.data.tx)
          if (m <= index) {
            o += tx.splitOffBudget;
            i += tx.splitInBudget;
          }
        return { off: o, inb: i };
      });
      let rev = 0;
      for (const r of revalRows) if (r.Month !== null && r.Month <= month) rev += r.total;
      const debt = this.snap.memo(`mDebt:${index}`, () => {
        let total = 0;
        for (const [m, v] of fold.debtInflow) if (m <= index) total += v;
        return total;
      });

      const overspendsForMonth = overspendBefore(fold, index, names);
      const priorCashOverspend = overspendsForMonth.reduce((sum, o) => sum + o.amount, 0);
      const offAll = off + split.off;
      const inAll = inB + split.inb;
      const readyToAssign = inc - ass - offAll + inAll + debt + rev - priorCashOverspend;

      result.set(month, {
        mode: 'monthly',
        month,
        income: asMilli(inc),
        assignments: asMilli(ass),
        futureAssignments: asMilli(0),
        offBudgetTransfers: asMilli(offAll),
        inBudgetTransfers: asMilli(inAll),
        debtInflows: asMilli(debt),
        revaluations: asMilli(rev),
        priorCashOverspend: asMilli(priorCashOverspend),
        readyToAssign: asMilli(readyToAssign),
        priorCashOverspendDetails: overspendsForMonth.map((o) => ({
          categoryId: o.categoryId,
          categoryName: o.categoryName,
          categoryGroupName: o.categoryGroupName,
          month: o.month,
          amount: asMilli(o.amount),
        })),
      });
    }
    return result;
  }
}

function monthLabelOf(index: number): string {
  const y = Math.floor(index / 12);
  return `${String(y).padStart(4, '0')}-${String(index - y * 12 + 1).padStart(2, '0')}`;
}
