import { describe, expect, it } from 'vitest';

import {
  buildCategoryPivot,
  buildDimensionTotals,
  buildFlowGraph,
  buildMonthlyFlow,
  buildGoalCoverage,
  buildNetWorthSeries,
  buildPlanVsReality,
  buildRunway,
  buildTrendSeries,
  filterTransactions,
  foldTopN,
  monthKeysInRange,
  projectScenario,
  type AnalyticsAccount,
  type AnalyticsTxn,
} from './analytics-model';

let nextId = 1;
function txn(overrides: Partial<AnalyticsTxn>): AnalyticsTxn {
  const date = overrides.date ?? '2026-05-10';
  return {
    id: nextId++,
    date,
    monthKey: date.slice(0, 7),
    accountId: 1,
    categoryId: 10,
    category: 'Groceries',
    groupName: 'Everyday',
    payee: 'Store',
    labelId: null,
    label: '',
    labelColor: null,
    inflow: 0,
    outflow: 0,
    isTransfer: false,
    isIncome: false,
    ...overrides,
  };
}

const account = (overrides: Partial<AnalyticsAccount>): AnalyticsAccount => ({
  id: 1,
  name: 'Checking',
  type: 'Checking',
  onBudget: true,
  isLiability: false,
  currentBalance: 0,
  ...overrides,
});

const ON_BUDGET = new Set([1]);

describe('monthKeysInRange', () => {
  it('spans years inclusively', () => {
    expect(monthKeysInRange('2025-11-15', '2026-02-01')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('returns empty for inverted or missing bounds', () => {
    expect(monthKeysInRange('2026-05-01', '2026-04-01')).toEqual([]);
    expect(monthKeysInRange('', '2026-04-01')).toEqual([]);
  });
});

describe('filterTransactions', () => {
  it('applies date, account, category, payee, and label filters', () => {
    const txns = [
      txn({ date: '2026-01-05', accountId: 1, categoryId: 10, payee: 'A', labelId: 5 }),
      txn({ date: '2026-02-05', accountId: 2, categoryId: 11, payee: 'B', labelId: null }),
    ];
    const base = {
      startDate: '',
      endDate: '',
      accountIds: [],
      categoryIds: [],
      payees: [],
      labelIds: [],
    };
    expect(filterTransactions(txns, { ...base, startDate: '2026-02-01' })).toHaveLength(1);
    expect(filterTransactions(txns, { ...base, accountIds: [1] })).toHaveLength(1);
    expect(filterTransactions(txns, { ...base, categoryIds: [11] })).toHaveLength(1);
    expect(filterTransactions(txns, { ...base, payees: ['A'] })).toHaveLength(1);
    expect(filterTransactions(txns, { ...base, labelIds: [5] })).toHaveLength(1);
    expect(filterTransactions(txns, base)).toHaveLength(2);
  });
});

describe('buildMonthlyFlow', () => {
  it('splits income from spending, nets refunds, skips transfers and off-budget', () => {
    const txns = [
      txn({ date: '2026-05-01', isIncome: true, groupName: 'Income', inflow: 500_000 }),
      txn({ date: '2026-05-02', outflow: 120_000 }),
      txn({ date: '2026-05-03', outflow: 30_000, inflow: 10_000 }), // partial refund
      txn({ date: '2026-05-04', outflow: 99_000, isTransfer: true }),
      txn({ date: '2026-05-05', outflow: 77_000, accountId: 9 }), // off-budget
      txn({ date: '2026-06-01', outflow: 40_000 }),
    ];
    const points = buildMonthlyFlow(txns, ['2026-05', '2026-06'], ON_BUDGET);
    expect(points[0]).toEqual({
      monthKey: '2026-05',
      income: 500_000,
      spending: 140_000,
      net: 360_000,
    });
    expect(points[1].spending).toBe(40_000);
    expect(points[1].income).toBe(0);
  });
});

describe('buildDimensionTotals + foldTopN', () => {
  it('totals per category and folds the tail into Other', () => {
    const txns = [
      txn({ categoryId: 1, category: 'A', outflow: 50_000 }),
      txn({ categoryId: 2, category: 'B', outflow: 30_000 }),
      txn({ categoryId: 3, category: 'C', outflow: 20_000 }),
      txn({ categoryId: 1, category: 'A', outflow: 10_000 }),
    ];
    const totals = buildDimensionTotals(txns, 'category', ON_BUDGET);
    expect(totals.map((t) => [t.name, t.total])).toEqual([
      ['A', 60_000],
      ['B', 30_000],
      ['C', 20_000],
    ]);
    const folded = foldTopN(totals, 2);
    expect(folded.top).toHaveLength(2);
    expect(folded.other?.total).toBe(20_000);
    expect(folded.grandTotal).toBe(110_000);
  });

  it('skips unlabeled transactions in the label dimension and keeps label colors', () => {
    const txns = [
      txn({ labelId: 1, label: 'Family', labelColor: '#ff00aa', outflow: 10_000 }),
      txn({ labelId: null, outflow: 99_000 }),
    ];
    const totals = buildDimensionTotals(txns, 'label', ON_BUDGET);
    expect(totals).toHaveLength(1);
    expect(totals[0].ownColor).toBe('#ff00aa');
  });
});

describe('buildTrendSeries', () => {
  it('produces per-month values for top series plus Other', () => {
    const months = ['2026-05', '2026-06'];
    const txns = [
      txn({ date: '2026-05-01', categoryId: 1, category: 'A', outflow: 50_000 }),
      txn({ date: '2026-06-01', categoryId: 1, category: 'A', outflow: 20_000 }),
      txn({ date: '2026-05-01', categoryId: 2, category: 'B', outflow: 30_000 }),
      txn({ date: '2026-06-01', categoryId: 3, category: 'C', outflow: 15_000 }),
    ];
    const series = buildTrendSeries(txns, months, 'category', ON_BUDGET, 2);
    expect(series.map((s) => s.name)).toEqual(['A', 'B', 'Other']);
    expect(series[0].values).toEqual([50_000, 20_000]);
    expect(series[2].values).toEqual([0, 15_000]);
  });
});

describe('buildNetWorthSeries', () => {
  it('anchors month-end balances to the current balance', () => {
    // Current balance 100; June spent 10, July (future, after window) will add 5.
    const accounts = [account({ currentBalance: 105_000 })];
    const txns = [
      txn({ date: '2026-06-10', outflow: 10_000 }),
      txn({ date: '2026-07-05', inflow: 5_000 }),
    ];
    const points = buildNetWorthSeries(accounts, txns, ['2026-05', '2026-06']);
    // End of June: 105 − 5 (July txn) = 100. End of May: 100 + 10 = 110.
    expect(points.map((p) => p.assets)).toEqual([110_000, 100_000]);
    expect(points[1].netWorth).toBe(100_000);
  });

  it('splits liabilities into debt and treats overpayment as asset', () => {
    const accounts = [
      account({ id: 1, currentBalance: 50_000 }),
      account({ id: 2, type: 'Credit', isLiability: true, currentBalance: -20_000 }),
      account({ id: 3, type: 'Credit', isLiability: true, currentBalance: 3_000 }),
    ];
    const points = buildNetWorthSeries(accounts, [], ['2026-06']);
    expect(points[0]).toEqual({
      monthKey: '2026-06',
      assets: 53_000,
      debt: 20_000,
      netWorth: 33_000,
    });
  });
});

describe('buildFlowGraph', () => {
  it('routes income through the hub to groups and the surplus to Saved', () => {
    const txns = [
      txn({ isIncome: true, groupName: 'Income', category: 'Salary', inflow: 500_000 }),
      txn({ groupName: 'Everyday', outflow: 300_000 }),
      txn({ groupName: 'Housing', outflow: 100_000 }),
    ];
    const graph = buildFlowGraph(txns, ON_BUDGET, 8);
    expect(graph.totalIncome).toBe(500_000);
    expect(graph.totalSpending).toBe(400_000);
    expect(graph.links).toContainEqual({ source: 'Salary', target: 'Income', value: 500_000 });
    expect(graph.links).toContainEqual({ source: 'Income', target: 'Saved', value: 100_000 });
    expect(graph.nodes.filter((n) => n.slot === 'group')).toHaveLength(2);
  });

  it('draws overspend from savings and folds excess groups', () => {
    const txns = [
      txn({ isIncome: true, groupName: 'Income', category: 'Salary', inflow: 100_000 }),
      txn({ groupName: 'G1', outflow: 60_000 }),
      txn({ groupName: 'G2', outflow: 50_000 }),
      txn({ groupName: 'G3', outflow: 40_000 }),
    ];
    const graph = buildFlowGraph(txns, ON_BUDGET, 2);
    expect(graph.links).toContainEqual({ source: 'From savings', target: 'Income', value: 50_000 });
    const groupNames = graph.nodes.filter((n) => n.slot === 'group').map((n) => n.name);
    expect(groupNames).toEqual(['G1', 'Other spending']);
  });
});

describe('buildCategoryPivot', () => {
  const categories = [
    { id: 1, name: 'Salary', groupId: 10 },
    { id: 2, name: 'Groceries', groupId: 20 },
    { id: 3, name: 'Dining', groupId: 20 },
    { id: 4, name: 'Internal', groupId: 30 },
  ];
  const groups = [
    { id: 10, name: 'Income' },
    { id: 20, name: 'Everyday' },
    { id: 30, name: 'Transfers' },
  ];
  const months = ['2026-05', '2026-06'];

  it('builds Income-first group rows with month and grand totals', () => {
    const txns = [
      txn({ date: '2026-05-01', categoryId: 1, isIncome: true, inflow: 500_000 }),
      txn({ date: '2026-05-02', categoryId: 2, outflow: 120_000 }),
      txn({ date: '2026-06-03', categoryId: 3, outflow: 80_000 }),
      txn({ date: '2026-05-04', categoryId: null, outflow: 10_000 }),
      txn({ date: '2026-05-05', categoryId: 4, outflow: 99_000, isTransfer: true }),
    ];
    const pivot = buildCategoryPivot(txns, months, categories, groups, ON_BUDGET, []);
    expect(pivot.groups.map((group) => group.name)).toEqual([
      'Income',
      'Everyday',
      'Other categories',
    ]);
    expect(pivot.groups[0].monthTotals).toEqual([500_000, 0]);
    expect(pivot.groups[1].categories.map((row) => row.name)).toEqual(['Dining', 'Groceries']);
    expect(pivot.groups[1].monthTotals).toEqual([-120_000, -80_000]);
    expect(pivot.columnTotals).toEqual([370_000, -80_000]);
    expect(pivot.grandTotal).toBe(290_000);
    expect(pivot.hasActivity).toBe(true);
  });

  it('lists zero rows, respects the category selection, and hides Transfers', () => {
    const pivot = buildCategoryPivot([], months, categories, groups, ON_BUDGET, [2]);
    expect(pivot.groups).toHaveLength(1);
    expect(pivot.groups[0].categories.map((row) => row.name)).toEqual(['Groceries']);
    expect(pivot.groups[0].categories[0].values).toEqual([0, 0]);
    expect(pivot.hasActivity).toBe(false);
  });
});

describe('buildRunway', () => {
  const balances = [
    { monthKey: '2026-04', assets: 900_000, debt: 0, netWorth: 900_000 },
    { monthKey: '2026-05', assets: 800_000, debt: 0, netWorth: 800_000 },
    { monthKey: '2026-06', assets: 600_000, debt: 0, netWorth: 600_000 },
  ];
  const flows = [
    { monthKey: '2026-04', income: 0, spending: 100_000, net: -100_000 },
    { monthKey: '2026-05', income: 0, spending: 100_000, net: -100_000 },
    { monthKey: '2026-06', income: 0, spending: 400_000, net: -400_000 },
  ];

  it('computes burn, runway, and a projection that ends at zero', () => {
    const runway = buildRunway(balances, flows, 24);
    expect(runway.currentBalance).toBe(600_000);
    expect(runway.avgMonthlySpend).toBe(200_000);
    expect(runway.runwayMonths).toBe(3);
    expect(runway.projection.map((p) => p.balance)).toEqual([600_000, 400_000, 200_000, 0]);
    expect(runway.projection.at(-1)?.monthKey).toBe('2026-09');
  });

  it('uses a trailing average for history and handles zero spend', () => {
    const runway = buildRunway(balances, flows, 24);
    // June trailing window: (100k + 100k + 400k) / 3 = 200k → 600k / 200k = 3.
    expect(runway.history.at(-1)?.runwayMonths).toBe(3);
    const noSpend = buildRunway(balances, [], 24);
    expect(noSpend.runwayMonths).toBeNull();
    expect(noSpend.projection).toHaveLength(1);
  });
});

describe('buildPlanVsReality', () => {
  it('aggregates months and categories with usage and on-plan share', () => {
    const plan = buildPlanVsReality([
      {
        monthKey: '2026-05',
        rows: [
          {
            categoryId: 1,
            category: 'Groceries',
            group: 'Everyday',
            assigned: 100_000,
            spent: 80_000,
          },
          { categoryId: 2, category: 'Fun', group: 'Everyday', assigned: 50_000, spent: 70_000 },
        ],
      },
      {
        monthKey: '2026-06',
        rows: [
          {
            categoryId: 1,
            category: 'Groceries',
            group: 'Everyday',
            assigned: 100_000,
            spent: 120_000,
          },
        ],
      },
    ]);
    expect(plan.months[0]).toEqual({
      monthKey: '2026-05',
      assigned: 150_000,
      spent: 150_000,
      slack: 0,
    });
    expect(plan.months[1].slack).toBe(-20_000);
    expect(plan.totalAssigned).toBe(250_000);
    expect(plan.totalSpent).toBe(270_000);
    // May on-plan (spent ≤ assigned), June over → 1/2.
    expect(plan.monthsOnPlan).toBe(0.5);
    const groceries = plan.categories.find((row) => row.categoryId === 1)!;
    expect(groceries.usage).toBeCloseTo(1.0, 8);
    const fun = plan.categories.find((row) => row.categoryId === 2)!;
    expect(fun.usage).toBeCloseTo(1.4, 8);
    expect(groceries.monthsWithPlan).toBe(2);
    expect(groceries.monthsOver).toBe(1);
    expect(groceries.chronic).toBe(false); // only 2 planned months — too few to call a habit
  });

  it('flags chronic categories: over in at least half of 3+ planned months', () => {
    const month = (key: string, spent: number) => ({
      monthKey: key,
      rows: [{ categoryId: 1, category: 'Netflix', group: 'Subs', assigned: 10_000, spent }],
    });
    const chronic = buildPlanVsReality([
      month('2026-03', 12_000),
      month('2026-04', 11_000),
      month('2026-05', 9_000),
      month('2026-06', 13_000),
    ]);
    expect(chronic.categories[0].monthsOver).toBe(3);
    expect(chronic.categories[0].chronic).toBe(true);
  });
});

describe('buildGoalCoverage', () => {
  it('scales monthly goals by month count and ranks by coverage', () => {
    const rows = buildGoalCoverage(
      [
        { id: 1, categoryId: 10, type: 'monthly-savings', target: 50_000 },
        { id: 2, categoryId: 11, type: 'target-date', target: 600_000 },
      ],
      new Map([
        [10, 120_000],
        [11, 600_000],
      ]),
      new Map([
        [10, 'Vacation'],
        [11, 'New car'],
      ]),
      3
    );
    // Monthly: expects 150k, funded 120k → 0.8; ranked first (lowest coverage).
    expect(rows[0].categoryName).toBe('Vacation');
    expect(rows[0].expected).toBe(150_000);
    expect(rows[0].coverage).toBeCloseTo(0.8, 8);
    expect(rows[1].coverage).toBeCloseTo(1, 8);
  });
});

describe('projectScenario', () => {
  const base = {
    startBalance: 100_000,
    months: ['2026-08', '2026-09', '2026-10'],
    baselineIncome: [50_000, 50_000, 50_000],
    baselineSpending: [40_000, 40_000, 40_000],
    incomeFactor: 1,
    spendingFactor: 1,
    oneOffs: [] as never[],
  };

  it('accumulates balance with factors applied', () => {
    const projection = projectScenario({ ...base, spendingFactor: 1.5 });
    // Net per month: 50k − 60k = −10k.
    expect(projection.points.map((p) => p.balance)).toEqual([90_000, 80_000, 70_000]);
    expect(projection.endBalance).toBe(70_000);
    expect(projection.breakMonthKey).toBeNull();
  });

  it('lands one-offs in their month and finds the break point', () => {
    const projection = projectScenario({
      ...base,
      incomeFactor: 0,
      oneOffs: [
        { id: '1', monthKey: '2026-09', amount: 80_000, kind: 'outflow', label: 'Car repair' },
        { id: '2', monthKey: '2026-10', amount: 30_000, kind: 'inflow', label: 'Bonus' },
      ],
    });
    // Aug: 100k − 40k = 60k; Sep: 60k − 40k − 80k = −60k (break); Oct: −60k − 40k + 30k = −70k.
    expect(projection.points.map((p) => p.balance)).toEqual([60_000, -60_000, -70_000]);
    expect(projection.breakMonthKey).toBe('2026-09');
    expect(projection.minBalance).toBe(-70_000);
    expect(projection.minMonthKey).toBe('2026-10');
  });
});
