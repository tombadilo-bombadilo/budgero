import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, asMilli } from '../src';

describe('MonthlyBudgetService', () => {
  it('rounds fractional averages and batch amounts to integer milliunits', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, categories, monthlyBudgets } = sm.getServices();
    const budgetId = await budgets.createBudget({
      name: 'Round',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const g = categories.addCategoryGroup('G', budgetId);
    const cat = categories.addCategory(g, budgetId, 'Cat');

    // avg(100, 100, 101) = 100.33... must round to an integer milliunit
    monthlyBudgets.upsertMonthlyAssignment(cat, asMilli(100), '2024-01', budgetId);
    monthlyBudgets.upsertMonthlyAssignment(cat, asMilli(100), '2024-02', budgetId);
    monthlyBudgets.upsertMonthlyAssignment(cat, asMilli(101), '2024-03', budgetId);
    const avg = monthlyBudgets.getAverageAssigned(cat);
    expect(avg).not.toBeNull();
    expect(Number.isInteger(avg as number)).toBe(true);
    expect(avg).toBe(100);

    // Batch upsert with a fractional amount is rounded before storage
    monthlyBudgets.batchUpsertMonthlyAssignments([
      { categoryId: cat, amount: 100.5714285, month: '2024-04', budgetId },
    ]);
    const stored = monthlyBudgets.getMonthlyAssignment(cat, '2024-04')?.Amount;
    expect(Number.isInteger(stored as number)).toBe(true);
    expect(stored).toBe(101);
  });

  it('covers assignments, queries, summaries, and helpers', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const { budgets, categories, monthlyBudgets, accounts, transactions } = services;

    const budgetId = await budgets.createBudget({
      name: 'MB',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Category setup: a custom group with two categories
    const g = categories.addCategoryGroup('Group', budgetId);
    const food = categories.addCategory(g, budgetId, 'Food');
    const rent = categories.addCategory(g, budgetId, 'Rent');

    // 1) Upsert monthly assignment (insert), get, then update
    monthlyBudgets.upsertMonthlyAssignment(food, 200, '2024-01', budgetId);
    let a = monthlyBudgets.getMonthlyAssignment(food, '2024-01');
    expect(a?.Amount).toBe(200);
    monthlyBudgets.updateMonthlyAssignment(food, 150, '2024-01');
    a = monthlyBudgets.getMonthlyAssignment(food, '2024-01');
    expect(a?.Amount).toBe(150);

    // Add another month to compute average
    monthlyBudgets.upsertMonthlyAssignment(food, 250, '2024-02', budgetId);
    const avg = monthlyBudgets.getAverageAssigned(food);
    expect(avg).toBeGreaterThan(0);

    // Last month from service helper (checks internal date math)
    const lastForFeb = monthlyBudgets.getAssignedLastMonth('2024-02', food);
    expect(lastForFeb).toBe(150);

    // Multiple categories sum in specific month
    monthlyBudgets.upsertMonthlyAssignment(rent, 400, '2024-02', budgetId);
    const sumFeb = monthlyBudgets.getAssignedLastMonthByCategoryIds('2024-02', [food, rent]);
    expect(sumFeb).toBe(650);

    // Batch upsert for another month + update path
    monthlyBudgets.batchUpsertMonthlyAssignments([
      { categoryId: food, amount: 100, month: '2024-03', budgetId },
      { categoryId: rent, amount: 200, month: '2024-03', budgetId },
    ]);
    // Update existing in batch
    monthlyBudgets.batchUpsertMonthlyAssignments([
      { categoryId: food, amount: 120, month: '2024-03', budgetId },
    ]);
    expect(monthlyBudgets.getMonthlyAssignment(food, '2024-03')?.Amount).toBe(120);

    // Range sum across months
    const rangeSum = monthlyBudgets.getAssignedForCategoryInRange(food, '2024-01', '2024-03');
    expect(rangeSum).toBe(150 + 250 + 120);

    // Exclude rent from budget pace and compute total assigned for pace across months
    categories.updateCategoryExcludeFromBudgetPace(rent, true);
    const paceTotal = monthlyBudgets.getTotalAssignedForBudgetPace(
      ['2024-01', '2024-02', '2024-03'],
      budgetId
    );
    expect(paceTotal).toBe(150 + 250 + 120);

    // Ready to assign depends on Income minus all assignments; add Income inflow
    const incomeCategory = categories
      .getAllCategories(budgetId)
      .find((c: { Name: string }) => c.Name === 'Income');
    if (!incomeCategory) throw new Error('Income category not found');
    const incomeId = incomeCategory.ID;
    const acc = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0);
    await transactions.addTransaction(1000, 0, acc.ID, incomeId, budgetId, '2024-01-01', 'income');
    const rta = monthlyBudgets.getReadyToAssign(budgetId);
    expect(typeof rta).toBe('number');
    expect(rta).toBeGreaterThan(-1000); // sanity: not wildly off

    // Has assignments flag
    expect(monthlyBudgets.hasAssignments(food)).toBe(true);

    // Monthly budget composed view
    const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
    expect(mb.find((row: { Category: string }) => row.Category === 'Food')).toBeTruthy();

    // Reassign all assignments from Food -> Rent
    monthlyBudgets.reassignAssignment(rent, food);
    expect(monthlyBudgets.getMonthlyAssignment(food, '2024-02')).toBeNull();
    expect(monthlyBudgets.hasAssignments(rent)).toBe(true);
  });

  it('merges assignment amounts when reassigning to a category with existing assignments', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const { budgets, categories, monthlyBudgets } = services;

    const budgetId = await budgets.createBudget({
      name: 'Reassign Merge Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const g = categories.addCategoryGroup('Group', budgetId);
    const cat1 = categories.addCategory(g, budgetId, 'Cat 1');
    const cat2 = categories.addCategory(g, budgetId, 'Cat 2');

    // Both categories have assignments for the same month
    monthlyBudgets.upsertMonthlyAssignment(cat1, 100, '2024-01', budgetId);
    monthlyBudgets.upsertMonthlyAssignment(cat2, 200, '2024-01', budgetId);

    // Reassign cat1 -> cat2
    monthlyBudgets.reassignAssignment(cat2, cat1);

    // cat1 should have no assignments
    expect(monthlyBudgets.getMonthlyAssignment(cat1, '2024-01')).toBeNull();
    expect(monthlyBudgets.hasAssignments(cat1)).toBe(false);

    // cat2 should have merged amount (200 + 100 = 300)
    const merged = monthlyBudgets.getMonthlyAssignment(cat2, '2024-01');
    expect(merged?.Amount).toBe(300);

    // Updating cat2's assignment should not produce duplicates
    monthlyBudgets.upsertMonthlyAssignment(cat2, 500, '2024-01', budgetId);
    const afterUpdate = monthlyBudgets.getMonthlyAssignment(cat2, '2024-01');
    expect(afterUpdate?.Amount).toBe(500);

    // Verify the monthly budget view also reports the correct single value
    const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
    const cat2Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cat2);
    expect(cat2Row?.Assigned).toBe(500);
  });

  describe('Credit Card Payment Tracking (YNAB-style)', () => {
    it('creates CC Payment category when creating credit card account', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts } = services;

      const budgetId = await budgets.createBudget({
        name: 'CC Test Budget',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      // Create a credit card account
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
        debt_total: 600,
      });

      // Verify CC Payment category was created under "Credit Card Payments" group
      const ccPaymentsGroup = categories.getCategoryGroupByName('Credit Card Payments', budgetId);
      expect(ccPaymentsGroup).toBeTruthy();

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      expect(ccPaymentCategory).toBeTruthy();
      expect(ccPaymentCategory?.CategoryGroupID).toBe(ccPaymentsGroup?.ID);

      // Verify cc_payment_category_id is stored in account metadata
      const account = accounts.getAccount(cc.ID);
      const metadata = JSON.parse(account.Metadata || '{}');
      expect(metadata.cc_payment_category_id).toBe(ccPaymentCategory?.ID);
    });

    it('auto-funds CC Payment only from BUDGETED CC spending', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'CC Spending Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      // Create checking account and CC account
      const _checking = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 1000);
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
        debt_total: 0,
      });

      // Create a spending category (Groceries) and ASSIGN money to it
      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      // Assign $100 to Groceries
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 100, '2024-01', budgetId);

      // Get CC Payment category
      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      expect(ccPaymentCategory).toBeTruthy();

      // Spend $50 on groceries using the CC (budgeted spending)
      await transactions.addTransaction(
        0,
        50,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-15',
        'Whole Foods'
      );

      // Get monthly budget
      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );
      const groceriesRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === groceriesCategory
      );

      // Groceries: Assigned $100, Activity -$50, Available $50
      expect(groceriesRow?.Assigned).toBe(100);
      expect(groceriesRow?.Activity).toBe(-50);
      expect(groceriesRow?.Available).toBe(50);

      // CC Payment: Activity = 0 (no payments), Available = $50 (funded from budgeted groceries spend)
      expect(ccPaymentRow).toBeTruthy();
      expect(ccPaymentRow?.Activity).toBe(0);
      expect(ccPaymentRow?.Available).toBe(50);
    });

    it('does NOT fund CC Payment from overspent categories', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'CC Overspend Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0);

      // Create a spending category with NO assignment (unbudgeted)
      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);

      // Spend $50 on groceries using CC, but Groceries has $0 budget
      await transactions.addTransaction(
        0,
        50,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-15',
        'Overspent groceries'
      );

      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );
      const groceriesRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === groceriesCategory
      );

      // Groceries: Assigned $0, Activity -$50, Available -$50 (overspent)
      expect(groceriesRow?.Assigned).toBe(0);
      expect(groceriesRow?.Activity).toBe(-50);
      expect(groceriesRow?.Available).toBe(-50);

      // CC Payment: Available = $0 (no money moved - this is CC debt!)
      expect(ccPaymentRow?.Activity).toBe(0);
      expect(ccPaymentRow?.Available).toBe(0);
    });

    it('partially funds CC Payment when category is partially budgeted', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Partial Budget Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      // Assign only $30 to Groceries
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 30, '2024-01', budgetId);

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);

      // Spend $50 on CC (but only $30 was budgeted)
      await transactions.addTransaction(
        0,
        50,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-15',
        'Groceries'
      );

      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );
      const groceriesRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === groceriesCategory
      );

      // Groceries: Assigned $30, Activity -$50, Available -$20 (overspent by $20)
      expect(groceriesRow?.Assigned).toBe(30);
      expect(groceriesRow?.Activity).toBe(-50);
      expect(groceriesRow?.Available).toBe(-20);

      // CC Payment: Only $30 funded (the budgeted portion), $20 is CC debt
      expect(ccPaymentRow?.Activity).toBe(0);
      expect(ccPaymentRow?.Available).toBe(30);
    });

    it('draws from CC Payment when making a payment to the credit card', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'CC Payment Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      // Create checking and CC accounts
      const checking = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 1000);
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
        debt_total: 0,
      });

      // Create spending category and BUDGET for it
      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 100, '2024-01', budgetId);

      // Get CC Payment category and Transfers category
      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      const transfersCategory = categories.getCategoryByName('Transfers', budgetId);

      // 1. Spend $100 on groceries using CC (fully budgeted)
      await transactions.addTransaction(
        0,
        100,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-10',
        'Groceries'
      );

      // 2. Pay off the CC with $100 from checking (create transfer)
      const transferId = `cc_pay_${Date.now()}`;
      await transactions.addTransaction(
        0,
        100,
        checking.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-20',
        'Transfer to Chase CC',
        transferId
      );
      await transactions.addTransaction(
        100,
        0,
        cc.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-20',
        'Transfer from Checking',
        transferId
      );

      // Check CC Payment category
      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      expect(ccPaymentRow).toBeTruthy();
      // Activity = -100 (payment to CC shows as negative)
      expect(ccPaymentRow?.Activity).toBe(-100);
      // Available = 0 (assigned) + 100 (funded) - 100 (paid) = 0
      expect(ccPaymentRow?.Available).toBe(0);
    });

    it('shows negative CC Payment Available when paying off legacy debt', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Legacy Debt Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      // Create checking with $2000 and CC with $600 legacy debt
      const checking = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 2000);
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
        debt_total: 600,
      });

      // Get CC Payment category and Transfers category
      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      const transfersCategory = categories.getCategoryByName('Transfers', budgetId);

      // Check initial state - no spending, no payments yet
      let mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      let ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Initially: Activity = 0, Available = 0 (no budgeted spending yet)
      expect(ccPaymentRow?.Activity).toBe(0);
      expect(ccPaymentRow?.Available).toBe(0);

      // User pays $200 toward the legacy debt (create transfer)
      const transferId = `cc_pay_legacy_${Date.now()}`;
      await transactions.addTransaction(
        0,
        200,
        checking.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-15',
        'Transfer to Chase CC',
        transferId
      );
      await transactions.addTransaction(
        200,
        0,
        cc.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-15',
        'Transfer from Checking',
        transferId
      );

      // Check CC Payment - should show negative because we paid more than set aside
      mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Activity = -200 (payment to CC)
      expect(ccPaymentRow?.Activity).toBe(-200);
      // Available = 0 (assigned) + 0 (funded) - 200 (paid) = -200
      // Negative shows we paid more than was set aside (paying down legacy debt)
      expect(ccPaymentRow?.Available).toBe(-200);
    });

    it('correctly handles mix of CC spending and payments', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Mixed CC Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const checking = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 5000);
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
        debt_total: 100, // $100 legacy debt
      });

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');
      const gasCategory = categories.addCategory(spendingGroup, budgetId, 'Gas');

      // Budget for spending categories
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 100, '2024-01', budgetId);
      monthlyBudgets.upsertMonthlyAssignment(gasCategory, 50, '2024-01', budgetId);

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      const transfersCategory = categories.getCategoryByName('Transfers', budgetId);

      // Scenario: $100 legacy debt, then user spends $50 groceries + $30 gas on CC (all budgeted)
      // Then user pays $150 to CC (more than funded spending, eating into legacy debt)

      // 1. Spend $50 groceries on CC (budgeted)
      await transactions.addTransaction(
        0,
        50,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-05',
        'Groceries'
      );

      // 2. Spend $30 gas on CC (budgeted)
      await transactions.addTransaction(0, 30, cc.ID, gasCategory, budgetId, '2024-01-06', 'Shell');

      // Check after spending, before payment
      let mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      let ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Activity = 0 (no payments yet)
      expect(ccPaymentRow?.Activity).toBe(0);
      // Available = 0 + 80 (funded from budgeted spending) - 0 = 80
      expect(ccPaymentRow?.Available).toBe(80);

      // 3. Pay $150 to CC (80 funded + 70 extra going to legacy debt)
      const transferId = `cc_pay_mixed_${Date.now()}`;
      await transactions.addTransaction(
        0,
        150,
        checking.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-20',
        'Transfer to Chase CC',
        transferId
      );
      await transactions.addTransaction(
        150,
        0,
        cc.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-20',
        'Transfer from Checking',
        transferId
      );

      // Check after payment
      mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Activity = -150 (payment to CC)
      expect(ccPaymentRow?.Activity).toBe(-150);
      // Available = 0 (assigned) + 80 (funded) - 150 (paid) = -70
      // This negative shows user paid $70 more than set aside (toward legacy debt)
      expect(ccPaymentRow?.Available).toBe(-70);
    });

    it('handles CC spending across multiple months correctly', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Multi-Month CC Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const checking = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 5000);
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      // Budget groceries for both months
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 100, '2024-01', budgetId);
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 100, '2024-02', budgetId);

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      const transfersCategory = categories.getCategoryByName('Transfers', budgetId);

      // January: Spend $100 on CC (fully budgeted)
      await transactions.addTransaction(
        0,
        100,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-15',
        'Jan groceries'
      );

      // February: Spend $50 more (budgeted)
      await transactions.addTransaction(
        0,
        50,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-02-15',
        'Feb groceries'
      );

      // Check February budget
      const mbFeb = monthlyBudgets.getMonthlyBudget('2024-02', budgetId);
      const ccPaymentRowFeb = mbFeb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // February Activity = 0 (no payments this month yet)
      expect(ccPaymentRowFeb?.Activity).toBe(0);

      // February Available = 0 (assigned) + 150 (funded: 100 prior + 50 current) - 0 (paid) = 150
      expect(ccPaymentRowFeb?.Available).toBe(150);

      // Now make a payment of $120 in February (create transfer)
      const transferId = `cc_pay_feb_${Date.now()}`;
      await transactions.addTransaction(
        0,
        120,
        checking.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-02-20',
        'Transfer to Chase CC',
        transferId
      );
      await transactions.addTransaction(
        120,
        0,
        cc.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-02-20',
        'Transfer from Checking',
        transferId
      );

      // Check February after payment
      const mbFebAfter = monthlyBudgets.getMonthlyBudget('2024-02', budgetId);
      const ccPaymentRowFebAfter = mbFebAfter.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // February Activity = -120 (payment this month)
      expect(ccPaymentRowFebAfter?.Activity).toBe(-120);

      // February Available = 0 (assigned) + 150 (funded) - 120 (paid) = 30
      expect(ccPaymentRowFebAfter?.Available).toBe(30);
    });

    it('CC Payment category respects manual assignments', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Assignment Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const checking = await accounts.createAccount('Checking', budgetId, 'checking', 'USD', 5000);
      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
        debt_total: 500, // Legacy debt
      });

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);
      const transfersCategory = categories.getCategoryByName('Transfers', budgetId);

      // User manually assigns $200 to CC Payment category to pay down legacy debt
      monthlyBudgets.upsertMonthlyAssignment(ccPaymentCategory?.ID ?? 0, 200, '2024-01', budgetId);

      // Check CC Payment with assignment
      let mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      let ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Assigned = 200, Activity = 0, Available = 200
      expect(ccPaymentRow?.Assigned).toBe(200);
      expect(ccPaymentRow?.Activity).toBe(0);
      expect(ccPaymentRow?.Available).toBe(200);

      // Now pay $200 toward the CC (create transfer)
      const transferId = `cc_pay_assign_${Date.now()}`;
      await transactions.addTransaction(
        0,
        200,
        checking.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-15',
        'Transfer to Chase CC',
        transferId
      );
      await transactions.addTransaction(
        200,
        0,
        cc.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-15',
        'Transfer from Checking',
        transferId
      );

      // Check after payment
      mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Assigned = 200, Activity = -200 (payment to CC)
      // Available = 200 (assigned) + 0 (funded) - 200 (paid) = 0
      expect(ccPaymentRow?.Assigned).toBe(200);
      expect(ccPaymentRow?.Activity).toBe(-200);
      expect(ccPaymentRow?.Available).toBe(0);
      // Display context: the card's signed balance rides the row so the UI can
      // contrast "set aside" with "owed" (card holds the $200 payment as credit).
      expect(ccPaymentRow?.cardBalance).toBe(200);
    });

    it('includes fundingBreakdown showing where CC Payment funding came from', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Funding Breakdown Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const cc = await accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceriesCategory = categories.addCategory(spendingGroup, budgetId, 'Groceries');
      const gasCategory = categories.addCategory(spendingGroup, budgetId, 'Gas');
      const diningCategory = categories.addCategory(spendingGroup, budgetId, 'Dining');

      // Budget for spending categories
      monthlyBudgets.upsertMonthlyAssignment(groceriesCategory, 100, '2024-01', budgetId);
      monthlyBudgets.upsertMonthlyAssignment(gasCategory, 50, '2024-01', budgetId);
      // Note: Dining is NOT budgeted (will be overspent)

      const ccPaymentCategory = categories.getCategoryByName('Chase CC', budgetId);

      // Spend on CC in multiple categories
      await transactions.addTransaction(
        0,
        60,
        cc.ID,
        groceriesCategory,
        budgetId,
        '2024-01-05',
        'Whole Foods'
      );
      await transactions.addTransaction(0, 30, cc.ID, gasCategory, budgetId, '2024-01-06', 'Shell');
      await transactions.addTransaction(
        0,
        25,
        cc.ID,
        diningCategory,
        budgetId,
        '2024-01-07',
        'Restaurant'
      ); // Overspent

      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const ccPaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === ccPaymentCategory?.ID
      );

      // Available = 60 (groceries, budgeted) + 30 (gas, budgeted) + 0 (dining, overspent) = 90
      expect(ccPaymentRow?.Available).toBe(90);
      expect(ccPaymentRow?.totalFunded).toBe(90);

      // fundingBreakdown should show which categories contributed
      expect(ccPaymentRow?.fundingBreakdown).toBeDefined();
      expect(ccPaymentRow?.fundingBreakdown?.length).toBe(2); // Groceries and Gas (not Dining)

      // Verify breakdown content
      const groceriesFunding = ccPaymentRow?.fundingBreakdown?.find(
        (f: { categoryId: number }) => f.categoryId === groceriesCategory
      );
      const gasFunding = ccPaymentRow?.fundingBreakdown?.find(
        (f: { categoryId: number }) => f.categoryId === gasCategory
      );
      const diningFunding = ccPaymentRow?.fundingBreakdown?.find(
        (f: { categoryId: number }) => f.categoryId === diningCategory
      );

      expect(groceriesFunding).toBeTruthy();
      expect(groceriesFunding?.categoryName).toBe('Groceries');
      expect(groceriesFunding?.amount).toBe(60);

      expect(gasFunding).toBeTruthy();
      expect(gasFunding?.categoryName).toBe('Gas');
      expect(gasFunding?.amount).toBe(30);

      // Dining should NOT be in breakdown (overspent category)
      expect(diningFunding).toBeUndefined();
    });

    it('attributes CC funding to the card that spent (not split across all cards)', async () => {
      // Regression test for bug where funded amount from a budgeted category
      // was applied identically to every CC payment category, instead of only
      // the card that actually did the spending.
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Multi-CC Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      // Two CC accounts
      const cc1 = await accounts.createAccount('CC 1', budgetId, 'credit', 'USD', 0);
      const cc2 = await accounts.createAccount('CC 2', budgetId, 'credit', 'USD', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceries = categories.addCategory(spendingGroup, budgetId, 'Groceries');
      const transport = categories.addCategory(spendingGroup, budgetId, 'Transport');

      // Groceries is budgeted, Transport is not
      monthlyBudgets.upsertMonthlyAssignment(groceries, 25, '2024-01', budgetId);

      const cc1PaymentCat = categories.getCategoryByName('CC 1', budgetId);
      const cc2PaymentCat = categories.getCategoryByName('CC 2', budgetId);

      // CC 2 spends on funded Groceries; CC 1 spends on overspent Transport.
      await transactions.addTransaction(0, 25, cc2.ID, groceries, budgetId, '2024-01-10', 'Store');
      await transactions.addTransaction(0, 25, cc1.ID, transport, budgetId, '2024-01-11', 'Gas');

      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const cc1Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cc1PaymentCat?.ID);
      const cc2Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cc2PaymentCat?.ID);

      // CC 1 only spent on overspent Transport → no funding
      expect(cc1Row?.Available).toBe(0);
      expect(cc1Row?.totalFunded).toBe(0);
      // CC 2 spent on funded Groceries → $25 funded
      expect(cc2Row?.Available).toBe(25);
      expect(cc2Row?.totalFunded).toBe(25);
      expect(cc2Row?.fundingBreakdown?.length).toBe(1);
      expect(cc2Row?.fundingBreakdown?.[0]?.categoryId).toBe(groceries);
    });

    it('breaks funding down by source category proportionally per card under partial funding', async () => {
      // Asymmetric multi-card partial-funding case — the breakdown feeding the
      // Available info tooltip must show each card its own proportional share
      // of the funded amount, not the raw category spend.
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Asymmetric Partial Funding Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const cc1 = await accounts.createAccount('CC 1', budgetId, 'credit', 'USD', 0);
      const cc2 = await accounts.createAccount('CC 2', budgetId, 'credit', 'USD', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceries = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      // Budget $30; CC1 spends $30, CC2 spends $20 → total $50 spend.
      // Funded portion capped at $30 (budget).
      // Proportional split: CC1 = 30 * 30/50 = $18, CC2 = 30 * 20/50 = $12.
      monthlyBudgets.upsertMonthlyAssignment(groceries, 30, '2024-01', budgetId);

      const cc1PaymentCat = categories.getCategoryByName('CC 1', budgetId);
      const cc2PaymentCat = categories.getCategoryByName('CC 2', budgetId);

      await transactions.addTransaction(
        0,
        30,
        cc1.ID,
        groceries,
        budgetId,
        '2024-01-10',
        'Store A'
      );
      await transactions.addTransaction(
        0,
        20,
        cc2.ID,
        groceries,
        budgetId,
        '2024-01-11',
        'Store B'
      );

      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const cc1Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cc1PaymentCat?.ID);
      const cc2Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cc2PaymentCat?.ID);

      // Totals reflect proportional split
      expect(cc1Row?.totalFunded).toBeCloseTo(18, 5);
      expect(cc2Row?.totalFunded).toBeCloseTo(12, 5);
      expect(cc1Row?.Available).toBe(18);
      expect(cc2Row?.Available).toBe(12);

      // Per-source breakdown is what the tooltip's "Funded from spending"
      // section iterates. Each entry must carry the same proportional share.
      const cc1GroceriesEntry = cc1Row?.fundingBreakdown?.find(
        (f: { categoryId: number }) => f.categoryId === groceries
      );
      const cc2GroceriesEntry = cc2Row?.fundingBreakdown?.find(
        (f: { categoryId: number }) => f.categoryId === groceries
      );
      expect(cc1GroceriesEntry?.amount).toBeCloseTo(18, 5);
      expect(cc2GroceriesEntry?.amount).toBeCloseTo(12, 5);
      // Tooltip should NOT show the raw $30/$20 spend per card.
      expect(cc1GroceriesEntry?.amount).not.toBe(30);
      expect(cc2GroceriesEntry?.amount).not.toBe(20);
    });

    it('splits funding proportionally when multiple cards share a category', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets } = services;

      const budgetId = await budgets.createBudget({
        name: 'Shared Category CC Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      const cc1 = await accounts.createAccount('CC 1', budgetId, 'credit', 'USD', 0);
      const cc2 = await accounts.createAccount('CC 2', budgetId, 'credit', 'USD', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceries = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      // Budget $30 on Groceries; both cards each spend $30 → total $60 spending,
      // funded portion capped at $30 → split proportionally: $15 each.
      monthlyBudgets.upsertMonthlyAssignment(groceries, 30, '2024-01', budgetId);

      const cc1PaymentCat = categories.getCategoryByName('CC 1', budgetId);
      const cc2PaymentCat = categories.getCategoryByName('CC 2', budgetId);

      await transactions.addTransaction(
        0,
        30,
        cc1.ID,
        groceries,
        budgetId,
        '2024-01-10',
        'Store A'
      );
      await transactions.addTransaction(
        0,
        30,
        cc2.ID,
        groceries,
        budgetId,
        '2024-01-11',
        'Store B'
      );

      const mb = monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
      const cc1Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cc1PaymentCat?.ID);
      const cc2Row = mb.find((row: { CategoryID: number }) => row.CategoryID === cc2PaymentCat?.ID);

      expect(cc1Row?.Available).toBe(15);
      expect(cc2Row?.Available).toBe(15);
      // Sum of both cards' funded equals the category budget cap
      expect((cc1Row?.totalFunded || 0) + (cc2Row?.totalFunded || 0)).toBeCloseTo(30, 5);
    });

    it('handles multi-currency CC payment without causing false overspend', async () => {
      const adapter = await NodeSqlJsAdapter.create();
      const sm = new ServiceManager();
      await sm.initialize(adapter as DatabaseAdapter);
      const services = sm.getServices();
      const { budgets, categories, accounts, transactions, monthlyBudgets, currency } = services;

      // Budget in USD
      const budgetId = await budgets.createBudget({
        name: 'Multi-Currency CC Test',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: true,
      });

      // EUR→USD rate: 1 EUR = 1.10 USD
      const month = '2024-01';
      await currency.saveRate('EUR', 'USD', 1.1, month, budgetId);

      // Accounts: EUR checking, USD CC, EUR CC
      const eurChecking = await accounts.createAccount(
        'EUR Checking',
        budgetId,
        'checking',
        'EUR',
        1000000 // EUR 1,000 in milliunits
      );
      const cc1 = await accounts.createAccount('CC 1 USD', budgetId, 'credit', 'USD', 0);
      const cc2 = await accounts.createAccount('CC 2 EUR', budgetId, 'credit', 'EUR', 0);

      const spendingGroup = categories.addCategoryGroup('Spending', budgetId);
      const groceries = categories.addCategory(spendingGroup, budgetId, 'Groceries');

      // CC Payment categories (auto-created)
      const cc1PaymentCat = categories.getCategoryByName('CC 1 USD', budgetId);
      const cc2PaymentCat = categories.getCategoryByName('CC 2 EUR', budgetId);
      const transfersCategory = categories.getCategoryByName('Transfers', budgetId);

      // Budget groceries to cover both CC spends (amounts in milliunits)
      // CC1 spend: $1 (1000)  → need $1 in Groceries
      // CC2 spend: €1 (1000)  → converts to $1.10 (1100) in budget currency
      monthlyBudgets.upsertMonthlyAssignment(groceries, 2100, month, budgetId);

      // 1. Spend $1 on CC1 (USD), categorized to Groceries
      await transactions.addTransaction(
        0,
        1000,
        cc1.ID,
        groceries,
        budgetId,
        '2024-01-05',
        'Store A'
      );

      // 2. Spend €1 on CC2 (EUR), categorized to Groceries
      await transactions.addTransaction(
        0,
        1000,
        cc2.ID,
        groceries,
        budgetId,
        '2024-01-06',
        'Store B'
      );

      // Before payment: check CC Payment categories
      let mb = monthlyBudgets.getMonthlyBudget(month, budgetId);
      let cc1PaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === cc1PaymentCat?.ID
      );
      let cc2PaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === cc2PaymentCat?.ID
      );

      // CC1 Payment: funded $1 from budgeted spending, no payments yet
      expect(cc1PaymentRow?.totalFunded).toBe(1000);
      expect(cc1PaymentRow?.Available).toBe(1000);

      // CC2 Payment: funded €1 ($1.10 converted) from budgeted spending, no payments yet
      expect(cc2PaymentRow?.totalFunded).toBe(1100);
      expect(cc2PaymentRow?.Available).toBe(1100);

      // 3. Pay CC1 from EUR checking account using CORRECT converted amounts
      // The CC needs $1 (budget currency). At 1 EUR = 1.10 USD, the source
      // must send €0.909 for the CC to receive exactly $1.
      const transferId = `cc_pay_mcc_${Date.now()}`;
      // Source: EUR checking, outflow €(1/1.1) ≈ 0.909 → 909 milliunits
      await transactions.addTransaction(
        0,
        Math.round(1000 / 1.1),
        eurChecking.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-20',
        'Pay CC1 from EUR',
        transferId
      );
      // Dest: CC1, inflow $1.00 (exactly what's needed, no more)
      await transactions.addTransaction(
        1000,
        0,
        cc1.ID,
        transfersCategory?.ID ?? 0,
        budgetId,
        '2024-01-20',
        'Receive from EUR',
        transferId
      );

      // After payment: CC1 Payment should show NO overspend
      // Funded $1.00, paid $1.00 → Available = 0
      mb = monthlyBudgets.getMonthlyBudget(month, budgetId);
      cc1PaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === cc1PaymentCat?.ID
      );

      expect(cc1PaymentRow?.Activity).toBe(-1000);
      expect(cc1PaymentRow?.Available).toBe(0);

      // CC2 Payment is unaffected
      cc2PaymentRow = mb.find(
        (row: { CategoryID: number }) => row.CategoryID === cc2PaymentCat?.ID
      );
      expect(cc2PaymentRow?.Available).toBe(1100);
    });
  });
});
