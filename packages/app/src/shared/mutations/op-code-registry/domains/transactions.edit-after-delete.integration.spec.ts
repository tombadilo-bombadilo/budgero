import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Two real databases stand in for two devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Device = { services: Services; adapter: NodeSqlJsAdapter };

async function openDevice(bytes?: Uint8Array): Promise<Device> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const adapter = await NodeSqlJsAdapter.create(bytes);
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    return { adapter, services: manager.getServices() };
  } finally {
    cwd.mockRestore();
  }
}

function rows(device: Device, sql: string) {
  const stmt = device.adapter.prepare(sql);
  const out = stmt.all();
  stmt.finalize();
  return out;
}

const TX = 'SELECT ID, AccountID, Memo, Payee, OutflowConverted FROM transactions ORDER BY ID';

/** Run an op on `device` the way the sync layer does: originated locally, or replayed from the log. */
async function run(
  device: Device,
  op: string,
  args: Record<string, unknown>,
  as: 'local' | 'remote',
  mutationId = `m-${op}-${Math.random()}`
) {
  runtime.services = device.services;
  const sent = as === 'local' ? await registry.prepareMutationArgs(op, args) : args;
  return registry.executeMutationOp(op, JSON.parse(JSON.stringify(sent)), {
    mutationId,
    isReceiver: as === 'remote',
  });
}

/** Originate on `from`, replay on `to`: one log entry seen by both devices. */
async function originate(from: Device, to: Device, op: string, args: Record<string, unknown>) {
  runtime.services = from.services;
  const sent = await registry.prepareMutationArgs(op, args);
  const result = await run(from, op, sent, 'local', `m-${op}`);
  await run(to, op, sent, 'remote', `m-${op}`);
  return result;
}

describe('a synced edit of a transaction deleted earlier in the log', () => {
  let a: Device;
  let b: Device;
  let budgetId: number;
  let checkingId: number;
  let savingsId: number;

  const addArgs = (memo: string) => ({
    budgetId,
    accountId: checkingId,
    categoryId: 0,
    date: '2026-11-20',
    inflow: 0,
    outflow: 12,
    memo,
    payee: 'Shop',
  });

  beforeEach(async () => {
    a = await openDevice();
    budgetId = await a.services.budgets.createBudget({
      name: 'Shared',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    checkingId = (
      await a.services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
    ).ID;
    savingsId = (
      await a.services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    b = await openDevice(a.adapter.backup() as Uint8Array);
  });

  it('delete vs edit race: the delete wins on both devices, no replay failure', async () => {
    const id = (await originate(a, b, 'transactions.add', addArgs('lunch'))) as number;
    expect(rows(b, TX)).toEqual(rows(a, TX));

    // Neither device has seen the other's change yet.
    const edit = { id, columnName: 'Memo', newValue: 'team lunch' };
    await run(b, 'transactions.updateColumn', edit, 'local', 'edit');
    await run(a, 'transactions.delete', { id }, 'local', 'delete');

    // The log holds the delete first, then the edit. A replays the edit of a
    // row it deleted; B replays the delete of a row it edited.
    await expect(run(a, 'transactions.updateColumn', edit, 'remote', 'edit')).resolves.toBe(
      undefined
    );
    await run(b, 'transactions.delete', { id }, 'remote', 'delete');

    expect(rows(a, TX)).toEqual([]);
    expect(rows(b, TX)).toEqual(rows(a, TX));
  });

  it('drops split and amount edits of a deleted transaction too', async () => {
    const id = (await originate(a, b, 'transactions.add', addArgs('groceries'))) as number;
    await originate(a, b, 'transactions.delete', { id });

    await expect(
      run(b, 'transactions.clearSplits', { transactionId: id }, 'remote')
    ).resolves.toBeUndefined();
    await expect(
      run(
        b,
        'transactions.saveSplits',
        { transactionId: id, splits: [{ category_id: 0, outflow: 12 }] },
        'remote'
      )
    ).resolves.toBeUndefined();
    expect(rows(b, TX)).toEqual([]);
  });

  it('a batch edit still changes the rows that exist', async () => {
    const kept = (await originate(a, b, 'transactions.add', addArgs('kept'))) as number;
    const gone = (await originate(a, b, 'transactions.add', addArgs('gone'))) as number;
    await originate(a, b, 'transactions.delete', { id: gone });

    await run(
      b,
      'transactions.batchEdit',
      {
        edits: [
          { id: kept, accountId: savingsId },
          { id: gone, accountId: savingsId },
        ],
      },
      'remote'
    );
    expect(rows(b, TX)).toEqual([expect.objectContaining({ ID: kept, AccountID: savingsId })]);
  });

  it('still fails for a transaction this device never had (diverged DB: restore)', async () => {
    const id = (await originate(a, b, 'transactions.add', addArgs('only on A'))) as number;
    // B never got that create (e.g. a skipped mutation): its counter is below the ID.
    const neverSeen = id + 5;
    await expect(
      run(
        b,
        'transactions.updateColumn',
        { id: neverSeen, columnName: 'Memo', newValue: 'x' },
        'remote'
      )
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('an edit made on this device keeps failing for a missing row', async () => {
    const id = (await originate(a, b, 'transactions.add', addArgs('local'))) as number;
    await originate(a, b, 'transactions.delete', { id });
    await expect(
      run(a, 'transactions.updateColumn', { id, columnName: 'Memo', newValue: 'x' }, 'local')
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
