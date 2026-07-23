/**
 * Pure aggregation model for the Analytics page. Everything here operates on
 * plain adapted shapes (AnalyticsTxn / AnalyticsAccount) so it can be unit
 * tested without the runtime; useAnalyticsData does the adapting.
 *
 * Money stays in integer milliunits end to end — convert with toDecimal only
 * at the chart/format boundary.
 */

export interface AnalyticsTxn {
  id: number;
  /** yyyy-MM-dd local calendar day */
  date: string;
  /** yyyy-MM, derived from date */
  monthKey: string;
  accountId: number;
  categoryId: number | null;
  category: string;
  groupName: string;
  payee: string;
  labelId: number | null;
  label: string;
  labelColor: string | null;
  inflow: number;
  outflow: number;
  isTransfer: boolean;
  isIncome: boolean;
}

export interface AnalyticsAccount {
  id: number;
  name: string;
  type: string;
  onBudget: boolean;
  isLiability: boolean;
  /** Current balance including future-dated transactions (milliunits). */
  currentBalance: number;
}

export interface AnalyticsFilters {
  /** yyyy-MM-dd inclusive bounds; empty string = unbounded */
  startDate: string;
  endDate: string;
  accountIds: number[];
  categoryIds: number[];
  payees: string[];
  labelIds: number[];
}

export const INCOME_GROUP_NAME = 'Income';
export const TRANSFERS_GROUP_NAME = 'Transfers';

// ---------------------------------------------------------------------------
// Months

/** Inclusive list of yyyy-MM keys between two yyyy-MM-dd dates. */
export function monthKeysInRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || startDate > endDate) return [];
  const [startYear, startMonth] = startDate.slice(0, 7).split('-').map(Number);
  const [endYear, endMonth] = endDate.slice(0, 7).split('-').map(Number);
  const keys: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

/** Shift a yyyy-MM key by a number of months (negative = back). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  const outYear = Math.floor(index / 12);
  const outMonth = (index % 12) + 1;
  return `${outYear}-${String(outMonth).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Filtering

export function filterTransactions(
  txns: AnalyticsTxn[],
  filters: AnalyticsFilters
): AnalyticsTxn[] {
  const accountSet = filters.accountIds.length ? new Set(filters.accountIds) : null;
  const categorySet = filters.categoryIds.length ? new Set(filters.categoryIds) : null;
  const payeeSet = filters.payees.length ? new Set(filters.payees) : null;
  const labelSet = filters.labelIds.length ? new Set(filters.labelIds) : null;
  return txns.filter((txn) => {
    if (filters.startDate && txn.date < filters.startDate) return false;
    if (filters.endDate && txn.date > filters.endDate) return false;
    if (accountSet && !accountSet.has(txn.accountId)) return false;
    if (categorySet && (txn.categoryId === null || !categorySet.has(txn.categoryId))) return false;
    if (payeeSet && !payeeSet.has(txn.payee)) return false;
    if (labelSet && (txn.labelId === null || !labelSet.has(txn.labelId))) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Cash flow / income vs expense

export interface MonthlyFlowPoint {
  monthKey: string;
  income: number;
  spending: number;
  net: number;
}

/**
 * Monthly money in vs money out over on-budget accounts, excluding transfers.
 * Income = net inflow of Income-group categories; spending = net outflow of
 * everything else (refund inflows reduce spending).
 */
export function buildMonthlyFlow(
  txns: AnalyticsTxn[],
  months: string[],
  onBudgetAccountIds: Set<number>
): MonthlyFlowPoint[] {
  const byMonth = new Map<string, { income: number; spending: number }>();
  for (const key of months) byMonth.set(key, { income: 0, spending: 0 });
  for (const txn of txns) {
    if (txn.isTransfer || !onBudgetAccountIds.has(txn.accountId)) continue;
    const bucket = byMonth.get(txn.monthKey);
    if (!bucket) continue;
    if (txn.isIncome) {
      bucket.income += txn.inflow - txn.outflow;
    } else {
      bucket.spending += txn.outflow - txn.inflow;
    }
  }
  return months.map((monthKey) => {
    const { income, spending } = byMonth.get(monthKey)!;
    return { monthKey, income, spending, net: income - spending };
  });
}

// ---------------------------------------------------------------------------
// Spending by dimension (category / group / payee / label)

export type SpendingDimension = 'category' | 'group' | 'payee' | 'label';

export interface DimensionTotal {
  key: string;
  name: string;
  total: number;
  /** Entity-owned color (labels); series slots otherwise. */
  ownColor: string | null;
}

function dimensionKey(txn: AnalyticsTxn, dim: SpendingDimension): { key: string; name: string } {
  switch (dim) {
    case 'category':
      return { key: `c:${txn.categoryId ?? 'none'}`, name: txn.category || 'Uncategorized' };
    case 'group':
      return { key: `g:${txn.groupName || 'none'}`, name: txn.groupName || 'Ungrouped' };
    case 'payee':
      return { key: `p:${txn.payee || 'none'}`, name: txn.payee || 'No payee' };
    case 'label':
      return { key: `l:${txn.labelId ?? 'none'}`, name: txn.label || 'Unlabeled' };
  }
}

/** Spending (outflow − inflow) totals per dimension value; excludes income,
 * transfers, and off-budget accounts; drops non-positive totals. */
export function buildDimensionTotals(
  txns: AnalyticsTxn[],
  dim: SpendingDimension,
  onBudgetAccountIds: Set<number>
): DimensionTotal[] {
  const totals = new Map<string, DimensionTotal>();
  for (const txn of txns) {
    if (txn.isTransfer || txn.isIncome || !onBudgetAccountIds.has(txn.accountId)) continue;
    if (dim === 'label' && txn.labelId === null) continue;
    const { key, name } = dimensionKey(txn, dim);
    const existing = totals.get(key);
    const amount = txn.outflow - txn.inflow;
    if (existing) {
      existing.total += amount;
    } else {
      totals.set(key, {
        key,
        name,
        total: amount,
        ownColor: dim === 'label' ? txn.labelColor : null,
      });
    }
  }
  return [...totals.values()].filter((t) => t.total > 0).sort((a, b) => b.total - a.total);
}

export interface FoldedTotals {
  top: DimensionTotal[];
  other: DimensionTotal | null;
  grandTotal: number;
}

/** Keep the first `n` rows, fold the rest into a single "Other" row. */
export function foldTopN(items: DimensionTotal[], n: number): FoldedTotals {
  const grandTotal = items.reduce((sum, item) => sum + item.total, 0);
  if (items.length <= n) return { top: items, other: null, grandTotal };
  const top = items.slice(0, n);
  const otherTotal = grandTotal - top.reduce((sum, item) => sum + item.total, 0);
  return {
    top,
    other: { key: 'other', name: 'Other', total: otherTotal, ownColor: null },
    grandTotal,
  };
}

// ---------------------------------------------------------------------------
// Spending trends (stacked series per month)

export interface TrendSeries {
  key: string;
  name: string;
  ownColor: string | null;
  /** One value per entry of the months axis (milliunits, ≥ 0). */
  values: number[];
  total: number;
}

/**
 * Per-month spending for the top `maxSeries` dimension values (+ Other).
 * Series order = spending rank; within the chart, colors are assigned by
 * this fixed order and stay put across display-mode toggles.
 */
export function buildTrendSeries(
  txns: AnalyticsTxn[],
  months: string[],
  dim: SpendingDimension,
  onBudgetAccountIds: Set<number>,
  maxSeries: number
): TrendSeries[] {
  const totals = buildDimensionTotals(txns, dim, onBudgetAccountIds);
  const { top, other } = foldTopN(totals, maxSeries);
  const monthIndex = new Map(months.map((key, index) => [key, index]));
  const seriesByKey = new Map<string, TrendSeries>();
  for (const item of top) {
    seriesByKey.set(item.key, {
      key: item.key,
      name: item.name,
      ownColor: item.ownColor,
      values: months.map(() => 0),
      total: item.total,
    });
  }
  const otherSeries: TrendSeries | null = other
    ? {
        key: other.key,
        name: other.name,
        ownColor: null,
        values: months.map(() => 0),
        total: other.total,
      }
    : null;

  for (const txn of txns) {
    if (txn.isTransfer || txn.isIncome || !onBudgetAccountIds.has(txn.accountId)) continue;
    if (dim === 'label' && txn.labelId === null) continue;
    const index = monthIndex.get(txn.monthKey);
    if (index === undefined) continue;
    const { key } = dimensionKey(txn, dim);
    const series = seriesByKey.get(key) ?? otherSeries;
    if (!series) continue;
    series.values[index] += txn.outflow - txn.inflow;
  }

  const result = [...seriesByKey.values()];
  if (otherSeries) result.push(otherSeries);
  // Negative months (refund-heavy) would render as inverted stack segments;
  // clamp to zero — the summary panel still carries exact totals.
  for (const series of result) {
    series.values = series.values.map((value) => Math.max(0, value));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Net worth

export interface NetWorthPoint {
  monthKey: string;
  assets: number;
  debt: number;
  netWorth: number;
}

/**
 * Month-end balances anchored to each account's CURRENT stored balance:
 * balance(at end of month M) = currentBalance − Σ transactions dated after M.
 * This stays consistent with the balances shown elsewhere in the app even
 * when an account's transaction history is incomplete.
 *
 * Uses all accounts (on- and off-budget); transfers are kept — they net out
 * across accounts. Account filters still apply upstream.
 */
export function buildNetWorthSeries(
  accounts: AnalyticsAccount[],
  txns: AnalyticsTxn[],
  months: string[]
): NetWorthPoint[] {
  if (months.length === 0) return [];
  const lastMonth = months[months.length - 1];

  // Per account: signed sum per month key (for all months, incl. outside the
  // window) so we can walk balances backwards from "now".
  const perAccount = new Map<number, Map<string, number>>();
  for (const txn of txns) {
    let monthSums = perAccount.get(txn.accountId);
    if (!monthSums) {
      monthSums = new Map();
      perAccount.set(txn.accountId, monthSums);
    }
    monthSums.set(txn.monthKey, (monthSums.get(txn.monthKey) ?? 0) + (txn.inflow - txn.outflow));
  }

  const points: NetWorthPoint[] = months.map((monthKey) => ({
    monthKey,
    assets: 0,
    debt: 0,
    netWorth: 0,
  }));

  for (const account of accounts) {
    const monthSums = perAccount.get(account.id) ?? new Map<string, number>();
    // Everything dated after the window's last month.
    let balance = account.currentBalance;
    for (const [monthKey, sum] of monthSums) {
      if (monthKey > lastMonth) balance -= sum;
    }
    // Walk backwards through the window.
    for (let index = months.length - 1; index >= 0; index -= 1) {
      const point = points[index];
      if (account.isLiability) {
        point.debt += Math.max(0, -balance);
        // A positive credit balance (overpayment) counts as an asset.
        point.assets += Math.max(0, balance);
      } else {
        point.assets += balance;
      }
      balance -= monthSums.get(months[index]) ?? 0;
    }
  }

  for (const point of points) {
    point.netWorth = point.assets - point.debt;
  }
  return points;
}

// ---------------------------------------------------------------------------
// Flow (Sankey)

export interface SankeyNode {
  name: string;
  slot: 'income' | 'hub' | 'group' | 'result';
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface FlowGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: number;
  totalSpending: number;
}

/**
 * Income categories → Income → category groups → (Saved / From savings).
 * Group count is capped; the rest folds into "Other". Node names are
 * disambiguated with suffix markers when an income category collides with a
 * group name (ECharts sankey requires unique node names).
 */
export function buildFlowGraph(
  txns: AnalyticsTxn[],
  onBudgetAccountIds: Set<number>,
  maxGroups: number
): FlowGraph {
  const incomeBySource = new Map<string, number>();
  const spendingByGroup = new Map<string, number>();
  for (const txn of txns) {
    if (txn.isTransfer || !onBudgetAccountIds.has(txn.accountId)) continue;
    if (txn.isIncome) {
      const name = txn.category || 'Other income';
      const amount = txn.inflow - txn.outflow;
      incomeBySource.set(name, (incomeBySource.get(name) ?? 0) + amount);
    } else {
      const name = txn.groupName || 'Ungrouped';
      const amount = txn.outflow - txn.inflow;
      spendingByGroup.set(name, (spendingByGroup.get(name) ?? 0) + amount);
    }
  }

  const incomeSources = [...incomeBySource.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  let groups = [...spendingByGroup.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  if (groups.length > maxGroups) {
    const kept = groups.slice(0, maxGroups - 1);
    const foldedTotal = groups.slice(maxGroups - 1).reduce((sum, [, value]) => sum + value, 0);
    groups = [...kept, ['Other spending', foldedTotal]];
  }

  const totalIncome = incomeSources.reduce((sum, [, value]) => sum + value, 0);
  const totalSpending = groups.reduce((sum, [, value]) => sum + value, 0);

  const HUB = 'Income';
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const usedNames = new Set<string>([HUB]);
  const uniqueName = (raw: string) => {
    let name = raw;
    while (usedNames.has(name)) name = `${name} `; // trailing-space suffix, invisible in rendered labels
    usedNames.add(name);
    return name;
  };

  nodes.push({ name: HUB, slot: 'hub' });
  for (const [rawName, value] of incomeSources) {
    const name = uniqueName(rawName);
    nodes.push({ name, slot: 'income' });
    links.push({ source: name, target: HUB, value });
  }
  for (const [rawName, value] of groups) {
    const name = uniqueName(rawName);
    nodes.push({ name, slot: 'group' });
    links.push({ source: HUB, target: name, value });
  }
  const net = totalIncome - totalSpending;
  if (net > 0) {
    const name = uniqueName('Saved');
    nodes.push({ name, slot: 'result' });
    links.push({ source: HUB, target: name, value: net });
  } else if (net < 0 && totalSpending > 0) {
    const name = uniqueName('From savings');
    nodes.push({ name, slot: 'income' });
    links.push({ source: name, target: HUB, value: -net });
  }

  return { nodes, links, totalIncome, totalSpending };
}

// ---------------------------------------------------------------------------
// Category pivot (income vs expense per category across months)

export const PIVOT_UNCATEGORIZED_GROUP_ID = -1;

export interface PivotCategoryRow {
  id: number | null;
  name: string;
  /** Net (inflow − outflow) per months-axis entry, milliunits. */
  values: number[];
  total: number;
}

export interface PivotGroupRow {
  id: number;
  name: string;
  isIncome: boolean;
  categories: PivotCategoryRow[];
  monthTotals: number[];
  total: number;
}

export interface CategoryPivot {
  groups: PivotGroupRow[];
  columnTotals: number[];
  grandTotal: number;
  hasActivity: boolean;
}

/**
 * Category × month net matrix over on-budget accounts, excluding transfers.
 * Lists every (selected) category — zero rows included — grouped by category
 * group with the Income group first, plus an "Uncategorized" bucket when
 * uncategorized activity exists.
 */
export function buildCategoryPivot(
  txns: AnalyticsTxn[],
  months: string[],
  categories: { id: number; name: string; groupId: number }[],
  categoryGroups: { id: number; name: string }[],
  onBudgetAccountIds: Set<number>,
  selectedCategoryIds: number[]
): CategoryPivot {
  const monthIndex = new Map(months.map((key, index) => [key, index]));
  const groupNameById = new Map(categoryGroups.map((group) => [group.id, group.name]));
  const transferGroupIds = new Set(
    categoryGroups.filter((group) => group.name === TRANSFERS_GROUP_NAME).map((group) => group.id)
  );

  // Net per category per month; null category id = uncategorized.
  const cells = new Map<number | null, number[]>();
  let hasActivity = false;
  for (const txn of txns) {
    if (txn.isTransfer || !onBudgetAccountIds.has(txn.accountId)) continue;
    const index = monthIndex.get(txn.monthKey);
    if (index === undefined) continue;
    const key = txn.categoryId;
    let row = cells.get(key);
    if (!row) {
      row = months.map(() => 0);
      cells.set(key, row);
    }
    const amount = txn.inflow - txn.outflow;
    row[index] += amount;
    if (amount !== 0) hasActivity = true;
  }

  const selectedSet = selectedCategoryIds.length ? new Set(selectedCategoryIds) : null;
  const listedCategories = categories.filter(
    (category) =>
      !transferGroupIds.has(category.groupId) && (!selectedSet || selectedSet.has(category.id))
  );

  const groupsById = new Map<number, PivotGroupRow>();
  const ensureGroup = (id: number, name: string): PivotGroupRow => {
    let group = groupsById.get(id);
    if (!group) {
      group = {
        id,
        name,
        isIncome: name === INCOME_GROUP_NAME,
        categories: [],
        monthTotals: months.map(() => 0),
        total: 0,
      };
      groupsById.set(id, group);
    }
    return group;
  };

  const addRow = (groupId: number, groupName: string, row: PivotCategoryRow) => {
    const group = ensureGroup(groupId, groupName);
    group.categories.push(row);
    row.values.forEach((value, index) => {
      group.monthTotals[index] += value;
    });
    group.total += row.total;
  };

  for (const category of listedCategories) {
    const values = cells.get(category.id) ?? months.map(() => 0);
    addRow(category.groupId, groupNameById.get(category.groupId) ?? 'Other categories', {
      id: category.id,
      name: category.name,
      values,
      total: values.reduce((sum, value) => sum + value, 0),
    });
  }
  const uncategorized = cells.get(null);
  if (uncategorized && !selectedSet) {
    addRow(PIVOT_UNCATEGORIZED_GROUP_ID, 'Other categories', {
      id: null,
      name: 'Uncategorized',
      values: uncategorized,
      total: uncategorized.reduce((sum, value) => sum + value, 0),
    });
  }

  const groups = [...groupsById.values()];
  for (const group of groups) {
    group.categories.sort((a, b) => a.name.localeCompare(b.name));
  }
  groups.sort((a, b) => {
    if (a.isIncome !== b.isIncome) return a.isIncome ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const columnTotals = months.map((_, index) =>
    groups.reduce((sum, group) => sum + group.monthTotals[index], 0)
  );
  const grandTotal = columnTotals.reduce((sum, value) => sum + value, 0);

  return { groups, columnTotals, grandTotal, hasActivity };
}

// ---------------------------------------------------------------------------
// Runway (how long current funds last at the current burn rate)

export interface RunwayResult {
  /** Spendable balance at the end of the last period month (milliunits). */
  currentBalance: number;
  /** Mean monthly spending over the period (milliunits). */
  avgMonthlySpend: number;
  /** Months the balance lasts at that burn; null = no spending (infinite). */
  runwayMonths: number | null;
  /** Balance projected forward at the average burn, starting from the last
   * actual month; stops one month after crossing zero or at the cap. */
  projection: { monthKey: string; balance: number }[];
  /** Historical runway per period month, using a trailing spending average. */
  history: { monthKey: string; runwayMonths: number | null }[];
}

const RUNWAY_TRAILING_WINDOW = 3;

export function buildRunway(
  balancePoints: NetWorthPoint[],
  flowPoints: MonthlyFlowPoint[],
  maxProjectionMonths: number
): RunwayResult {
  const last = balancePoints.at(-1);
  const currentBalance = last?.netWorth ?? 0;
  const monthCount = Math.max(1, flowPoints.length);
  const totalSpend = flowPoints.reduce((sum, point) => sum + point.spending, 0);
  const avgMonthlySpend = Math.round(totalSpend / monthCount);

  const runwayMonths = avgMonthlySpend > 0 ? Math.max(0, currentBalance) / avgMonthlySpend : null;

  const projection: { monthKey: string; balance: number }[] = [];
  if (last) {
    projection.push({ monthKey: last.monthKey, balance: currentBalance });
    if (avgMonthlySpend > 0) {
      let balance = currentBalance;
      let { monthKey } = last;
      for (let step = 0; step < maxProjectionMonths && balance > 0; step += 1) {
        balance -= avgMonthlySpend;
        monthKey = shiftMonthKey(monthKey, 1);
        projection.push({ monthKey, balance: Math.max(0, balance) });
      }
    }
  }

  const flowByMonth = new Map(flowPoints.map((point) => [point.monthKey, point.spending]));
  const history = balancePoints.map((point, index) => {
    const from = Math.max(0, index - (RUNWAY_TRAILING_WINDOW - 1));
    const window = balancePoints.slice(from, index + 1);
    const windowSpend = window.reduce(
      (sum, entry) => sum + (flowByMonth.get(entry.monthKey) ?? 0),
      0
    );
    const trailingAvg = windowSpend / window.length;
    return {
      monthKey: point.monthKey,
      runwayMonths: trailingAvg > 0 ? Math.max(0, point.netWorth) / trailingAvg : null,
    };
  });

  return { currentBalance, avgMonthlySpend, runwayMonths, projection, history };
}

// ---------------------------------------------------------------------------
// Plan vs Reality (assigned vs actual per month/category) + goal coverage

export interface PlanMonthInput {
  monthKey: string;
  /** Per-category rows from the monthly budget view (milliunits). */
  rows: { categoryId: number; category: string; group: string; assigned: number; spent: number }[];
}

export interface PlanMonthPoint {
  monthKey: string;
  assigned: number;
  spent: number;
  /** assigned − spent; positive = under plan. */
  slack: number;
}

export interface PlanCategoryRow {
  categoryId: number;
  name: string;
  group: string;
  assigned: number;
  spent: number;
  /** spent / assigned; null when nothing was assigned. */
  usage: number | null;
  /** Months in the period where this category had money assigned. */
  monthsWithPlan: number;
  /** Of those, months where spending exceeded the assignment. */
  monthsOver: number;
  /** Over in ≥ half of ≥ 3 planned months — a habit, not an accident. */
  chronic: boolean;
}

export interface PlanVsReality {
  months: PlanMonthPoint[];
  categories: PlanCategoryRow[];
  totalAssigned: number;
  totalSpent: number;
  /** Share of months where spending stayed within the assigned total. */
  monthsOnPlan: number;
}

export function buildPlanVsReality(inputs: PlanMonthInput[]): PlanVsReality {
  const months: PlanMonthPoint[] = [];
  const byCategory = new Map<number, PlanCategoryRow>();
  for (const input of inputs) {
    let assigned = 0;
    let spent = 0;
    for (const row of input.rows) {
      assigned += row.assigned;
      spent += row.spent;
      let entry = byCategory.get(row.categoryId);
      if (!entry) {
        entry = {
          categoryId: row.categoryId,
          name: row.category,
          group: row.group,
          assigned: 0,
          spent: 0,
          usage: null,
          monthsWithPlan: 0,
          monthsOver: 0,
          chronic: false,
        };
        byCategory.set(row.categoryId, entry);
      }
      entry.assigned += row.assigned;
      entry.spent += row.spent;
      if (row.assigned > 0) {
        entry.monthsWithPlan += 1;
        if (row.spent > row.assigned) entry.monthsOver += 1;
      }
    }
    months.push({ monthKey: input.monthKey, assigned, spent, slack: assigned - spent });
  }

  const categories = [...byCategory.values()]
    .filter((row) => row.assigned !== 0 || row.spent !== 0)
    .map((row) => ({
      ...row,
      usage: row.assigned > 0 ? row.spent / row.assigned : null,
      chronic: row.monthsWithPlan >= 3 && row.monthsOver / row.monthsWithPlan >= 0.5,
    }))
    .sort((a, b) => b.spent - a.spent);

  const totalAssigned = months.reduce((sum, point) => sum + point.assigned, 0);
  const totalSpent = months.reduce((sum, point) => sum + point.spent, 0);
  const monthsWithPlan = months.filter((point) => point.assigned > 0);
  const monthsOnPlan =
    monthsWithPlan.length > 0
      ? monthsWithPlan.filter((point) => point.spent <= point.assigned).length /
        monthsWithPlan.length
      : 0;

  return { months, categories, totalAssigned, totalSpent, monthsOnPlan };
}

export interface GoalCoverageRow {
  goalId: number;
  categoryId: number;
  categoryName: string;
  /** 'monthly' kinds expect target × months in the period; others expect target once. */
  isMonthly: boolean;
  target: number;
  expected: number;
  funded: number;
  /** funded / expected, clamped to [0, +∞). */
  coverage: number;
}

/**
 * Funding coverage per goal over the report period: how much was assigned to
 * the goal's category vs what the goal expects. Monthly goal types expect
 * their target every month; yearly/target-date goals expect the target once.
 * An honest period-scoped view, not the app's full goal-cycle math.
 */
export function buildGoalCoverage(
  goals: { id: number; categoryId: number; type: string; target: number }[],
  assignedByCategory: Map<number, number>,
  categoryNames: Map<number, string>,
  monthCount: number
): GoalCoverageRow[] {
  return goals
    .filter((goal) => goal.target > 0)
    .map((goal) => {
      const isMonthly = goal.type === 'monthly' || goal.type === 'monthly-savings';
      const expected = isMonthly ? goal.target * Math.max(1, monthCount) : goal.target;
      const funded = Math.max(0, assignedByCategory.get(goal.categoryId) ?? 0);
      return {
        goalId: goal.id,
        categoryId: goal.categoryId,
        categoryName: categoryNames.get(goal.categoryId) ?? `Category ${goal.categoryId}`,
        isMonthly,
        target: goal.target,
        expected,
        funded,
        coverage: expected > 0 ? funded / expected : 0,
      };
    })
    .sort((a, b) => a.coverage - b.coverage);
}

// ---------------------------------------------------------------------------
// Scenario planner (stress-test projection)

export interface ScenarioOneOff {
  id: string;
  /** yyyy-MM month the one-off lands in. */
  monthKey: string;
  /** Positive milliunits; direction comes from `kind`. */
  amount: number;
  kind: 'inflow' | 'outflow';
  label: string;
}

export interface ScenarioInputs {
  /** Spendable balance at the projection start (milliunits). */
  startBalance: number;
  /** Future month keys to project over, in order. */
  months: string[];
  /** Baseline income/spending per projected month (already averaged or forecast). */
  baselineIncome: number[];
  baselineSpending: number[];
  /** Multipliers from the sliders (1 = unchanged). */
  incomeFactor: number;
  spendingFactor: number;
  oneOffs: ScenarioOneOff[];
}

export interface ScenarioPoint {
  monthKey: string;
  income: number;
  spending: number;
  oneOff: number;
  balance: number;
}

export interface ScenarioProjection {
  points: ScenarioPoint[];
  endBalance: number;
  minBalance: number;
  minMonthKey: string | null;
  /** First projected month the balance goes below zero; null = survives. */
  breakMonthKey: string | null;
}

export function projectScenario(inputs: ScenarioInputs): ScenarioProjection {
  const oneOffByMonth = new Map<string, number>();
  for (const oneOff of inputs.oneOffs) {
    const signed = oneOff.kind === 'inflow' ? oneOff.amount : -oneOff.amount;
    oneOffByMonth.set(oneOff.monthKey, (oneOffByMonth.get(oneOff.monthKey) ?? 0) + signed);
  }

  let balance = inputs.startBalance;
  let minBalance = balance;
  let minMonthKey: string | null = null;
  let breakMonthKey: string | null = null;
  const points: ScenarioPoint[] = inputs.months.map((monthKey, index) => {
    const income = Math.round((inputs.baselineIncome[index] ?? 0) * inputs.incomeFactor);
    const spending = Math.round((inputs.baselineSpending[index] ?? 0) * inputs.spendingFactor);
    const oneOff = oneOffByMonth.get(monthKey) ?? 0;
    balance += income - spending + oneOff;
    if (balance < minBalance) {
      minBalance = balance;
      minMonthKey = monthKey;
    }
    if (balance < 0 && breakMonthKey === null) {
      breakMonthKey = monthKey;
    }
    return { monthKey, income, spending, oneOff, balance };
  });

  return {
    points,
    endBalance: points.length ? points[points.length - 1].balance : inputs.startBalance,
    minBalance,
    minMonthKey,
    breakMonthKey,
  };
}
