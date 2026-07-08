import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

describe('AnalyticsService', () => {
  it('computes spending, income, balances and group breakdowns', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, accounts, categories, transactions, analytics, monthlyBudgets } =
      sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'Analytics',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const accOn = await accounts.createAccount('On', budgetId, 'checking', 'USD', 0, {}, true);
    const accOff = await accounts.createAccount(
      'Off',
      budgetId,
      'other asset',
      'USD',
      0,
      {},
      false
    );

    const allCats = categories.getAllCategories(budgetId);
    const incomeCategory = allCats.find((c) => c.Name === 'Income');
    if (!incomeCategory) throw new Error('Income category not found');
    const incomeCat = incomeCategory.ID;
    // Ensure a non-income group exists and has a category
    const testGroupId = categories.addCategoryGroup('Test Group', budgetId);
    const foodId = categories.addCategory(testGroupId, budgetId, 'Food');

    // Assign some budget in the month for hasAssignments in categories
    monthlyBudgets.upsertMonthlyAssignment(foodId, 200, '2024-01', budgetId);

    // Transactions on different days
    await transactions.addTransaction(1000, 0, accOn.ID, incomeCat, budgetId, '2024-01-01', 'pay');
    await transactions.addTransaction(0, 50, accOn.ID, foodId, budgetId, '2024-01-02', 'groceries');
    await transactions.addTransaction(0, 25, accOn.ID, foodId, budgetId, '2024-01-03', 'snack');
    // Off-budget should be ignored in analytics spending
    await transactions.addTransaction(0, 999, accOff.ID, foodId, budgetId, '2024-01-04', 'ignored');

    // Spending by dates
    const byDates = analytics.getSpendingByDates('2024-01-01', '2024-01-05', budgetId);
    expect(byDates.find((d) => d.Date.endsWith('-02'))?.Spending).toBe(50);
    expect(byDates.find((d) => d.Date.endsWith('-03'))?.Spending).toBe(25);

    // Spending by group per-day rollup
    const byGroups = analytics.getSpendingByDatesByCategories('2024-01-01', '2024-01-05', budgetId);
    // At least one row for Test Group on spending dates
    expect(
      byGroups.some(
        (r) => r.CategoryGroupName === 'Test Group' && (r.Spending === 50 || r.Spending === 25)
      )
    ).toBe(true);

    // Spending by categories in a specific group
    const spendInGroup = analytics.getSpendingByCategoriesInGroup(
      '2024-01-01',
      '2024-01-31',
      budgetId,
      testGroupId
    );
    expect(spendInGroup.reduce((a, r) => a + (r.Spending || 0), 0)).toBe(75);

    // On-budget balances
    const onBudgetBalance = analytics.getOnBudgetBalance(budgetId);
    expect(onBudgetBalance).toBeGreaterThan(0);
    const balanceSeries = analytics.getOnBudgetBalanceByDates('2024-01-01', '2024-01-05', budgetId);
    expect(balanceSeries.length).toBe(5);
    expect(balanceSeries[0].Balance).toBeGreaterThan(0);
  });

  it('computes on-budget daily balances without double-counting end date', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, accounts, categories, transactions, analytics } = sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'Balances-No-Double-Count',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const accOn = await accounts.createAccount('On', budgetId, 'checking', 'USD', 0, {}, true);
    const incomeCategory = categories.getAllCategories(budgetId).find((c) => c.Name === 'Income');
    if (!incomeCategory) throw new Error('Income category not found');
    const incomeCat = incomeCategory.ID;

    // Single transaction on the END date of the range
    const start = '2025-09-04';
    const end = '2025-09-11';
    await transactions.addTransaction(200, 0, accOn.ID, incomeCat, budgetId, end, 'end-day inflow');

    const series = analytics.getOnBudgetBalanceByDates(start, end, budgetId);
    // The series is clamped to the first transaction (here the end day), so the
    // earlier empty days are not back-filled with a flat baseline.
    expect(series.length).toBe(1);
    expect(series[0].Date).toBe(end);

    // The single day should equal the closing on-budget balance, not doubled
    const closing = analytics.getOnBudgetBalance(budgetId) as { TotalBalance?: number };
    expect(series[series.length - 1].Balance).toBe(closing.TotalBalance ?? closing);
  });

  it('clamps the balance series to the first transaction date', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, accounts, categories, transactions, analytics } = sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'Balances-Clamp',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const accOn = await accounts.createAccount('On', budgetId, 'checking', 'USD', 0, {}, true);
    const incomeCategory = categories.getAllCategories(budgetId).find((c) => c.Name === 'Income');
    if (!incomeCategory) throw new Error('Income category not found');
    const incomeCat = incomeCategory.ID;

    // First (and only) cash transaction lands in the middle of the requested range.
    await transactions.addTransaction(150, 0, accOn.ID, incomeCat, budgetId, '2025-09-08', 'first');

    const series = analytics.getOnBudgetBalanceByDates('2025-09-04', '2025-09-11', budgetId);
    // Days before the first transaction (09-04..09-07) are dropped, not back-filled.
    expect(series[0].Date).toBe('2025-09-08');
    expect(series.length).toBe(4); // 09-08..09-11 inclusive
    expect(series.every((r) => r.Balance === 150)).toBe(true);

    // A range entirely before the first transaction returns no rows (so trend math
    // never divides by a bogus pre-history baseline).
    const empty = analytics.getOnBudgetBalanceByDates('2025-08-01', '2025-08-31', budgetId);
    expect(empty.length).toBe(0);
  });

  it('includes split transaction lines in spending-by-category-group drilldown', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, accounts, categories, transactions, analytics, splits } = sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'Analytics Splits',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const accOn = await accounts.createAccount('On', budgetId, 'checking', 'USD', 0, {}, true);
    const tripsGroupId = categories.addCategoryGroup('Trips', budgetId);
    const flightsId = categories.addCategory(tripsGroupId, budgetId, 'Flights');
    const hotelsId = categories.addCategory(tripsGroupId, budgetId, 'Hotels');

    const parentId = await transactions.addTransaction(
      0,
      120,
      accOn.ID,
      flightsId,
      budgetId,
      '2024-02-10',
      'Split travel expense'
    );

    await splits.upsertSplits(parentId, [
      {
        CategoryID: flightsId,
        Memo: 'Flight ticket',
        Inflow: 0,
        Outflow: 70,
        OrderIndex: 0,
      },
      {
        CategoryID: hotelsId,
        Memo: 'Hotel stay',
        Inflow: 0,
        Outflow: 50,
        OrderIndex: 1,
      },
    ]);

    const spendInGroup = analytics.getSpendingByCategoriesInGroup(
      '2024-02-01',
      '2024-02-29',
      budgetId,
      tripsGroupId
    );
    const byCategory = new Map(spendInGroup.map((row) => [row.CategoryName, row.Spending]));

    expect(byCategory.get('Flights')).toBe(70);
    expect(byCategory.get('Hotels')).toBe(50);

    const drilldownTotal = spendInGroup.reduce((sum, row) => sum + (row.Spending || 0), 0);

    const topLevel = analytics
      .getSpendingByDatesByCategories('2024-02-01', '2024-02-29', budgetId)
      .filter((row) => row.CategoryGroupID === tripsGroupId);
    const topLevelTotal = topLevel.reduce((sum, row) => sum + (row.Spending || 0), 0);

    expect(drilldownTotal).toBe(120);
    expect(topLevelTotal).toBe(120);
  });

  it('groups spending by labels with unlabeled bucket and excludes transfers', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, accounts, categories, transactions, analytics, labels, splits } =
      sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'Analytics Labels',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const account = await accounts.createAccount(
      'On Budget',
      budgetId,
      'checking',
      'USD',
      0,
      {},
      true
    );

    const allCategories = categories.getAllCategories(budgetId);
    const incomeCategory = allCategories.find((c) => c.Name === 'Income');
    const transferCategory = allCategories.find((c) => c.Name === 'Transfers');
    if (!incomeCategory) throw new Error('Income category not found');
    if (!transferCategory) throw new Error('Transfers category not found');

    const groupId = categories.addCategoryGroup('Household', budgetId);
    const groceriesId = categories.addCategory(groupId, budgetId, 'Groceries');

    const diningLabelId = labels.addLabel(budgetId, 'Dining', '#EF4444');
    const travelLabelId = labels.addLabel(budgetId, 'Travel', '#3B82F6');

    await transactions.addTransaction(
      0,
      40,
      account.ID,
      groceriesId,
      budgetId,
      '2024-04-01',
      'Dinner',
      '',
      '',
      diningLabelId
    );
    await transactions.addTransaction(
      0,
      20,
      account.ID,
      groceriesId,
      budgetId,
      '2024-04-03',
      'Coffee',
      '',
      '',
      diningLabelId
    );
    await transactions.addTransaction(
      0,
      60,
      account.ID,
      groceriesId,
      budgetId,
      '2024-04-04',
      'Unlabeled groceries'
    );

    const splitParentId = await transactions.addTransaction(
      0,
      50,
      account.ID,
      groceriesId,
      budgetId,
      '2024-04-05',
      'Trip split',
      '',
      '',
      travelLabelId
    );

    await splits.upsertSplits(splitParentId, [
      {
        CategoryID: groceriesId,
        Memo: 'Flight',
        Inflow: 0,
        Outflow: 30,
        OrderIndex: 0,
      },
      {
        CategoryID: groceriesId,
        Memo: 'Meals',
        Inflow: 0,
        Outflow: 20,
        OrderIndex: 1,
      },
    ]);

    await transactions.addTransaction(
      0,
      999,
      account.ID,
      transferCategory.ID,
      budgetId,
      '2024-04-06',
      'Transfer should be excluded',
      '',
      '',
      diningLabelId
    );
    await transactions.addTransaction(
      1000,
      0,
      account.ID,
      incomeCategory.ID,
      budgetId,
      '2024-04-06',
      'Income should be excluded',
      '',
      '',
      travelLabelId
    );

    const byLabel = analytics.getSpendingByLabels('2024-04-01', '2024-04-30', budgetId);
    const labelMap = new Map(byLabel.map((row) => [row.Label, row.Spending]));

    expect(labelMap.get('Dining')).toBe(60);
    expect(labelMap.get('Travel')).toBe(50);
    expect(labelMap.get('Unlabeled')).toBe(60);
    expect(byLabel.find((row) => row.Label === 'Unlabeled')).toBeDefined();
  });
});
