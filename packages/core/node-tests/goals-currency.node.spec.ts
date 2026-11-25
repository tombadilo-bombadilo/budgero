import initSqlJs from 'sql.js';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asMilli,
  GoalCalculations,
  GoalPurpose,
  GoalType,
  goalInBudgetCurrency,
  goalRow,
  goalTargetCurrency,
  goalTargetInBudgetCurrency,
  NodeSqlJsAdapter,
  recordRowChanges,
  ServiceManager,
  setClock,
  type CategoryFinancials,
  type Goal,
} from '../src';
import { allRows, run } from '../src/database/sql.js';
import type { DatabaseAdapter } from '../src/database/interface.js';
import { MigrationRunner, migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import {
  applyBudgetCurrencyChange,
  RateBook,
} from '../src/services/currency/budget-currency-change.js';
import { lookupStoredRate } from '../src/services/currency/display-rate.js';

const TODAY = '2026-06-15';

/** A budget (EUR) with one category, services at a fixed "today". */
async function setup(displayCurrency = 'EUR') {
  setClock(new Date(2026, 5, 15, 12, 0, 0));
  const db = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(db as DatabaseAdapter);
  const s = manager.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'B',
    display_currency: displayCurrency,
    badge_icon: 'euro',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = s.categories.addCategoryGroup('Plans', budgetId);
  const trip = s.categories.addCategory(group, budgetId, 'Trip', '');
  const subs = s.categories.addCategory(group, budgetId, 'Subscriptions', '');
  return { db: db as DatabaseAdapter, s, budgetId, trip, subs };
}

const storedRows = (db: DatabaseAdapter) =>
  allRows<{ ID: number; Target: number; TargetCurrency: string | null }>(
    db,
    'SELECT ID, Target, TargetCurrency FROM goals ORDER BY ID'
  );

afterEach(() => setClock(null));

describe('migration 083: goal target currency', () => {
  let db: ReturnType<typeof createMigrationDatabase>;
  let before: unknown[][];
  const all = (sql: string) => db.exec(sql)[0]?.values ?? [];

  beforeAll(async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    db = createMigrationDatabase(new SQL.Database());
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    for (const m of migrations.filter((x) => x.version <= 82)) {
      try {
        if (typeof m.up === 'function') m.up(db);
        else db.exec(m.up);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
      }
      db.exec(`INSERT OR REPLACE INTO schema_migrations (version) VALUES (${m.version})`);
    }
    db.exec(`
      INSERT INTO budgets (ID, Name, DisplayCurrency, SpaceID, BadgeIcon, NumberFormat) VALUES (1, 'B', 'EUR', 's1', 'euro', '1');
      INSERT INTO category_groups (ID, Name, BudgetID) VALUES (1, 'G', 1);
      INSERT INTO categories (ID, Name, CategoryGroupID, BudgetID) VALUES (1, 'A', 1, 1), (2, 'B', 1, 1);
      INSERT INTO goals (ID, Type, CategoryID, Target, StartDate, TargetDate, Purpose, Recurring, CycleMonths, EffectiveFrom, EffectiveTo)
      VALUES
        (4, 'monthly', 1, 200000, '2020-01-01', '', 'spending', 0, NULL, '2020-01', NULL),
        (9, 'target-date', 2, 600000, '2021-04-01', '2021-09-30', 'savings', 1, 6, '2021-04', '2022-01');
    `);
    before = all('SELECT * FROM goals ORDER BY ID');
    new MigrationRunner(db).runMigrations();
  });

  it('keeps every goal and its data, in the budget currency', () => {
    const after = all('SELECT * FROM goals ORDER BY ID');
    // Same columns plus TargetCurrency (last), NULL on every existing row.
    expect(after.map((row) => row.slice(0, -1))).toEqual(before);
    expect(all('SELECT ID, TargetCurrency FROM goals ORDER BY ID')).toEqual([
      [4, null],
      [9, null],
    ]);
  });

  it('verifies, and running it again is harmless', () => {
    const m083 = migrations.find((m) => m.version === 83)!;
    expect(m083.verify?.(db)).toBe(true);
    expect(() => (m083.up as (d: typeof db) => void)(db)).not.toThrow();
  });
});

describe('goal target currency: writes', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    c = await setup();
  });

  it('stores a foreign currency upper-cased, and the budget currency or none as NULL', () => {
    c.s.goals.createGoal(
      GoalType.TARGET_DATE,
      c.trip,
      asMilli(3_000_000),
      '2026-06-01',
      '2026-12-31',
      GoalPurpose.SAVINGS,
      false,
      null,
      {},
      'usd'
    );
    c.s.goals.createGoal(
      GoalType.MONTHLY,
      c.subs,
      asMilli(50_000),
      '2026-06-01',
      '',
      GoalPurpose.SPENDING,
      false,
      null,
      {},
      'EUR'
    );
    expect(storedRows(c.db).map((r) => [r.Target, r.TargetCurrency])).toEqual([
      [3_000_000, 'USD'],
      [50_000, null],
    ]);
  });

  it('refuses crypto and malformed codes', () => {
    for (const code of ['BTC', 'US', 'usdx', '12']) {
      expect(() =>
        c.s.goals.createGoal(
          GoalType.MONTHLY,
          c.trip,
          asMilli(1_000),
          '2026-06-01',
          '',
          GoalPurpose.SPENDING,
          false,
          null,
          {},
          code
        )
      ).toThrow(/currency/i);
    }
    expect(storedRows(c.db)).toEqual([]);
  });

  it('an update sets, keeps or clears the currency with the target (absent = budget currency)', () => {
    c.s.goals.createGoal(GoalType.MONTHLY, c.trip, asMilli(100_000), '2026-06-01', '');
    c.s.goals.updateGoal(
      c.trip,
      asMilli(120_000),
      GoalType.MONTHLY,
      '',
      GoalPurpose.SPENDING,
      false,
      null,
      null,
      null,
      'GBP'
    );
    expect(storedRows(c.db)[0]).toMatchObject({ Target: 120_000, TargetCurrency: 'GBP' });
    // An older build's payload carries no currency: its target is in the budget currency.
    c.s.goals.updateGoal(c.trip, asMilli(90_000), GoalType.MONTHLY, '');
    expect(storedRows(c.db)[0]).toMatchObject({ Target: 90_000, TargetCurrency: null });
  });

  it('setGoalFrom writes the currency on a new and on an overwritten timeframe', () => {
    c.s.goals.createGoal(GoalType.MONTHLY, c.trip, asMilli(100_000), '2026-01-01', '');
    const fields = (target: number, targetCurrency?: string | null) => ({
      type: GoalType.MONTHLY,
      target: asMilli(target),
      startDate: '2026-01-01',
      targetDate: '',
      targetCurrency,
    });
    const id = c.s.goals.setGoalFrom(c.trip, '2026-07', null, fields(200_000, 'USD'));
    expect(storedRows(c.db).find((r) => r.ID === id)).toMatchObject({ TargetCurrency: 'USD' });
    c.s.goals.setGoalFrom(c.trip, '2026-07', null, fields(210_000));
    expect(storedRows(c.db).find((r) => r.ID === id)).toMatchObject({
      Target: 210_000,
      TargetCurrency: null,
    });
    // Earlier months keep their budget-currency goal.
    expect(c.s.goals.getGoalByCategoryID(c.trip, '2026-03').TargetCurrency ?? null).toBeNull();
  });

  it('restoring a deleted goal brings its currency back and ignores computed fields', () => {
    run(
      c.db,
      `INSERT INTO currency_rates (FromCurrency, ToCurrency, Rate, RateDate, LastUpdated, BudgetID)
               VALUES ('USD', 'EUR', 0.9, ?, ?, ?)`,
      TODAY,
      TODAY,
      c.budgetId
    );
    c.s.goals.createGoal(
      GoalType.MONTHLY,
      c.trip,
      asMilli(100_000),
      '2026-06-01',
      '',
      GoalPurpose.SPENDING,
      false,
      null,
      {},
      'USD'
    );
    const [goal] = c.s.goals.getGoalTimeframes(c.trip);
    expect(goal.TargetConverted).toBe(90_000);
    c.s.goals.deleteGoalsForCategory(c.trip);
    c.s.goals.restoreGoal(goal as never);
    expect(storedRows(c.db)).toEqual([{ ID: goal.ID, Target: 100_000, TargetCurrency: 'USD' }]);
    expect(goalRow(goal)).not.toHaveProperty('TargetConverted');
    expect(goalRow(goal)).not.toHaveProperty('TargetRateSource');
  });
});

describe('goal target currency: conversion on read', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  const official = (from: string, to: string, rate: number, date = TODAY) =>
    run(
      c.db,
      `INSERT INTO currency_rates (FromCurrency, ToCurrency, Rate, RateDate, LastUpdated, BudgetID)
       VALUES (?, ?, ?, ?, ?, ?)`,
      from,
      to,
      rate,
      date,
      date,
      c.budgetId
    );
  const usdGoal = (target = 1_000_000) =>
    c.s.goals.createGoal(
      GoalType.TARGET_BALANCE,
      c.trip,
      asMilli(target),
      '2026-01-01',
      '',
      GoalPurpose.SAVINGS,
      false,
      null,
      {},
      'USD'
    );
  const read = () => c.s.goals.getGoalByCategoryID(c.trip, '2026-06');

  beforeEach(async () => {
    c = await setup();
  });

  it("converts at today's official rate", () => {
    official('USD', 'EUR', 0.92);
    usdGoal(1_234_567);
    expect(read()).toMatchObject({
      Target: 1_234_567,
      TargetCurrency: 'USD',
      TargetConverted: Math.round(1_234_567 * 0.92),
      TargetRateSource: 'official',
    });
  });

  it('uses the reciprocal official quote when only that one is cached', () => {
    official('EUR', 'USD', 1.25);
    usdGoal(1_000_000);
    expect(read()).toMatchObject({ TargetConverted: 800_000, TargetRateSource: 'official' });
  });

  it('a custom rate covering today wins over the official one', () => {
    official('USD', 'EUR', 0.92);
    c.db
      .prepare(
        `INSERT INTO custom_currency_rates (FromCurrency, ToCurrency, Rate, StartDate, EndDate, BudgetID)
         VALUES ('USD', 'EUR', 0.8, '2026-06-01', '2026-06-30', ?)`
      )
      .run(c.budgetId);
    usdGoal(1_000_000);
    expect(read()).toMatchObject({ TargetConverted: 800_000, TargetRateSource: 'custom' });
  });

  it('a manual rate serves when no official rate is recent, then the newest cached one', () => {
    official('USD', 'EUR', 0.7, '2026-01-02');
    usdGoal(1_000_000);
    expect(read()).toMatchObject({ TargetConverted: 700_000, TargetRateSource: 'stale' });
    c.s.currency.saveManualRate('USD', 'EUR', 0.95, c.budgetId);
    expect(read()).toMatchObject({ TargetConverted: 950_000, TargetRateSource: 'manual' });
    official('USD', 'EUR', 0.9, '2026-06-10');
    expect(read()).toMatchObject({ TargetConverted: 900_000, TargetRateSource: 'official' });
  });

  it('without any rate the target counts 1:1 and says so', () => {
    usdGoal(500_000);
    expect(read()).toMatchObject({ TargetConverted: 500_000, TargetRateSource: 'missing' });
  });

  it('leaves budget-currency goals untouched (no computed fields)', () => {
    official('USD', 'EUR', 0.92);
    c.s.goals.createGoal(GoalType.MONTHLY, c.subs, asMilli(50_000), '2026-01-01', '');
    const [goal] = c.s.goals.getGoalsForMonth('2026-06');
    expect(goal).not.toHaveProperty('TargetConverted');
    expect(goal).not.toHaveProperty('TargetRateSource');
    expect(goalTargetInBudgetCurrency(goal)).toBe(50_000);
  });

  it('every read path converts: all goals, a month, categories, timeframes', () => {
    official('USD', 'EUR', 0.5);
    usdGoal(1_000_000);
    const converted = (goals: Goal[]) => goals.map((goal) => goal.TargetConverted);
    expect(converted(c.s.goals.getAllGoals())).toEqual([500_000]);
    expect(converted(c.s.goals.getGoalsForMonth('2026-06'))).toEqual([500_000]);
    expect(converted(c.s.goals.getGoalsByCategoryIDs([c.trip], '2026-06'))).toEqual([500_000]);
    expect(converted(c.s.goals.getGoalTimeframes(c.trip))).toEqual([500_000]);
    expect(c.s.goals.getForeignGoalCurrencies()).toEqual([
      { budgetId: c.budgetId, budgetCurrency: 'EUR', currency: 'USD' },
    ]);
  });

  it('a stored currency equal to the budget currency is treated as the budget currency', () => {
    usdGoal(1_000_000);
    run(c.db, `UPDATE goals SET TargetCurrency = 'eur'`);
    expect(read()).not.toHaveProperty('TargetConverted');
    expect(goalTargetCurrency(read(), 'EUR')).toBeNull();
    expect(c.s.goals.getForeignGoalCurrencies()).toEqual([]);
  });

  it('the stored-rate lookup reads without writing', () => {
    official('EUR', 'USD', 1.25);
    const count = () =>
      allRows<{ n: number }>(c.db, 'SELECT COUNT(*) AS n FROM currency_rates')[0].n;
    const before = count();
    expect(lookupStoredRate(c.db, 'USD', 'EUR', TODAY, c.budgetId)).toEqual({
      rate: 0.8,
      source: 'official',
    });
    expect(count()).toBe(before);
    // Future dates read today's rate.
    expect(lookupStoredRate(c.db, 'USD', 'EUR', '2027-01-01', c.budgetId)?.rate).toBe(0.8);
    expect(lookupStoredRate(c.db, 'GBP', 'EUR', TODAY, c.budgetId)).toBeNull();
  });
});

describe('goal target currency: calculations for every goal type', () => {
  const month = '2026-06';
  // $1,000.00 target; 0.9 EUR per USD → €900.00 in the budget currency.
  const RATE = 0.9;
  const base = (overrides: Partial<Goal>): Goal =>
    ({
      ID: 1,
      CategoryID: 1,
      Target: asMilli(1_000_000),
      StartDate: '2026-01-01',
      TargetDate: '',
      Recurring: false,
      ...overrides,
    }) as Goal;
  const foreign = (goal: Goal): Goal => ({
    ...goal,
    TargetCurrency: 'USD',
    TargetConverted: asMilli(Math.round(goal.Target * RATE)),
    TargetRateSource: 'official',
  });
  const domestic = (goal: Goal): Goal => ({
    ...goal,
    Target: asMilli(Math.round(goal.Target * RATE)),
  });
  const finances: CategoryFinancials = {
    available: 300_000,
    assigned: 100_000,
    activity: -20_000,
    previousBalance: 220_000,
    historicalAssignments: [
      { month: '2026-02', amount: 100_000 },
      { month: '2026-03', amount: 100_000 },
      { month: '2026-04', amount: 50_000 },
      { month: '2026-05', amount: 0 },
    ],
    historicalActivity: [{ month: '2026-04', amount: -30_000 }],
    plannedAssignments: [],
  };

  const cases: [string, Goal][] = [
    ['monthly spending', base({ Type: GoalType.MONTHLY, Purpose: GoalPurpose.SPENDING })],
    [
      'yearly spending',
      base({ Type: GoalType.YEARLY, Purpose: GoalPurpose.SPENDING, TargetDate: '2026-12-31' }),
    ],
    [
      'periodic (quarterly) available target',
      base({
        Type: GoalType.YEARLY,
        Purpose: GoalPurpose.SPENDING,
        TargetDate: '2026-06-30',
        Recurring: true,
        CycleMonths: 3,
      }),
    ],
    [
      'target date savings',
      base({
        Type: GoalType.TARGET_DATE,
        Purpose: GoalPurpose.SAVINGS,
        StartDate: '2026-02-01',
        TargetDate: '2026-12-31',
      }),
    ],
    [
      'repeating target date savings',
      base({
        Type: GoalType.TARGET_DATE,
        Purpose: GoalPurpose.SAVINGS,
        TargetDate: '2026-08-31',
        Recurring: true,
        CycleMonths: 6,
      }),
    ],
    ['monthly savings', base({ Type: GoalType.MONTHLY_SAVINGS, Purpose: GoalPurpose.SAVINGS })],
    ['target balance', base({ Type: GoalType.TARGET_BALANCE, Purpose: GoalPurpose.SAVINGS })],
  ];

  it.each(cases)(
    '%s: progress equals a budget-currency goal of the converted target',
    (_name, goal) => {
      const progress = GoalCalculations.calculateProgress(foreign(goal), finances, month);
      expect(progress).toEqual(GoalCalculations.calculateProgress(domestic(goal), finances, month));
      // …and differs from reading the dollar amount as euros.
      expect(progress).not.toEqual(GoalCalculations.calculateProgress(goal, finances, month));
    }
  );

  it('monthly spending: needs the converted target minus what is available', () => {
    const progress = GoalCalculations.calculateProgress(
      foreign(base({ Type: GoalType.MONTHLY, Purpose: GoalPurpose.SPENDING })),
      finances,
      month
    );
    expect(progress.monthlyTarget).toBe(900_000);
    // Spending this month does not count against it (available + spent = 320,000).
    expect(progress.amountNeeded).toBe(900_000 - 320_000);
  });

  it('monthly savings: the monthly ask is the converted amount', () => {
    const progress = GoalCalculations.calculateProgress(
      foreign(base({ Type: GoalType.MONTHLY_SAVINGS, Purpose: GoalPurpose.SAVINGS })),
      finances,
      month
    );
    expect(progress.monthlyTarget).toBe(900_000);
    expect(progress.amountNeeded).toBe(800_000);
  });

  it('a foreign goal without a computed conversion counts its target as is', () => {
    const goal = {
      ...base({ Type: GoalType.MONTHLY, Purpose: GoalPurpose.SPENDING }),
      TargetCurrency: 'USD',
    };
    expect(goalInBudgetCurrency(goal).Target).toBe(1_000_000);
  });

  it('end to end: the service reads, converts and calculates', async () => {
    const c = await setup();
    run(
      c.db,
      `INSERT INTO currency_rates (FromCurrency, ToCurrency, Rate, RateDate, LastUpdated, BudgetID)
       VALUES ('USD', 'EUR', 0.9, ?, ?, ?)`,
      TODAY,
      TODAY,
      c.budgetId
    );
    c.s.goals.createGoal(
      GoalType.MONTHLY_SAVINGS,
      c.trip,
      asMilli(200_000),
      '2026-01-01',
      '',
      GoalPurpose.SAVINGS,
      false,
      null,
      {},
      'USD'
    );
    c.s.monthlyBudgets.upsertMonthlyAssignment(c.trip, asMilli(100_000), month, c.budgetId);
    const finances = c.s.goals.getCategoryFinancials(c.trip, month, {
      Available: 100_000,
      Assigned: 100_000,
      Activity: 0,
    } as never);
    const progress = c.s.goals.calculateGoalProgressByCategoryId(c.trip, finances, month);
    expect(progress.monthlyTarget).toBe(180_000);
    expect(progress.amountNeeded).toBe(80_000);
  });
});

describe('goal target currency: budget currency change', () => {
  it('converts budget-currency goals only; a goal in the new currency becomes a budget-currency goal', async () => {
    const c = await setup('EUR');
    const create = (category: number, target: number, currency: string | null) =>
      c.s.goals.createGoal(
        GoalType.MONTHLY,
        category,
        asMilli(target),
        '2026-01-01',
        '',
        GoalPurpose.SPENDING,
        false,
        null,
        {},
        currency
      );
    const group = c.s.categories.addCategoryGroup('More', c.budgetId);
    const third = c.s.categories.addCategory(group, c.budgetId, 'Third', '');
    const eurGoal = create(c.trip, 100_000, null);
    const usdGoal = create(c.subs, 200_000, 'USD');
    const gbpGoal = create(third, 300_000, 'GBP');
    const book = new RateBook();
    book.add({ from: 'EUR', to: 'GBP', date: TODAY, rate: 0.85 });
    applyBudgetCurrencyChange(
      c.db,
      c.budgetId,
      { fromCurrency: 'EUR', toCurrency: 'GBP', asOf: TODAY, rates: [] },
      book,
      {
        replaceRateCache: () => {},
        clearConvertedAmounts: () => {},
        setDisplayCurrency: (currency) =>
          run(c.db, 'UPDATE budgets SET DisplayCurrency = ? WHERE ID = ?', currency, c.budgetId),
      }
    );
    expect(storedRows(c.db)).toEqual([
      { ID: eurGoal, Target: 85_000, TargetCurrency: null },
      { ID: usdGoal, Target: 200_000, TargetCurrency: 'USD' },
      { ID: gbpGoal, Target: 300_000, TargetCurrency: null },
    ]);
  });
});

describe('goal target currency: undo journals', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    c = await setup();
  });
  const create = (category: number, currency: string | null) =>
    c.s.goals.createGoal(
      GoalType.MONTHLY,
      category,
      asMilli(100_000),
      '2026-01-01',
      '',
      GoalPurpose.SPENDING,
      false,
      null,
      {},
      currency
    );

  it('a deleted budget-currency goal is journaled without the column, so older builds can restore it', () => {
    create(c.trip, null);
    const before = storedRows(c.db);
    const { journal } = recordRowChanges(c.db, () => c.s.goals.deleteGoalsForCategory(c.trip));
    const row = journal!.deleted.find((entry) => entry.table === 'goals')!.rows[0];
    expect(row).not.toHaveProperty('TargetCurrency');
    expect(JSON.stringify(journal)).not.toContain('TargetCurrency');
    c.s.rowJournal.restore(journal!);
    expect(storedRows(c.db)).toEqual(before);
  });

  it('a deleted foreign goal keeps its currency in the journal and gets it back', () => {
    create(c.trip, 'USD');
    const before = storedRows(c.db);
    const { journal } = recordRowChanges(c.db, () => c.s.goals.deleteGoalsForCategory(c.trip));
    expect(journal!.deleted.find((entry) => entry.table === 'goals')!.rows[0]).toMatchObject({
      TargetCurrency: 'USD',
    });
    c.s.rowJournal.restore(journal!);
    expect(storedRows(c.db)).toEqual(before);
  });

  it('a currency change is journaled and undone exactly', () => {
    create(c.trip, null);
    const before = storedRows(c.db);
    const { journal } = recordRowChanges(c.db, () =>
      c.s.goals.updateGoal(
        c.trip,
        asMilli(150_000),
        GoalType.MONTHLY,
        '',
        GoalPurpose.SPENDING,
        false,
        null,
        null,
        null,
        'USD'
      )
    );
    expect(journal!.changed[0].values).toMatchObject({ Target: 100_000, TargetCurrency: null });
    c.s.rowJournal.restore(journal!);
    expect(storedRows(c.db)).toEqual(before);
  });
});

describe('goal target currency: export', () => {
  it('exports the stored currency, not the computed conversion', async () => {
    const c = await setup();
    c.s.goals.createGoal(
      GoalType.MONTHLY,
      c.trip,
      asMilli(100_000),
      '2026-01-01',
      '',
      GoalPurpose.SPENDING,
      false,
      null,
      {},
      'USD'
    );
    const goals = c.s.goals.getAllGoals().map(goalRow);
    expect(goals[0]).toMatchObject({ TargetCurrency: 'USD' });
    expect(goals[0]).not.toHaveProperty('TargetConverted');
  });
});
