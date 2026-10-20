/**
 * Rule-run undo / redo integrity (tracker A30, A31, A32, U6): exact restores
 * (foreign-currency amounts, transfer partners), all-or-nothing undo, a
 * deterministic outcome when rows or categories are gone, overlap-based
 * undo order, and a rule delete that keeps its run history for undo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDateString } from '../src/utils/date';
import { NodeSqlJsAdapter, ServiceManager, type DatabaseAdapter } from '../src';
import type { RuleAction, RuleCondition } from '../src/services/rules';
import { dumpDb } from './db-dump.helpers';

const coffee: RuleCondition[] = [{ field: 'memo', operator: 'contains', value: 'coffee' }];

describe('rule-run undo integrity', () => {
  let adapter: DatabaseAdapter;
  let services: ReturnType<ServiceManager['getServices']>;
  let budgetId: number;
  let usd: number;
  let eur: number;
  let food: number;
  let fun: number;
  let rent: number;
  const today = getLocalDateString();

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    budgetId = await services.budgets.createBudget({
      name: 'Rule undo',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    await services.currency.saveRate('EUR', 'USD', 1.17, today, budgetId);
    await services.currency.saveRate('USD', 'EUR', 1 / 1.17, today, budgetId);
    usd = (await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 500_000))
      .ID;
    eur = (await services.accounts.createAccount('Euro', budgetId, 'checking', 'EUR', 676_600)).ID;
    const groupId = services.categories.addCategoryGroup('Life', budgetId);
    food = services.categories.addCategory(groupId, budgetId, 'Food');
    fun = services.categories.addCategory(groupId, budgetId, 'Fun');
    rent = services.categories.addCategory(groupId, budgetId, 'Rent');
  });

  const add = (account: number, outflow: number, memo: string, category = rent) =>
    services.transactions.addTransaction(
      0,
      outflow,
      account,
      category,
      budgetId,
      today,
      memo,
      '',
      'Shop'
    );

  const rule = (actions: RuleAction[], conditions = coffee) =>
    services.rules.createRule({ budgetId, name: 'r', conditions, actions, mode: 'one_time' });

  /** Everything except the rule-run bookkeeping (the run row stays as 'undone'). */
  const data = () => {
    const dump = dumpDb(adapter);
    delete dump.transaction_rule_runs;
    delete dump.transaction_rule_run_changes;
    delete dump.transaction_rules;
    delete dump.sqlite_sequence;
    delete dump.currency_rates;
    return dump;
  };

  const tx = (id: number) => services.transactions.getTransactionByID(id);
  /** The TransactionService the rules service writes through. */
  const rulesTx = () =>
    (services.rules as unknown as { transactions: typeof services.transactions }).transactions;

  describe('A31: exact restore of writes that go through the full update', () => {
    it('puts a foreign-currency row back with its native and converted amounts', async () => {
      const id = await add(eur, 86_380, 'coffee beans');
      const before = data();
      const r = rule([{ type: 'amount.adjust_value', payload: { delta: 100 } }]);

      const execution = await services.rules.executeRule(r.id);
      expect(execution.changes[0]!.metadata).toHaveProperty('rowJournal');
      const after = data();
      expect(after).not.toEqual(before);

      await services.rules.undoRun(execution.run.id);
      expect(data()).toEqual(before);
      expect(tx(id).OutflowNative).toBe(86_380);

      // Redo re-applies the same run exactly; undo again restores exactly.
      await services.rules.redoRun(execution.run.id, { run: { status: 'completed' } });
      expect(data()).toEqual(after);
      await services.rules.undoRun(execution.run.id);
      expect(data()).toEqual(before);
    });

    it('puts a transfer leg and its foreign partner back', async () => {
      await services.transactions.addTransaction(
        0,
        11_700,
        usd,
        0,
        budgetId,
        today,
        'coffee fund',
        'tr-1'
      );
      await services.transactions.addTransaction(
        10_000,
        0,
        eur,
        0,
        budgetId,
        today,
        'coffee fund',
        'tr-1'
      );
      const before = data();
      const r = rule([{ type: 'memo.set', payload: { memo: 'beans' } }]);

      const execution = await services.rules.executeRule(r.id);
      expect(execution.matchedCount).toBe(2);
      await services.rules.undoRun(execution.run.id);
      expect(data()).toEqual(before);
    });

    it('keeps an empty payee as stored, through the run and its undo', async () => {
      const id = await add(usd, 1_000, 'coffee');
      adapter.prepare(`UPDATE transactions SET Payee = '' WHERE ID = ?`).run(id);
      const before = data();
      const execution = await services.rules.executeRule(
        rule([{ type: 'category.set', payload: { categoryId: food } }]).id
      );
      expect(execution.changes[0]!.metadata).toHaveProperty('rowJournal');
      expect(tx(id).Payee).toBe('');
      await services.rules.undoRun(execution.run.id);
      expect(data()).toEqual(before);
    });
  });

  describe('A32: all or nothing, and the same outcome everywhere', () => {
    it('skips a row whose old category was deleted since and restores the others', async () => {
      const a = await add(usd, 1_000, 'coffee a', rent);
      const b = await add(usd, 2_000, 'coffee b', fun);
      const execution = await services.rules.executeRule(
        rule([{ type: 'category.set', payload: { categoryId: food } }]).id
      );
      services.categories.deleteCategoryWithUndo(fun, food);

      const undo = await services.rules.undoRun(execution.run.id);
      expect(undo.restoredTransactions).toBe(1);
      expect(tx(a).CategoryID).toBe(rent);
      expect(tx(b).CategoryID).toBe(food);
      expect(undo.run.status).toBe('undone');
    });

    it('skips a row deleted since', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const b = await add(usd, 2_000, 'coffee b');
      const execution = await services.rules.executeRule(
        rule([{ type: 'memo.set', payload: { memo: 'tea' } }]).id
      );
      services.transactions.deleteTransaction(b);

      const undo = await services.rules.undoRun(execution.run.id);
      expect(undo.restoredTransactions).toBe(1);
      expect(tx(a).Memo).toBe('coffee a');
    });

    it('leaves nothing behind when it fails after restoring rows (one DB transaction)', async () => {
      await add(usd, 1_000, 'coffee a');
      await add(eur, 2_000, 'coffee b');
      const execution = await services.rules.executeRule(
        rule([
          { type: 'memo.set', payload: { memo: 'tea' } },
          { type: 'amount.adjust_value', payload: { delta: -100 } },
        ]).id
      );
      const before = dumpDb(adapter);
      // The run bookkeeping is written last, after both rows were restored.
      const spy = vi.spyOn(services.rules, 'updateRun').mockImplementation(() => {
        throw new Error('disk full');
      });
      try {
        await expect(services.rules.undoRun(execution.run.id)).rejects.toThrow(/disk full/);
      } finally {
        spy.mockRestore();
      }
      expect(dumpDb(adapter)).toEqual(before);
      // Nothing was applied, so it can be retried.
      await services.rules.undoRun(execution.run.id);
      expect(services.rules.getRun(execution.run.id).status).toBe('undone');
    });

    it('rolls back an undo that needs the full update when a later step fails', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const b = await add(usd, 2_000, 'coffee b');
      // A legacy run (no row journal): the amount restore goes through updateTransaction.
      const r = rule([]);
      const run = services.rules.createRun({
        ruleId: r.id,
        trigger: 'manual',
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      for (const [id, oldOut] of [
        [a, 500],
        [b, 700],
      ] as const) {
        services.rules.logRunChange({
          runId: run.id,
          ruleId: r.id,
          transactionId: id,
          actionType: 'amount',
          field: 'amount',
          oldValue: -oldOut,
          metadata: { oldInflow: 0, oldOutflow: oldOut },
        });
      }
      const before = dumpDb(adapter);
      const original = rulesTx().updateTransaction.bind(rulesTx());
      let calls = 0;
      const spy = vi.spyOn(rulesTx(), 'updateTransaction').mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) throw new Error('rate service down');
        return original(...args);
      });
      try {
        await expect(services.rules.undoRun(run.id)).rejects.toThrow(/rate service down/);
      } finally {
        spy.mockRestore();
      }
      expect(dumpDb(adapter)).toEqual(before);
      expect(tx(a).OutflowConverted).toBe(1_000);
    });
  });

  describe('A30: which run can be undone', () => {
    it('allows undoing a run after later runs on other rows, whatever their completion time', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const r = rule([{ type: 'category.set', payload: { categoryId: food } }]);
      const first = await services.rules.executeRule(r.id, { transactionIds: [a] });
      const b = await add(usd, 2_000, 'coffee b');
      const second = await services.rules.executeRule(r.id, { transactionIds: [b] });
      // The later run completed "earlier" (another device's clock).
      adapter
        .prepare(
          `UPDATE transaction_rule_runs SET CompletedAt = '2000-01-01T00:00:00.000Z' WHERE ID = ?`
        )
        .run(second.run.id);

      await services.rules.undoRun(first.run.id);
      expect(tx(a).CategoryID).toBe(rent);
      expect(tx(b).CategoryID).toBe(food);
    });

    it('refuses while a later applied run changed the same rows, by run order', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const first = await services.rules.executeRule(
        rule([{ type: 'category.set', payload: { categoryId: food } }]).id
      );
      const second = await services.rules.executeRule(
        rule([{ type: 'memo.set', payload: { memo: 'coffee!' } }]).id
      );
      adapter
        .prepare(
          `UPDATE transaction_rule_runs SET CompletedAt = '2000-01-01T00:00:00.000Z' WHERE ID = ?`
        )
        .run(second.run.id);
      const before = dumpDb(adapter);

      await expect(services.rules.undoRun(first.run.id)).rejects.toThrow(
        /later rule run changed the same transactions/
      );
      expect(dumpDb(adapter)).toEqual(before);

      await services.rules.undoRun(second.run.id);
      await services.rules.undoRun(first.run.id);
      expect(tx(a).CategoryID).toBe(rent);
      expect(tx(a).Memo).toBe('coffee a');
    });
  });

  describe('redo and failed runs', () => {
    it('redo puts back change rows deleted with their transaction', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const r = rule([{ type: 'category.set', payload: { categoryId: food } }]);
      const execution = await services.rules.executeRule(r.id, { trigger: 'continuous' });
      const changesBefore = dumpDb(adapter).transaction_rule_run_changes;
      await services.rules.undoRun(execution.run.id);
      adapter
        .prepare('DELETE FROM transaction_rule_run_changes WHERE RunID = ?')
        .run(execution.run.id);

      await services.rules.redoRun(execution.run.id, {
        changes: execution.changes,
        run: { status: 'completed', notes: '', transactionCount: 1 },
      });
      expect(dumpDb(adapter).transaction_rule_run_changes).toEqual(changesBefore);
      expect(tx(a).CategoryID).toBe(food);
      expect(services.rules.getRun(execution.run.id).status).toBe('completed');
    });

    it('allowFailed marks a failed run undone and puts the rule state back; redo restores it', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const r = rule([{ type: 'amount.set', payload: { amount: 'x' as unknown as number } }]);
      const execution = await services.rules.executeRule(r.id, { transactionIds: [a] });
      expect(execution.run.status).toBe('failed');

      await services.rules.undoRun(execution.run.id, {
        allowFailed: true,
        ruleState: { lastRunAt: null, oneTimeConsumed: false },
      });
      expect(services.rules.getRun(execution.run.id).status).toBe('undone');
      expect(services.rules.getRule(r.id).lastRunAt).toBeNull();

      await services.rules.redoRun(execution.run.id, {
        run: { status: 'failed', notes: execution.run.notes },
      });
      expect(services.rules.getRun(execution.run.id).status).toBe('failed');
    });
  });

  describe('U6: deleting a rule keeps its run history for undo', () => {
    it('restores the rule, its runs and their change rows exactly', async () => {
      await add(usd, 1_000, 'coffee a');
      const r = rule([{ type: 'category.set', payload: { categoryId: food } }]);
      await services.rules.executeRule(r.id);
      const before = dumpDb(adapter);

      const journal = services.rules.deleteRuleWithUndo(r.id);
      expect(journal).not.toBeNull();
      expect(dumpDb(adapter).transaction_rule_runs).toEqual([]);
      services.rules.restoreDeletedRule(journal!);
      expect(dumpDb(adapter)).toEqual(before);
    });

    it('leaves out change rows of transactions deleted since', async () => {
      const a = await add(usd, 1_000, 'coffee a');
      const b = await add(usd, 2_000, 'coffee b');
      const r = rule([{ type: 'category.set', payload: { categoryId: food } }]);
      await services.rules.executeRule(r.id);
      const journal = services.rules.deleteRuleWithUndo(r.id)!;
      services.transactions.deleteTransaction(b);

      const restored = services.rules.restoreDeletedRule(journal);
      expect(restored.id).toBe(r.id);
      const changes = services.rules.listRunChanges(services.rules.listRuns(r.id)[0]!.id);
      expect(changes.map((change) => change.transactionId)).toEqual([a]);
    });

    it('returns null for a rule that is already gone', () => {
      expect(services.rules.deleteRuleWithUndo(999_999)).toBeNull();
    });
  });
});
