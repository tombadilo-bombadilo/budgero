import { describe, it, expect, beforeAll } from 'vitest';
import { Account } from '../src/services/accounts/types';
import { GoalType, GoalPurpose, NodeSqlJsAdapter, ServiceManager } from '../src';

describe('Goals', async () => {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter);
  const services = sm.getServices();
  let categoryID: number;
  let budgetId: number;
  let account: Account;

  beforeAll(async () => {
    budgetId = await services.budgets.createBudget({
      name: 'Test Budget',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '$1,097',
      create_default_categories: false,
    });
    const categoryGroupID = sm
      .getServices()
      .categories.addCategoryGroup('Test Category Group', budgetId);
    categoryID = sm
      .getServices()
      .categories.addCategory(categoryGroupID, budgetId, 'Test Category');
    account = await sm
      .getServices()
      .accounts.createAccount('Test Account', budgetId, 'Checking', 'USD', 1000);
  });

  it('should create a goal', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryID, 1000, '2025-07-01', '2025-12-31');
    expect(goalID).toBeDefined();

    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    expect(goal.Target).toBe(1000);
    expect(goal.StartDate).toBe('2025-07-01');
    expect(goal.TargetDate).toBe('2025-12-31');

    // cleanup
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should create a goal with no target date', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryID, 1000, '2025-07-01', '');
    expect(goalID).toBeDefined();

    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    expect(goal.Target).toBe(1000);
    expect(goal.StartDate).toBe('2025-07-01');
    expect(goal.TargetDate).toBe('');

    // delete goal so next test can run properly
    sm.getServices().goals.deleteGoal(goalID);
  });
  it('should create yearly goal', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.YEARLY, categoryID, 1000, '2025-07-01', '2025-12-31');
    expect(goalID).toBeDefined();

    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    expect(goal.Target).toBe(1000);
    expect(goal.StartDate).toBe('2025-07-01');
    expect(goal.TargetDate).toBe('2025-12-31');

    // delete goal so next test can run properly
    sm.getServices().goals.deleteGoal(goalID);
  });
  it('should update goal target', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryID, 1000, '2025-07-01', '2025-12-31');
    expect(goalID).toBeDefined();
    sm.getServices().goals.updateGoal(categoryID, 2000, GoalType.MONTHLY, '2025-12-31');
    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    expect(goal.Target).toBe(2000);

    // delete goal so next test can run properly
    sm.getServices().goals.deleteGoal(goalID);
  });
  it('should delete goal', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryID, 1000, '2025-07-01', '2025-12-31');
    expect(goalID).toBeDefined();
    sm.getServices().goals.deleteGoal(goalID);
    // expect error
    expect(() => sm.getServices().goals.getGoalByCategoryID(categoryID)).toThrow(
      `Goal for category ${categoryID} not found`
    );
  });

  it('should handle monthly goal calculation', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryID, 1000, '2025-07-01', '2025-12-31');
    expect(goalID).toBeDefined();
    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    // pass goal, current month, and finances
    const budgetData = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetData = budgetData.find((cb) => cb.CategoryID === categoryID);
    const finances = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetData);
    const goalProgress = sm.getServices().goals.calculateGoalProgress(goal, finances, '2025-01');

    expect(goalProgress.percentage).toBe(0);
    expect(goalProgress.amountSaved).toBe(0);
    expect(goalProgress.amountNeeded).toBe(1000);
    expect(goalProgress.monthlyTarget).toBe(1000);
    expect(goalProgress.isFunded).toBe(false);
    expect(goalProgress.isOnTrack).toBe(false);
    expect(goalProgress.status).toBe('at-risk');

    // assign 500 to the category
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 500, '2025-01', budgetId);
    const budgetDataAfterUpdate = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetDataAfterUpdate = budgetDataAfterUpdate.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesAfterUpdate = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetDataAfterUpdate);
    const goalProgressAfterUpdate = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesAfterUpdate, '2025-01');
    expect(goalProgressAfterUpdate.percentage).toBe(50);
    expect(goalProgressAfterUpdate.amountSaved).toBe(500);
    expect(goalProgressAfterUpdate.amountNeeded).toBe(500);
    expect(goalProgressAfterUpdate.monthlyTarget).toBe(1000);

    // spend 250 from the category — Monthly Available Target tracks "start-of-month" progress
    // so this month's spending does NOT regenerate need. 500 assigned → progress stays at 50%.
    const transactionID1 = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        250,
        account.ID,
        categoryID,
        budgetId,
        '2025-01-02',
        'Test Transaction'
      );
    const budgetDataAfterSpend = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetDataAfterSpend = budgetDataAfterSpend.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesAfterSpend = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetDataAfterSpend);
    const goalProgressAfterSpend = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesAfterSpend, '2025-01');
    expect(goalProgressAfterSpend.percentage).toBe(50); // 500 effective / 1000 = 50%
    expect(goalProgressAfterSpend.amountSaved).toBe(500); // effective available (spending added back)
    expect(goalProgressAfterSpend.amountNeeded).toBe(500); // still need 500 more to reach target
    expect(goalProgressAfterSpend.monthlyTarget).toBe(1000);

    // reset all asignments
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-01', budgetId);

    // asign 500 to the category in previous month
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 500, '2024-12', budgetId);
    const budgetDataAfterPreviousMonth = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2024-12', budgetId);
    const categoryBudgetDataAfterPreviousMonth = budgetDataAfterPreviousMonth.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesAfterPreviousMonth = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2024-12', categoryBudgetDataAfterPreviousMonth);
    const goalProgressAfterPreviousMonth = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesAfterPreviousMonth, '2024-12');
    expect(goalProgressAfterPreviousMonth.percentage).toBe(50);
    expect(goalProgressAfterPreviousMonth.amountSaved).toBe(500);
    expect(goalProgressAfterPreviousMonth.amountNeeded).toBe(500);
    expect(goalProgressAfterPreviousMonth.monthlyTarget).toBe(1000);

    // now let's overspend asignment by 250 in the previous month
    const transactionID2 = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        750,
        account.ID,
        categoryID,
        budgetId,
        '2024-12-15',
        'Test Transaction'
      );
    const budgetDataAfterOverspend = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetDataAfterOverspend = budgetDataAfterOverspend.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesAfterOverspend = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetDataAfterOverspend);
    const goalProgressAfterOverspend = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesAfterOverspend, '2025-01');
    // Monthly Available Target: available is clamped to 0, need full target + deficit
    expect(goalProgressAfterOverspend.percentage).toBe(0);
    expect(goalProgressAfterOverspend.amountSaved).toBe(0); // max(0, available) since available is negative
    expect(goalProgressAfterOverspend.amountNeeded).toBe(1000); // max(0, 1000 - 0) = 1000
    expect(goalProgressAfterOverspend.monthlyTarget).toBe(1000);

    // cleanup - delete transactions, reset assignments, and delete goal
    sm.getServices().transactions.deleteTransaction(transactionID1);
    sm.getServices().transactions.deleteTransaction(transactionID2);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2024-12', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-01', budgetId);
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should handle TARGET_DATE (Yearly Allocation Target) — tracks assignments, not balance', async () => {
    const goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.TARGET_DATE,
        categoryID,
        5000,
        '2025-01-01',
        '2025-06-30',
        GoalPurpose.SAVINGS
      );

    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    expect(goal.Type).toBe(GoalType.TARGET_DATE);
    expect(goal.Purpose).toBe(GoalPurpose.SAVINGS);

    // Calculate with no funds
    const budgetData = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetData = budgetData.find((cb) => cb.CategoryID === categoryID);
    const finances = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetData);
    const goalProgress = sm.getServices().goals.calculateGoalProgress(goal, finances, '2025-01');

    expect(goalProgress.percentage).toBe(0);
    expect(goalProgress.amountSaved).toBe(0); // total assigned in cycle
    expect(goalProgress.amountNeeded).toBe(5000);
    expect(goalProgress.isFunded).toBe(false);

    // Assign partial funds in January
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 1000, '2025-01', budgetId);
    const budgetDataPartial = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetPartial = budgetDataPartial.find((cb) => cb.CategoryID === categoryID);
    const financesPartial = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetPartial);
    const goalProgressPartial = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesPartial, '2025-01');
    // Yearly Allocation tracks assignments: 1000/5000 = 20%
    expect(goalProgressPartial.amountSaved).toBe(1000);
    expect(goalProgressPartial.amountNeeded).toBe(4000);

    // Spending does NOT affect Yearly Allocation progress — only assignments matter
    const transactionID1 = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        300,
        account.ID,
        categoryID,
        budgetId,
        '2025-01-15',
        'Emergency expense'
      );
    const budgetDataAfterSpending = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetAfterSpending = budgetDataAfterSpending.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesAfterSpending = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetAfterSpending);
    const goalProgressAfterSpending = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesAfterSpending, '2025-01');

    // Still 1000 assigned — spending doesn't change allocation progress
    expect(goalProgressAfterSpending.amountSaved).toBe(1000);
    expect(goalProgressAfterSpending.amountNeeded).toBe(4000);

    // Move to February — assignments accumulate across months
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 800, '2025-02', budgetId);
    const budgetDataFeb = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-02', budgetId);
    const categoryBudgetFeb = budgetDataFeb.find((cb) => cb.CategoryID === categoryID);
    const financesFeb = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-02', categoryBudgetFeb);
    const goalProgressFeb = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesFeb, '2025-02');

    // Jan (1000) is in historicalAssignments + Feb (800) current = 1800 total
    expect(goalProgressFeb.amountSaved).toBe(1800);
    expect(goalProgressFeb.amountNeeded).toBe(3200);

    // Spending in February still doesn't affect allocation tracking
    const transactionID2 = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        200,
        account.ID,
        categoryID,
        budgetId,
        '2025-02-10',
        'Another expense'
      );
    const budgetDataFebAfterSpending = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-02', budgetId);
    const categoryBudgetFebAfterSpending = budgetDataFebAfterSpending.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesFebAfterSpending = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-02', categoryBudgetFebAfterSpending);
    const goalProgressFebAfterSpending = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesFebAfterSpending, '2025-02');

    // Still 1800 total allocated — spending is irrelevant
    expect(goalProgressFebAfterSpending.amountSaved).toBe(1800);
    expect(goalProgressFebAfterSpending.amountNeeded).toBe(3200);

    // Monthly target uses start-of-month state: (5000 - 1000) / 5 remaining months = 800
    // (1000 = Jan assignment only, Feb's 800 is excluded from the base)
    expect(goalProgressFebAfterSpending.monthlyTarget).toBe(800);

    // cleanup
    sm.getServices().transactions.deleteTransaction(transactionID1);
    sm.getServices().transactions.deleteTransaction(transactionID2);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-01', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-02', budgetId);
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should handle MONTHLY_SAVINGS goal calculation with carryovers and transactions', async () => {
    // Monthly savings goal with $500/month target
    const monthlyTarget = 500;
    const goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.MONTHLY_SAVINGS,
        categoryID,
        monthlyTarget,
        '2025-01-01',
        '',
        GoalPurpose.SAVINGS
      );

    const goal = sm.getServices().goals.getGoalByCategoryID(categoryID);
    expect(goal.Type).toBe(GoalType.MONTHLY_SAVINGS);
    expect(goal.TargetDate).toBe('');

    // Calculate initial progress with no funds
    const budgetData = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetData = budgetData.find((cb) => cb.CategoryID === categoryID);
    const finances = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetData);
    const goalProgress = sm.getServices().goals.calculateGoalProgress(goal, finances, '2025-01');

    expect(goalProgress.percentage).toBe(0);
    expect(goalProgress.amountSaved).toBe(0);
    expect(goalProgress.amountNeeded).toBe(monthlyTarget); // Need to assign $500 this month
    expect(goalProgress.isFunded).toBe(false);

    // January: Assign exactly the target amount
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryID,
      monthlyTarget,
      '2025-01',
      budgetId
    );
    const budgetDataJan = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetJan = budgetDataJan.find((cb) => cb.CategoryID === categoryID);
    const financesJan = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetJan);
    const goalProgressJan = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesJan, '2025-01');

    expect(goalProgressJan.percentage).toBe(100); // Met 100% of monthly target
    expect(goalProgressJan.amountSaved).toBe(monthlyTarget);
    expect(goalProgressJan.amountNeeded).toBe(0); // Fully met this month's target
    expect(goalProgressJan.isFunded).toBe(true); // Monthly target is met
    expect(goalProgressJan.status).toBe('completed'); // This month's goal is completed

    // January: Add a small withdrawal (spending from savings)
    const transactionID1 = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        100,
        account.ID,
        categoryID,
        budgetId,
        '2025-01-20',
        'Small withdrawal'
      );
    const budgetDataJanAfterSpending = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetJanAfterSpending = budgetDataJanAfterSpending.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesJanAfterSpending = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-01', categoryBudgetJanAfterSpending);
    const goalProgressJanAfterSpending = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesJanAfterSpending, '2025-01');

    // After spending $100, still have $400 saved (still meeting goal as we assigned the target)
    expect(goalProgressJanAfterSpending.amountSaved).toBe(400);
    // For MONTHLY_SAVINGS, we still met the assignment target even if we spent some
    expect(goalProgressJanAfterSpending.isFunded).toBe(true);

    // February: Test assigning more than target (overachieving)
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 700, '2025-02', budgetId);
    const budgetDataFeb = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-02', budgetId);
    const categoryBudgetFeb = budgetDataFeb.find((cb) => cb.CategoryID === categoryID);
    const financesFeb = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-02', categoryBudgetFeb);
    const goalProgressFeb = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesFeb, '2025-02');
    // Should have $400 from Jan + $700 from Feb = $1100 total saved
    expect(goalProgressFeb.amountSaved).toBe(1100);
    expect(goalProgressFeb.percentage).toBe(100); // Exceeded monthly target (700/500 > 100%)
    expect(goalProgressFeb.isFunded).toBe(true); // Met the monthly target
    expect(goalProgressFeb.status).toBe('overfunded'); // Exceeded the monthly target

    // February: Test overspending scenario
    const transactionID2 = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        1500,
        account.ID,
        categoryID,
        budgetId,
        '2025-02-15',
        'Large unexpected expense'
      );
    const budgetDataFebOverspent = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-02', budgetId);
    const categoryBudgetFebOverspent = budgetDataFebOverspent.find(
      (cb) => cb.CategoryID === categoryID
    );
    const financesFebOverspent = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-02', categoryBudgetFebOverspent);
    const goalProgressFebOverspent = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesFebOverspent, '2025-02');

    // After spending $1500 from $1100, should be negative (-$400)
    expect(goalProgressFebOverspent.amountSaved).toBe(-400);
    expect(goalProgressFebOverspent.percentage).toBe(100); // Can't have negative percentage
    expect(goalProgressFebOverspent.amountNeeded).toBe(900); // Need $400 to cover overspend + $500 monthly target
    expect(goalProgressFebOverspent.isFunded).toBe(false);
    expect(goalProgressFebOverspent.status).toBe('overspent');

    // March: Test recovery from overspending - need to cover deficit AND meet monthly target
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 900, '2025-03', budgetId);
    const budgetDataMar = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-03', budgetId);
    const categoryBudgetMar = budgetDataMar.find((cb) => cb.CategoryID === categoryID);
    const financesMar = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-03', categoryBudgetMar);
    const goalProgressMar = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesMar, '2025-03');

    // Should have -$400 + $900 = $500 (exactly meeting the monthly target after covering deficit)
    expect(goalProgressMar.amountSaved).toBe(500);
    expect(goalProgressMar.percentage).toBe(100); // Met the monthly target
    expect(goalProgressMar.amountNeeded).toBe(0); // Fully recovered and met monthly target
    expect(goalProgressMar.isFunded).toBe(true);
    expect(goalProgressMar.status).toBe('overfunded');

    // April: Test under-assigning (not meeting monthly target)
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 300, '2025-04', budgetId);
    const budgetDataApr = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-04', budgetId);
    const categoryBudgetApr = budgetDataApr.find((cb) => cb.CategoryID === categoryID);
    const financesApr = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-04', categoryBudgetApr);
    const goalProgressApr = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesApr, '2025-04');

    // Should have $500 + $300 = $800 total, but only assigned $300 this month (60% of target)
    expect(goalProgressApr.amountSaved).toBe(800);
    expect(goalProgressApr.percentage).toBe(60); // Only met 60% of monthly target (300/500)
    expect(goalProgressApr.amountNeeded).toBe(200); // Still need $200 to meet monthly target
    expect(goalProgressApr.isFunded).toBe(false);
    expect(goalProgressApr.status).toBe('behind'); // Behind on monthly target

    // May: Test consistency - meeting target every month is success
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryID,
      monthlyTarget,
      '2025-05',
      budgetId
    );
    const budgetDataMay = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-05', budgetId);
    const categoryBudgetMay = budgetDataMay.find((cb) => cb.CategoryID === categoryID);
    const financesMay = sm
      .getServices()
      .goals.getCategoryFinancials(categoryID, '2025-05', categoryBudgetMay);
    const goalProgressMay = sm
      .getServices()
      .goals.calculateGoalProgress(goal, financesMay, '2025-05');

    // Should have $800 + $500 = $1300 total
    expect(goalProgressMay.amountSaved).toBe(1300);
    expect(goalProgressMay.percentage).toBe(100); // Met this month's target
    expect(goalProgressMay.amountNeeded).toBe(0);
    expect(goalProgressMay.isFunded).toBe(true);
    expect(goalProgressMay.status).toBe('completed'); // This month's target is met

    // Monthly savings goals are on track if meeting the monthly target
    expect(goalProgressJan.isOnTrack).toBe(true);
    expect(goalProgressApr.isOnTrack).toBe(false); // Not on track when under-assigned

    // cleanup
    sm.getServices().transactions.deleteTransaction(transactionID1);
    sm.getServices().transactions.deleteTransaction(transactionID2);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-01', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-02', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-03', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-04', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryID, 0, '2025-05', budgetId);
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should test different goal statuses', async () => {
    // Create a new category for this test to avoid conflicts
    const categoryGroupIDStatus = sm
      .getServices()
      .categories.addCategoryGroup('Status Test Group', budgetId);
    const categoryIDStatus = sm
      .getServices()
      .categories.addCategory(categoryGroupIDStatus, budgetId, 'Status Test Category');

    // Test overfunded status - needs >120% to be overfunded
    const goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryIDStatus, 100, '2025-01-01', '');
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDStatus,
      130,
      '2025-01',
      budgetId
    );

    const budgetData = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetData = budgetData.find((cb) => cb.CategoryID === categoryIDStatus);
    const finances = sm
      .getServices()
      .goals.getCategoryFinancials(categoryIDStatus, '2025-01', categoryBudgetData);
    const goalProgress = sm
      .getServices()
      .goals.calculateGoalProgress(
        sm.getServices().goals.getGoalByCategoryID(categoryIDStatus),
        finances,
        '2025-01'
      );

    expect(goalProgress.status).toBe('overfunded');
    expect(goalProgress.percentage).toBe(100); // Percentage is capped at 100 for spending goals

    // Test completed status
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDStatus,
      100,
      '2025-01',
      budgetId
    );
    const budgetDataCompleted = sm
      .getServices()
      .monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetCompleted = budgetDataCompleted.find(
      (cb) => cb.CategoryID === categoryIDStatus
    );
    const financesCompleted = sm
      .getServices()
      .goals.getCategoryFinancials(categoryIDStatus, '2025-01', categoryBudgetCompleted);
    const goalProgressCompleted = sm
      .getServices()
      .goals.calculateGoalProgress(
        sm.getServices().goals.getGoalByCategoryID(categoryIDStatus),
        financesCompleted,
        '2025-01'
      );

    expect(goalProgressCompleted.status).toBe('completed');

    // Test on-track status (80% or more)
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDStatus,
      85,
      '2025-01',
      budgetId
    );
    const budgetDataOnTrack = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetOnTrack = budgetDataOnTrack.find(
      (cb) => cb.CategoryID === categoryIDStatus
    );
    const financesOnTrack = sm
      .getServices()
      .goals.getCategoryFinancials(categoryIDStatus, '2025-01', categoryBudgetOnTrack);
    const goalProgressOnTrack = sm
      .getServices()
      .goals.calculateGoalProgress(
        sm.getServices().goals.getGoalByCategoryID(categoryIDStatus),
        financesOnTrack,
        '2025-01'
      );

    expect(goalProgressOnTrack.status).toBe('on-track');

    // Test behind status (50-79%)
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDStatus,
      60,
      '2025-01',
      budgetId
    );
    const budgetDataBehind = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetBehind = budgetDataBehind.find((cb) => cb.CategoryID === categoryIDStatus);
    const financesBehind = sm
      .getServices()
      .goals.getCategoryFinancials(categoryIDStatus, '2025-01', categoryBudgetBehind);
    const goalProgressBehind = sm
      .getServices()
      .goals.calculateGoalProgress(
        sm.getServices().goals.getGoalByCategoryID(categoryIDStatus),
        financesBehind,
        '2025-01'
      );

    expect(goalProgressBehind.status).toBe('behind');

    // cleanup
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDStatus,
      0,
      '2025-01',
      budgetId
    );
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should handle getAllGoals method', async () => {
    // Create unique categories for this test
    const categoryGroupIDGetAll1 = sm
      .getServices()
      .categories.addCategoryGroup('GetAll Test Group 1', budgetId);
    const categoryIDGetAll1 = sm
      .getServices()
      .categories.addCategory(categoryGroupIDGetAll1, budgetId, 'GetAll Test Category 1');
    const categoryGroupIDGetAll2 = sm
      .getServices()
      .categories.addCategoryGroup('GetAll Test Group 2', budgetId);
    const categoryIDGetAll2 = sm
      .getServices()
      .categories.addCategory(categoryGroupIDGetAll2, budgetId, 'GetAll Test Category 2');

    // Create multiple goals
    const goalID1 = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryIDGetAll1, 500, '2025-01-01', '2025-12-31');
    const goalID2 = sm
      .getServices()
      .goals.createGoal(GoalType.YEARLY, categoryIDGetAll2, 1200, '2025-01-01', '2025-12-31');

    const allGoals = sm.getServices().goals.getAllGoals();
    expect(allGoals.length).toBeGreaterThanOrEqual(2); // May have goals from other tests
    expect(allGoals.find((g) => g.ID === goalID1)).toBeDefined();
    expect(allGoals.find((g) => g.ID === goalID2)).toBeDefined();

    // cleanup
    sm.getServices().goals.deleteGoal(goalID1);
    sm.getServices().goals.deleteGoal(goalID2);
  });

  it('should handle error when getting non-existent goal', async () => {
    expect(() => sm.getServices().goals.getGoalByCategoryID(99999)).toThrow(
      'Goal for category 99999 not found'
    );
  });

  it('should get goals by multiple category IDs', async () => {
    // Create unique categories for this test
    const categoryGroupIDMultiGet1 = sm
      .getServices()
      .categories.addCategoryGroup('MultiGet Test Group 1', budgetId);
    const categoryIDMultiGet1 = sm
      .getServices()
      .categories.addCategory(categoryGroupIDMultiGet1, budgetId, 'MultiGet Test Category 1');
    const categoryGroupIDMultiGet2 = sm
      .getServices()
      .categories.addCategoryGroup('MultiGet Test Group 2', budgetId);
    const categoryIDMultiGet2 = sm
      .getServices()
      .categories.addCategory(categoryGroupIDMultiGet2, budgetId, 'MultiGet Test Category 2');
    const categoryGroupIDMultiGet3 = sm
      .getServices()
      .categories.addCategoryGroup('MultiGet Test Group 3', budgetId);
    const categoryIDMultiGet3 = sm
      .getServices()
      .categories.addCategory(categoryGroupIDMultiGet3, budgetId, 'MultiGet Test Category 3');

    const goalID1 = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, categoryIDMultiGet1, 500, '2025-01-01', '2025-12-31');
    const goalID2 = sm
      .getServices()
      .goals.createGoal(GoalType.YEARLY, categoryIDMultiGet2, 1200, '2025-01-01', '2025-12-31');
    const goalID3 = sm
      .getServices()
      .goals.createGoal(
        GoalType.TARGET_DATE,
        categoryIDMultiGet3,
        3000,
        '2025-01-01',
        '2025-06-30',
        GoalPurpose.SAVINGS
      );

    const goals = sm
      .getServices()
      .goals.getGoalsByCategoryIDs([categoryIDMultiGet1, categoryIDMultiGet2, categoryIDMultiGet3]);
    expect(goals).toHaveLength(3);
    expect(goals.map((g) => g.CategoryID).sort()).toEqual(
      [categoryIDMultiGet1, categoryIDMultiGet2, categoryIDMultiGet3].sort()
    );

    // cleanup
    sm.getServices().goals.deleteGoal(goalID1);
    sm.getServices().goals.deleteGoal(goalID2);
    sm.getServices().goals.deleteGoal(goalID3);
  });

  it('should handle historical assignments and activity', async () => {
    // Create a new category for this test
    const categoryGroupIDHist = sm
      .getServices()
      .categories.addCategoryGroup('Historical Test Group', budgetId);
    const categoryIDHist = sm
      .getServices()
      .categories.addCategory(categoryGroupIDHist, budgetId, 'Historical Test Category');

    const goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.MONTHLY_SAVINGS,
        categoryIDHist,
        5000,
        '2024-01-01',
        '',
        GoalPurpose.SAVINGS
      );

    // Add historical assignments
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDHist,
      500,
      '2024-11',
      budgetId
    );
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDHist,
      600,
      '2024-12',
      budgetId
    );

    // Get historical data
    const historicalAssignments = sm
      .getServices()
      .goals.getHistoricalAssignments(categoryIDHist, '2025-01', 3);
    expect(historicalAssignments).toHaveLength(2);
    expect(historicalAssignments[0].amount).toBe(500);
    expect(historicalAssignments[0].month).toBe('2024-11');

    // Add some spending
    const transactionID = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        200,
        account.ID,
        categoryIDHist,
        budgetId,
        '2024-12-15',
        'Historical spending'
      );

    const historicalActivity = sm
      .getServices()
      .goals.getHistoricalActivity(categoryIDHist, '2025-01', 3);
    expect(historicalActivity).toBeDefined();
    expect(historicalActivity.find((a) => a.month === '2024-12')).toBeDefined();

    // cleanup - delete transaction, reset assignments, and delete goal
    sm.getServices().transactions.deleteTransaction(transactionID);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryIDHist, 0, '2024-11', budgetId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(categoryIDHist, 0, '2024-12', budgetId);
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should handle future planned assignments', async () => {
    // Create a new category for this test
    const categoryGroupIDFuture = sm
      .getServices()
      .categories.addCategoryGroup('Future Test Group', budgetId);
    const categoryIDFuture = sm
      .getServices()
      .categories.addCategory(categoryGroupIDFuture, budgetId, 'Future Test Category');

    const goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.TARGET_DATE,
        categoryIDFuture,
        6000,
        '2025-01-01',
        '2025-06-30',
        GoalPurpose.SAVINGS
      );

    // Add future assignments
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDFuture,
      1000,
      '2025-02',
      budgetId
    );
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDFuture,
      1000,
      '2025-03',
      budgetId
    );
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDFuture,
      1000,
      '2025-04',
      budgetId
    );

    const futureAssignments = sm
      .getServices()
      .goals.getFutureAssignments(categoryIDFuture, '2025-01', '2025-06');
    expect(futureAssignments).toHaveLength(3);
    expect(futureAssignments.every((a) => a.amount === 1000)).toBe(true);

    // Calculate progress with future assignments
    const budgetData = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetData = budgetData.find((cb) => cb.CategoryID === categoryIDFuture);
    const finances = sm
      .getServices()
      .goals.getCategoryFinancials(categoryIDFuture, '2025-01', categoryBudgetData);

    expect(finances.plannedAssignments).toHaveLength(3);

    // cleanup - reset all future assignments and delete goal
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDFuture,
      0,
      '2025-02',
      budgetId
    );
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDFuture,
      0,
      '2025-03',
      budgetId
    );
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(
      categoryIDFuture,
      0,
      '2025-04',
      budgetId
    );
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should calculate progress by category ID with no goal', async () => {
    // Create a fresh category without any previous activity
    const categoryGroupIDFresh = sm
      .getServices()
      .categories.addCategoryGroup('Fresh Category Group', budgetId);
    const categoryIDFresh = sm
      .getServices()
      .categories.addCategory(categoryGroupIDFresh, budgetId, 'Fresh Category');

    const budgetData = sm.getServices().monthlyBudgets.getMonthlyBudget('2025-01', budgetId);
    const categoryBudgetData = budgetData.find((cb) => cb.CategoryID === categoryIDFresh);
    const finances = sm
      .getServices()
      .goals.getCategoryFinancials(categoryIDFresh, '2025-01', categoryBudgetData);

    const progress = sm
      .getServices()
      .goals.calculateGoalProgressByCategoryId(categoryIDFresh, finances, '2025-01');

    expect(progress.percentage).toBe(0);
    expect(progress.amountSaved).toBe(0);
    expect(progress.status).toBe('not-started');
  });

  it('should handle empty finances data', async () => {
    const emptyFinances = sm.getServices().goals.getCategoryFinancials(99999, '2025-01');

    expect(emptyFinances.available).toBe(0);
    expect(emptyFinances.assigned).toBe(0);
    expect(emptyFinances.activity).toBe(0);
    expect(emptyFinances.historicalAssignments).toHaveLength(0);
    expect(emptyFinances.historicalActivity).toHaveLength(0);
    expect(emptyFinances.plannedAssignments).toHaveLength(0);
  });

  it('should show Yearly Allocation Target as funded when prior month covers full target', async () => {
    // Scenario: car registration — 42k target by April 21st, user assigns 42k in March, spends 40.8k in March
    // When viewing April, the goal should show as fully allocated (42k assigned in cycle >= 42k target)
    const cgId = sm.getServices().categories.addCategoryGroup('Car Group', budgetId);
    const catId = sm.getServices().categories.addCategory(cgId, budgetId, 'Car Registration');

    const goalID = sm.getServices().goals.createGoal(
      GoalType.TARGET_DATE,
      catId,
      42000,
      '2026-03-01',
      '2026-04-20',
      GoalPurpose.SAVINGS,
      true // recurring
    );

    // March: assign 42k and spend 40.8k
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(catId, 42000, '2026-03', budgetId);
    const txId = await sm
      .getServices()
      .transactions.addTransaction(
        0,
        40800,
        account.ID,
        catId,
        budgetId,
        '2026-03-15',
        'Registration'
      );

    // --- View from MARCH ---
    const marchBudget = sm.getServices().monthlyBudgets.getMonthlyBudget('2026-03', budgetId);
    const marchRow = marchBudget.find((r) => r.CategoryID === catId);
    if (!marchRow) throw new Error('March row not found');
    const marchFinances = sm.getServices().goals.getCategoryFinancials(catId, '2026-03', marchRow);
    const goal = sm.getServices().goals.getGoalByCategoryID(catId);
    const marchProgress = sm
      .getServices()
      .goals.calculateGoalProgress(goal, marchFinances, '2026-03');

    // March: assigned 42k in current month, which is within cycle — should be fully allocated
    expect(marchProgress.amountSaved).toBe(42000);
    expect(marchProgress.isFunded).toBe(true);
    expect(marchProgress.status).toBe('completed');

    // --- View from APRIL (target month) ---
    // April has 0 assigned, 0 activity, available = 1200 (42000 - 40800 carry)
    const aprilBudget = sm.getServices().monthlyBudgets.getMonthlyBudget('2026-04', budgetId);
    const aprilRow = aprilBudget.find((r) => r.CategoryID === catId);
    if (!aprilRow) throw new Error('April row not found');
    expect(aprilRow.Assigned).toBe(0);
    expect(aprilRow.Available).toBe(1200); // 42000 assigned - 40800 spent = 1200 carry

    const aprilFinances = sm.getServices().goals.getCategoryFinancials(catId, '2026-04', aprilRow);

    // Verify historical assignments include March
    const historicalAssignments = aprilFinances.historicalAssignments ?? [];
    expect(historicalAssignments.length).toBeGreaterThanOrEqual(1);
    const marchAssignment = historicalAssignments.find((a) => a.month === '2026-03');
    expect(marchAssignment).toBeDefined();
    expect(marchAssignment?.amount).toBe(42000);

    const aprilProgress = sm
      .getServices()
      .goals.calculateGoalProgress(goal, aprilFinances, '2026-04');

    // April: March's 42k assignment is in historicalAssignments, cycle includes March
    // totalAssigned = 42000 (March) + 0 (April) = 42000 >= target 42000 → funded!
    expect(aprilProgress.amountSaved).toBe(42000);
    expect(aprilProgress.amountNeeded).toBe(0);
    expect(aprilProgress.isFunded).toBe(true);
    expect(aprilProgress.status).toBe('completed');

    // cleanup
    sm.getServices().transactions.deleteTransaction(txId);
    sm.getServices().monthlyBudgets.upsertMonthlyAssignment(catId, 0, '2026-03', budgetId);
    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should keep Yearly Available monthly pace flat when funded on pace', async () => {
    const cgId = sm.getServices().categories.addCategoryGroup('Pace Group', budgetId);
    const catId = sm.getServices().categories.addCategory(cgId, budgetId, 'Pace Category');

    // 12,000 available by Dec 2026, starting Jan 2026 → 1,000/month
    const goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.YEARLY,
        catId,
        12000,
        '2026-01-01',
        '2026-12-31',
        GoalPurpose.SPENDING
      );
    const goal = sm.getServices().goals.getGoalByCategoryID(catId);
    const calc = (
      finances: Parameters<typeof services.goals.calculateGoalProgress>[1],
      month: string
    ) => sm.getServices().goals.calculateGoalProgress(goal, finances, month);

    // January, nothing assigned yet: pace = 12,000 / 12
    let progress = calc({ available: 0, assigned: 0, activity: 0 }, '2026-01');
    expect(progress.monthlyTarget).toBe(1000);

    // February after assigning 1,000 in January: pace stays flat
    progress = calc({ available: 2000, assigned: 1000, activity: 0 }, '2026-02');
    expect(progress.monthlyTarget).toBe(1000);

    // Planned future assignments must NOT deflate the pace — otherwise the
    // pace ratchets up every month as planned months elapse
    progress = calc(
      {
        available: 2000,
        assigned: 1000,
        activity: 0,
        plannedAssignments: [{ month: '2026-03', amount: 5000 }],
      },
      '2026-02'
    );
    expect(progress.monthlyTarget).toBe(1000);

    // March after skipping February entirely: gap re-spreads over 10 months
    progress = calc({ available: 1000, assigned: 0, activity: 0 }, '2026-03');
    expect(progress.monthlyTarget).toBe(1100);

    // March after over-assigning 2,000 in February: pace drops
    progress = calc({ available: 3000, assigned: 0, activity: 0 }, '2026-03');
    expect(progress.monthlyTarget).toBe(900);

    // Spending mid-month doesn't move the current month's pace (anchored to
    // start-of-month state)…
    progress = calc({ available: 1500, assigned: 1000, activity: -500 }, '2026-02');
    expect(progress.monthlyTarget).toBe(1000);

    // …but next month the pace rises to claw the spent 500 back:
    // (12,000 − 1,500) / 10 remaining months
    progress = calc({ available: 1500, assigned: 0, activity: 0 }, '2026-03');
    expect(progress.monthlyTarget).toBe(1050);

    sm.getServices().goals.deleteGoal(goalID);
  });

  it('should report overfundedAmount per goal type', async () => {
    const cgId = sm.getServices().categories.addCategoryGroup('Overfund Group', budgetId);
    const catId = sm.getServices().categories.addCategory(cgId, budgetId, 'Overfund Category');

    // Monthly Available (spending): target 500, effective available 800 → over by 300
    let goalID = sm
      .getServices()
      .goals.createGoal(GoalType.MONTHLY, catId, 500, '2026-01-01', '', GoalPurpose.SPENDING);
    let goal = sm.getServices().goals.getGoalByCategoryID(catId);
    let progress = sm
      .getServices()
      .goals.calculateGoalProgress(goal, { available: 800, assigned: 800, activity: 0 }, '2026-01');
    expect(progress.overfundedAmount).toBe(300);
    sm.getServices().goals.deleteGoal(goalID);

    // Monthly Savings: monthly target 200, assigned 250 this month → over by 50
    goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.MONTHLY_SAVINGS,
        catId,
        200,
        '2026-01-01',
        '',
        GoalPurpose.SAVINGS
      );
    goal = sm.getServices().goals.getGoalByCategoryID(catId);
    progress = sm
      .getServices()
      .goals.calculateGoalProgress(goal, { available: 250, assigned: 250, activity: 0 }, '2026-01');
    expect(progress.status).toBe('overfunded');
    expect(progress.overfundedAmount).toBe(50);
    sm.getServices().goals.deleteGoal(goalID);

    // Yearly Allocation (target-date savings): cycle target fully allocated in
    // Jan (history), so this month's pace is 0 → the whole 50 assigned in Feb
    // is overfunding
    goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.TARGET_DATE,
        catId,
        1200,
        '2026-01-01',
        '2026-12-31',
        GoalPurpose.SAVINGS
      );
    goal = sm.getServices().goals.getGoalByCategoryID(catId);
    progress = sm.getServices().goals.calculateGoalProgress(
      goal,
      {
        available: 1250,
        assigned: 50,
        activity: 0,
        historicalAssignments: [{ month: '2026-01', amount: 1200 }],
      },
      '2026-02'
    );
    expect(progress.isFunded).toBe(true);
    expect(progress.overfundedAmount).toBe(50);
    sm.getServices().goals.deleteGoal(goalID);

    // Yearly Available (spending): target 600 by Dec, 540 at July's start →
    // pace = 60 / 6 months = 10; assigned 160 this month → over pace by 150
    goalID = sm
      .getServices()
      .goals.createGoal(
        GoalType.YEARLY,
        catId,
        600,
        '2026-01-01',
        '2026-12-31',
        GoalPurpose.SPENDING
      );
    goal = sm.getServices().goals.getGoalByCategoryID(catId);
    progress = sm
      .getServices()
      .goals.calculateGoalProgress(goal, { available: 700, assigned: 160, activity: 0 }, '2026-07');
    expect(progress.monthlyTarget).toBe(10);
    expect(progress.overfundedAmount).toBe(150);

    // On pace exactly → not overfunded
    progress = sm
      .getServices()
      .goals.calculateGoalProgress(goal, { available: 550, assigned: 10, activity: 0 }, '2026-07');
    expect(progress.overfundedAmount).toBe(0);
    sm.getServices().goals.deleteGoal(goalID);
  });
});
