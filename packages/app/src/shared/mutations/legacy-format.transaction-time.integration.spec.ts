/**
 * Transaction time of day (format 7): calls that write a time go out as
 * format 7, so v1.21 devices (no Time column) stop with "update required"
 * instead of dropping it; the same calls without a time keep their format.
 * Also checks that the ops carry the time end to end (add, transfer legs,
 * duplicate, undo/redo, time edits).
 */
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { BASE_MUTATION_FORMAT_VERSION, mutationFormatVersion } from '@budgero/runtime';
import { executeMutationOp, prepareMutationArgs } from './op-code-registry';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

let services: Services;
let budgetId: number;
let checking: number;
let savings: number;
let groceries: number;

async function sentFormat(op: string, args: Record<string, unknown>): Promise<number> {
  return mutationFormatVersion(op, await prepareMutationArgs(op, args));
}

const time = (id: number) => services.transactions.getTransactionByID(id).Time ?? null;

const addArgs = (extra: Record<string, unknown> = {}) => ({
  budgetId,
  accountId: checking,
  categoryId: groceries,
  date: '2026-09-10',
  memo: 'coffee',
  payee: 'Cafe',
  inflow: 0,
  outflow: 3500,
  ...extra,
});

beforeEach(async () => {
  const manager = new ServiceManager();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    await manager.initialize(await NodeSqlJsAdapter.create());
  } finally {
    cwd.mockRestore();
  }
  services = manager.getServices();
  runtime.services = services;
  budgetId = await services.budgets.createBudget({
    name: 'Times',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  checking = (
    await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
  ).ID;
  savings = (
    await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
  ).ID;
  groceries = services.categories
    .getAllCategories(budgetId)
    .filter((category) => !['Income', 'Uncategorized', 'Transfers'].includes(category.Name))[0].ID;
});

describe('format of time-bearing calls', () => {
  it('adds and imports: format 7 only with a time', async () => {
    expect(await sentFormat('transactions.add', addArgs())).toBe(BASE_MUTATION_FORMAT_VERSION);
    expect(await sentFormat('transactions.add', addArgs({ time: '' }))).toBe(
      BASE_MUTATION_FORMAT_VERSION
    );
    expect(await sentFormat('transactions.add', addArgs({ time: '08:30' }))).toBe(7);
    expect(await sentFormat('transactions.import', addArgs({ time: '08:30' }))).toBe(7);
    expect(
      await sentFormat('transactions.addTransfer', {
        budgetId,
        transferId: 't1',
        source: { ...addArgs(), time: '09:00' },
        destination: { ...addArgs({ accountId: savings, inflow: 3500, outflow: 0 }) },
      })
    ).toBe(7);
  });

  it('edits: a time edit is format 7, a memo edit on a timed row is not', async () => {
    const id = (await executeMutationOp('transactions.add', addArgs({ time: '08:30' }))) as number;
    expect(
      await sentFormat('transactions.updateColumn', { id, columnName: 'Memo', newValue: 'x' })
    ).toBe(BASE_MUTATION_FORMAT_VERSION);
    expect(
      await sentFormat('transactions.updateColumn', { id, columnName: 'Time', newValue: '09:00' })
    ).toBe(7);
  });

  it('copies and restores of timed rows are format 7', async () => {
    const timed = (await executeMutationOp(
      'transactions.add',
      addArgs({ time: '08:30' })
    )) as number;
    const plain = (await executeMutationOp('transactions.add', addArgs())) as number;
    expect(await sentFormat('transactions.duplicate', { ids: [plain] })).toBe(
      BASE_MUTATION_FORMAT_VERSION
    );
    expect(await sentFormat('transactions.duplicate', { ids: [timed] })).toBe(7);
    const snapshot = services.transactions.captureRestoreSnapshot([timed]);
    expect(await sentFormat('transactions.restore', { snapshot })).toBe(7);
    const untimed = services.transactions.captureRestoreSnapshot([plain]);
    // transactions.restore is a format-3 op code; without a time it stays there.
    expect(await sentFormat('transactions.restore', { snapshot: untimed })).toBe(3);
  });
});

describe('ops carry the time', () => {
  it('add, edit and clear; the date and balances do not change', async () => {
    const id = (await executeMutationOp('transactions.add', addArgs({ time: '7:05' }))) as number;
    expect(time(id)).toBe('07:05');
    const before = services.transactions.getTransactionByID(id);
    await executeMutationOp('transactions.updateColumn', {
      id,
      columnName: 'Time',
      newValue: '',
    });
    expect(time(id)).toBeNull();
    expect(services.transactions.getTransactionByID(id)).toMatchObject({
      Date: before.Date,
      RunningBalanceConverted: before.RunningBalanceConverted,
    });
  });

  it('both transfer legs share the time; a duplicate keeps it', async () => {
    const { sourceId, destinationId } = (await executeMutationOp('transactions.addTransfer', {
      budgetId,
      transferId: 'xfer-time',
      time: '18:45',
      source: addArgs(),
      destination: addArgs({ accountId: savings, inflow: 3500, outflow: 0 }),
    })) as { sourceId: number; destinationId: number };
    expect([time(sourceId), time(destinationId)]).toEqual(['18:45', '18:45']);

    const id = (await executeMutationOp('transactions.add', addArgs({ time: '12:34' }))) as number;
    const { created } = (await executeMutationOp('transactions.duplicate', {
      ids: [id],
    })) as { created: number[] };
    expect(time(created[0])).toBe('12:34');
  });

  it('a split parent keeps its time through a split save', async () => {
    const id = (await executeMutationOp('transactions.add', addArgs({ time: '10:10' }))) as number;
    await executeMutationOp('transactions.upsertSplits', {
      transactionId: id,
      splits: [
        { CategoryID: groceries, OutflowConverted: 2000, Memo: 'a' },
        { CategoryID: groceries, OutflowConverted: 1500, Memo: 'b' },
      ],
    });
    expect(time(id)).toBe('10:10');
  });
});
