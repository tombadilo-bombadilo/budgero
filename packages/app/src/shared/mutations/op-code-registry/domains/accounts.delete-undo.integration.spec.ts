import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { executeMutationOp, getUndoSpec } from '@shared/mutations/op-code-registry';
import type { OpCall } from '@shared/mutations/op-code-registry/shared';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Db = Awaited<ReturnType<typeof NodeSqlJsAdapter.create>>;

function dump(db: Db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_stat1' ORDER BY name"
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all()])
  );
}

async function run(op: string, args: Record<string, unknown>) {
  const spec = getUndoSpec(op);
  const before = spec?.capture ? await spec.capture(args) : undefined;
  const result = await executeMutationOp(op, args);
  return JSON.parse(JSON.stringify(spec?.build(args, result, before) ?? [])) as OpCall[];
}

describe('account ops with real services', () => {
  let db: Db;
  let services: Services;
  let budgetId: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      db = await NodeSqlJsAdapter.create();
      await manager.initialize(db);
    } finally {
      cwd.mockRestore();
    }
    services = manager.getServices();
    runtime.services = services;
    budgetId = await services.budgets.createBudget({
      name: 'Accounts',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
  });

  it('accounts.delete can be undone: the account and its linked category come back exactly', async () => {
    const checking = (
      await services.accounts.createAccount(
        'Checking',
        budgetId,
        'checking',
        'USD',
        asMilli(500_000)
      )
    ).ID;
    const loan = await services.accounts.createAccount('Car', budgetId, 'loan', 'USD', asMilli(0), {
      debt_total: 1_000_000,
    });
    const transfers = services.categories.getCategoryByName('Transfers', budgetId)!.ID;
    for (const [account, inflow, outflow] of [
      [checking, 0, 100_000],
      [loan.ID, 100_000, 0],
    ]) {
      await services.transactions.addTransaction(
        asMilli(inflow),
        asMilli(outflow),
        account,
        transfers,
        budgetId,
        '2026-03-01',
        'payment',
        't1'
      );
    }
    const before = dump(db);
    const undo = await run('accounts.delete', { id: loan.ID, budgetId });
    expect(undo.map((call) => call.op)).toEqual(['accounts.restoreDeleted']);
    expect(services.accounts.listAccounts(budgetId).some((a) => a.ID === loan.ID)).toBe(false);
    for (const call of undo) await executeMutationOp(call.op, call.args);
    expect(dump(db)).toEqual(before);
  });

  it('accounts.createLinked writes nothing when any part fails', async () => {
    const before = dump(db);
    await expect(
      executeMutationOp('accounts.createLinked', {
        name: 'Everyday',
        budgetId,
        type: 'checking',
        currency: 'USD',
        balance: 1_000,
        metadata: {},
        onBudget: true,
        link: { provider: 'simplefin', externalAccountId: 'A', externalName: 'A', orgName: 'B' },
      })
    ).rejects.toThrow();
    expect(dump(db)).toEqual(before);
  });

  it('accounts.createLinked undo removes the account and its link', async () => {
    const before = dump(db);
    const undo = await run('accounts.createLinked', {
      name: 'Everyday',
      budgetId,
      type: 'checking',
      currency: 'USD',
      balance: 1_000,
      metadata: {},
      onBudget: true,
      initialBalanceDate: '2026-08-31',
      link: {
        provider: 'simplefin',
        externalAccountId: 'ACT-1',
        externalName: 'Everyday',
        orgName: 'Bank',
        importFrom: '2026-09-01',
      },
    });
    expect(services.bankSync.listLinks(budgetId)).toHaveLength(1);
    expect(undo).toEqual([{ op: 'accounts.delete', args: { id: expect.any(Number) } }]);
    for (const call of undo) await executeMutationOp(call.op, call.args);
    expect(services.bankSync.listLinks(budgetId)).toEqual([]);
    expect(services.accounts.listAccounts(budgetId)).toEqual([]);
    // Like plain accounts.create undo: the AUTOINCREMENT counters move on and the
    // opening row's system payee stays in the payee list; every other table is back.
    const { sqlite_sequence: _seqAfter, payees: _payeesAfter, ...rest } = dump(db);
    const { sqlite_sequence: _seqBefore, payees: _payeesBefore, ...expected } = before;
    expect(rest).toEqual(expected);
  });
});
