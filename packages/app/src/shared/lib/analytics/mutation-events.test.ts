import { beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
vi.mock('./track', () => ({ track }));

const { readBeforeState, reportMutationAnalytics } = await import('./mutation-events');

const services = {
  budgets: { getBudget: () => ({ DisplayCurrency: 'EUR' }) },
  goals: { getGoalByCategoryID: () => ({ Type: 'target-date' }) },
  rules: { getRule: () => ({ mode: 'one_time', actions: [{}, {}] }) },
  recurring: {
    getRecurringTransaction: () => ({
      toAccountId: 7,
      direction: 'outflow',
      schedule: { intervalUnit: 'month' },
    }),
  },
};

beforeEach(() => track.mockClear());

describe('mutation analytics', () => {
  it('tags transactions with their entry point', () => {
    reportMutationAnalytics(
      {
        op: 'transactions.add',
        payload: { memo: 'Rent', payee: 'Landlord' },
        meta: { analytics: 'inline' },
      },
      1,
      services
    );
    reportMutationAnalytics({ op: 'transactions.add', meta: { label: 'push-api' } }, 2, services);
    reportMutationAnalytics(
      { op: 'transactions.import', meta: { label: 'bank-sync', deferContinuousRules: true } },
      { created: true },
      services
    );
    reportMutationAnalytics({ op: 'transactions.import' }, { created: false }, services);
    expect(track.mock.calls).toEqual([
      ['Transaction Logged', { entry: 'inline' }],
      ['Transaction Logged', { entry: 'push' }],
      ['Transaction Logged', { entry: 'bank_sync' }],
    ]);
  });

  it('never forwards free-text args', () => {
    reportMutationAnalytics(
      {
        op: 'accounts.create',
        payload: { name: 'My Secret Savings', type: 'Savings', currency: 'USD', budgetId: 1 },
      },
      null,
      services
    );
    expect(track).toHaveBeenCalledWith('Account Added', {
      type: 'Savings',
      currency_is_budget_currency: 'no',
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain('Secret');
  });

  it('reads types of deleted items before they are gone', () => {
    const goal = { op: 'goals.delete', payload: { categoryId: 3 } };
    reportMutationAnalytics(goal, null, services, readBeforeState(goal, services));
    const rule = { op: 'rules.delete', payload: { id: 1 } };
    reportMutationAnalytics(rule, null, services, readBeforeState(rule, services));
    const recurring = { op: 'recurring.delete', payload: { id: 1 } };
    reportMutationAnalytics(recurring, null, services, readBeforeState(recurring, services));
    expect(track.mock.calls).toEqual([
      ['goal_deleted', { type: 'target-date' }],
      ['rule_deleted', { trigger: 'manual', actions_bucket: '2-3' }],
      ['recurring_deleted', { frequency: 'month', kind: 'transfer' }],
    ]);
  });

  it('skips automatic rule runs that matched nothing, and replays', () => {
    reportMutationAnalytics(
      { op: 'rules.execute', payload: { options: { trigger: 'continuous' } } },
      { matchedCount: 0, run: { status: 'completed' } },
      services
    );
    reportMutationAnalytics(
      {
        op: 'rules.execute',
        payload: { options: { trigger: 'continuous' } },
        meta: { analytics: 'bank_sync' },
      },
      { matchedCount: 12, run: { status: 'completed' } },
      services
    );
    reportMutationAnalytics({ op: 'transactions.add', meta: { replay: 'redo' } }, 1, services);
    expect(track.mock.calls).toEqual([
      ['rule_run', { trigger: 'bank_sync', outcome: 'ok', matched_bucket: '10-100' }],
    ]);
  });
});
