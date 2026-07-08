import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchTrialSignalForOp } from './trial-signal-dispatch';

const {
  reportTrialSignalMock,
  getGoalByCategoryIDMock,
  calculateGoalProgressMock,
  getMonthlyBudgetMock,
  runtimeServicesMock,
} = vi.hoisted(() => ({
  reportTrialSignalMock: vi.fn(),
  getGoalByCategoryIDMock: vi.fn(),
  calculateGoalProgressMock: vi.fn(),
  getMonthlyBudgetMock: vi.fn(),
  runtimeServicesMock: vi.fn(),
}));

vi.mock('./trial-signals', () => ({
  reportTrialSignal: reportTrialSignalMock,
}));

vi.mock('@shared/mutations/op-code-registry/shared', () => ({
  S: () => runtimeServicesMock(),
}));

describe('dispatchTrialSignalForOp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeServicesMock.mockReturnValue({
      goals: {
        getGoalByCategoryID: getGoalByCategoryIDMock,
        calculateGoalProgress: calculateGoalProgressMock,
      },
      monthlyBudgets: { getMonthlyBudget: getMonthlyBudgetMock },
    });
    getGoalByCategoryIDMock.mockReturnValue(null);
    calculateGoalProgressMock.mockReturnValue({ isOnTrack: false, isFunded: false });
    getMonthlyBudgetMock.mockResolvedValue([]);
  });

  it('fires daily_logging on transactions.add', () => {
    dispatchTrialSignalForOp('transactions.add', { date: '2026-04-15' }, undefined);
    expect(reportTrialSignalMock).toHaveBeenCalledWith('daily_logging');
  });

  it('fires transaction_in_month with the YYYY-MM derived from args.date', () => {
    dispatchTrialSignalForOp('transactions.add', { date: '2026-04-15' }, undefined);
    expect(reportTrialSignalMock).toHaveBeenCalledWith('transaction_in_month', '2026-04');
  });

  it('fires daily_logging on transactions.updateColumn for CategoryID', () => {
    dispatchTrialSignalForOp(
      'transactions.updateColumn',
      { columnName: 'CategoryID', id: 1, newValue: 7 },
      undefined
    );
    expect(reportTrialSignalMock).toHaveBeenCalledWith('daily_logging');
  });

  it('does not fire on transactions.updateColumn for non-category columns', () => {
    dispatchTrialSignalForOp(
      'transactions.updateColumn',
      { columnName: 'Memo', id: 1, newValue: 'note' },
      undefined
    );
    expect(reportTrialSignalMock).not.toHaveBeenCalled();
  });

  it('fires reconciliation on transactions.reconcile', () => {
    dispatchTrialSignalForOp('transactions.reconcile', {}, undefined);
    expect(reportTrialSignalMock).toHaveBeenCalledWith('reconciliation');
  });

  it('fires assignment_in_month on monthlyBudgets.upsertAssignment', () => {
    dispatchTrialSignalForOp(
      'monthlyBudgets.upsertAssignment',
      { categoryId: 1, amount: 100, month: '2026-05', budgetId: 1 },
      undefined
    );
    expect(reportTrialSignalMock).toHaveBeenCalledWith('assignment_in_month', '2026-05');
  });

  it('fires goal_funding when the goal calculation reports isOnTrack', async () => {
    getGoalByCategoryIDMock.mockReturnValue({ ID: 7, CategoryID: 1, Target: 500 });
    getMonthlyBudgetMock.mockReturnValue([
      // Yearly $500 goal — only $27 funded, but the goal calc says
      // isOnTrack=true (this month's monthly target is met).
      { CategoryID: 1, Available: 27, Activity: 0, Assigned: 27 },
    ]);
    calculateGoalProgressMock.mockReturnValue({ isOnTrack: true, isFunded: false });

    dispatchTrialSignalForOp(
      'monthlyBudgets.upsertAssignment',
      { categoryId: 1, amount: 27, month: '2026-05', budgetId: 1 },
      undefined
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(reportTrialSignalMock).toHaveBeenCalledWith('goal_funding');
  });

  it('does not fire goal_funding when the goal calc reports off-track', async () => {
    getGoalByCategoryIDMock.mockReturnValue({ ID: 7, CategoryID: 1, Target: 500 });
    getMonthlyBudgetMock.mockReturnValue([
      { CategoryID: 1, Available: 5, Activity: 0, Assigned: 5 },
    ]);
    calculateGoalProgressMock.mockReturnValue({ isOnTrack: false, isFunded: false });

    dispatchTrialSignalForOp(
      'monthlyBudgets.upsertAssignment',
      { categoryId: 1, amount: 5, month: '2026-05', budgetId: 1 },
      undefined
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(reportTrialSignalMock).not.toHaveBeenCalledWith('goal_funding');
  });

  it('fires assignment_in_month once per distinct month for batch assignments', () => {
    dispatchTrialSignalForOp(
      'monthlyBudgets.batchUpsertAssignments',
      {
        assignments: [
          { categoryId: 1, amount: 100, month: '2026-04', budgetId: 1 },
          { categoryId: 2, amount: 50, month: '2026-04', budgetId: 1 },
          { categoryId: 3, amount: 25, month: '2026-05', budgetId: 1 },
        ],
      },
      undefined
    );
    const calls = reportTrialSignalMock.mock.calls.filter((c) => c[0] === 'assignment_in_month');
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c[1]).sort()).toEqual(['2026-04', '2026-05']);
  });

  it('ignores unrelated ops', () => {
    dispatchTrialSignalForOp('payees.add', {}, undefined);
    dispatchTrialSignalForOp('categories.delete', {}, undefined);
    expect(reportTrialSignalMock).not.toHaveBeenCalled();
  });

  it('does not fire deprecated rule_applied or budget_cycle_assign', () => {
    // rules.execute used to fire rule_applied — confirm it no longer does.
    dispatchTrialSignalForOp('rules.execute', { ruleId: 1 }, { changes: [{}, {}] });
    expect(reportTrialSignalMock).not.toHaveBeenCalled();
  });
});
