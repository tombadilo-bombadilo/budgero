import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Two real databases stand in for two devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { GoalType, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { mutationFormatVersion } from '@budgero/runtime';
import {
  executeMutationOp,
  getUndoSpec,
  prepareMutationArgs,
} from '@shared/mutations/op-code-registry';
import type { OpCall } from '@shared/mutations/op-code-registry/shared';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Device = { services: Services; adapter: NodeSqlJsAdapter };

async function openDevice(): Promise<Device> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    return { adapter, services: manager.getServices() };
  } finally {
    cwd.mockRestore();
  }
}

function goalRows(device: Device) {
  const stmt = device.adapter.prepare('SELECT * FROM goals ORDER BY ID');
  const out = stmt.all();
  stmt.finalize();
  return out;
}

/**
 * The op as the sync layer moves it: device A prepares and runs it (and
 * builds its undo), the JSON args travel, device B replays them.
 */
async function originate(a: Device, b: Device, op: string, args: Record<string, unknown>) {
  runtime.services = a.services;
  const sent = await prepareMutationArgs(op, args);
  const spec = getUndoSpec(op);
  const before = spec?.capture ? await spec.capture(sent) : undefined;
  const result = await executeMutationOp(op, sent, { mutationId: `m-${op}`, isReceiver: false });
  const undo = JSON.parse(JSON.stringify(spec?.build(sent, result, before) ?? [])) as OpCall[];
  runtime.services = b.services;
  await executeMutationOp(op, JSON.parse(JSON.stringify(sent)), {
    mutationId: `m-${op}`,
    isReceiver: true,
  });
  return { sent, undo, format: mutationFormatVersion(op, sent) };
}

async function originateAll(a: Device, b: Device, calls: OpCall[]) {
  const formats: number[] = [];
  for (const call of calls) formats.push((await originate(a, b, call.op, call.args)).format);
  return formats;
}

const monthly = (target: number) => ({
  goalType: GoalType.MONTHLY,
  target: target * 1000,
  startDate: '2020-01-01',
  endDate: '',
  purpose: 'spending',
  recurring: false,
  cycleMonths: null,
});

describe('goal timeframe ops on two devices', () => {
  let a: Device;
  let b: Device;
  let budgetId: number;
  let groceries: number;

  const amountIn = (device: Device, month: string) => {
    try {
      return device.services.goals.getGoalByCategoryID(groceries, month).Target / 1000;
    } catch {
      return null;
    }
  };

  beforeEach(async () => {
    a = await openDevice();
    b = await openDevice();
    for (const device of [a, b]) {
      budgetId = await device.services.budgets.createBudget({
        name: 'Two devices',
        display_currency: 'USD',
        badge_icon: 'dollar',
        number_format: '123,456.78',
        create_default_categories: false,
      });
      const group = device.services.categories.addCategoryGroup('Spending', budgetId);
      groceries = device.services.categories.addCategory(group, budgetId, 'Groceries', '');
    }
  });

  it('builds the same chain everywhere, and the issue #137 months resolve on both', async () => {
    const formats = await originateAll(a, b, [
      { op: 'goals.create', args: { ...monthly(200), categoryId: groceries, budgetId } },
      {
        op: 'goals.setFrom',
        args: { ...monthly(250), categoryId: groceries, budgetId, fromMonth: '2021-06' },
      },
      {
        op: 'goals.setFrom',
        args: { ...monthly(220), categoryId: groceries, budgetId, fromMonth: '2020-10' },
      },
    ]);
    // The first goal of a category is something v1.21 devices apply the same.
    expect(formats).toEqual([2, 7, 7]);
    expect(goalRows(b)).toEqual(goalRows(a));
    for (const device of [a, b]) {
      expect(
        ['2019-01', '2020-09', '2020-10', '2021-05', '2021-06'].map((m) => amountIn(device, m))
      ).toEqual([200, 200, 220, 220, 250]);
    }
  });

  it('undo and redo of a split put every device back exactly, as one entry', async () => {
    await originate(a, b, 'goals.create', { ...monthly(200), categoryId: groceries, budgetId });
    const before = goalRows(a);
    const split = {
      ...monthly(250),
      categoryId: groceries,
      budgetId,
      fromMonth: '2022-03',
      toMonth: '2022-08',
    };
    const { undo, sent } = await originate(a, b, 'goals.setFrom', split);
    expect(undo.map((call) => call.op)).toEqual(['history.restoreRows']);
    const after = goalRows(a);
    expect(goalRows(b)).toEqual(after);

    for (const call of undo) await originate(a, b, call.op, call.args);
    expect(goalRows(a)).toEqual(before);
    expect(goalRows(b)).toEqual(before);

    // Redo: the same args (explicit months), not "the month it is now".
    await originate(a, b, 'goals.setFrom', sent);
    expect(goalRows(a)).toEqual(after);
    expect(goalRows(b)).toEqual(after);
    expect(amountIn(b, '2022-09')).toBeNull();
  });

  it('ending a goal from a month keeps history, undoes as one entry, and is format 7', async () => {
    await originateAll(a, b, [
      { op: 'goals.create', args: { ...monthly(200), categoryId: groceries, budgetId } },
      {
        op: 'goals.setFrom',
        args: { ...monthly(250), categoryId: groceries, budgetId, fromMonth: '2021-06' },
      },
    ]);
    const before = goalRows(a);
    const { undo, format } = await originate(a, b, 'goals.endFrom', {
      categoryId: groceries,
      budgetId,
      month: '2021-01',
    });
    expect(format).toBe(7);
    expect(goalRows(b)).toEqual(goalRows(a));
    expect([amountIn(b, '2020-12'), amountIn(b, '2021-01'), amountIn(b, '2021-06')]).toEqual([
      200,
      null,
      null,
    ]);
    expect(undo).toHaveLength(1);
    // The undo re-inserts a goal row with timeframe columns: v1.21 can't.
    const restored = await originate(a, b, undo[0].op, undo[0].args);
    expect(restored.format).toBe(7);
    expect(goalRows(a)).toEqual(before);
    expect(goalRows(b)).toEqual(before);
  });

  it('keeps plain edits of a single goal at the format v1.21 devices apply', async () => {
    await originate(a, b, 'goals.create', { ...monthly(200), categoryId: groceries, budgetId });
    const edit = await originate(a, b, 'goals.update', {
      ...monthly(210),
      categoryId: groceries,
      budgetId,
      effectiveFrom: '2020-01',
    });
    expect(edit.format).toBe(2);
    expect(edit.undo.map((call) => call.op)).toEqual(['history.restoreRows']);
    // Undoing a field edit carries no timeframe columns: restoreRows' own format (3).
    expect((await originate(a, b, edit.undo[0].op, edit.undo[0].args)).format).toBe(3);
    expect(amountIn(b, '2030-01')).toBe(200);

    const moved = await prepareMutationArgs('goals.update', {
      ...monthly(210),
      startDate: '2023-05-01',
      categoryId: groceries,
      budgetId,
      effectiveFrom: '2020-01',
    });
    expect(mutationFormatVersion('goals.update', moved)).toBe(7);
    const second = await prepareMutationArgs('goals.create', {
      ...monthly(1),
      startDate: '2024-01-01',
      categoryId: groceries,
      budgetId,
    });
    expect(mutationFormatVersion('goals.create', second)).toBe(7);
  });

  it('applies an older build’s update (no timeframe) to the latest timeframe', async () => {
    await originateAll(a, b, [
      { op: 'goals.create', args: { ...monthly(200), categoryId: groceries, budgetId } },
      {
        op: 'goals.setFrom',
        args: { ...monthly(250), categoryId: groceries, budgetId, fromMonth: '2021-06' },
      },
    ]);
    runtime.services = b.services;
    await executeMutationOp(
      'goals.update',
      { ...monthly(260), categoryId: groceries, budgetId },
      { mutationId: 'old', isReceiver: true }
    );
    expect([amountIn(b, '2021-05'), amountIn(b, '2021-06')]).toEqual([200, 260]);
  });

  it('deleting by category removes every timeframe and undo brings them back', async () => {
    await originateAll(a, b, [
      { op: 'goals.create', args: { ...monthly(200), categoryId: groceries, budgetId } },
      {
        op: 'goals.setFrom',
        args: { ...monthly(250), categoryId: groceries, budgetId, fromMonth: '2021-06' },
      },
    ]);
    const before = goalRows(a);
    const { undo } = await originate(a, b, 'goals.delete', { categoryId: groceries, budgetId });
    expect(goalRows(b)).toEqual([]);
    for (const call of undo) await originate(a, b, call.op, call.args);
    expect(goalRows(a)).toEqual(before);
    expect(goalRows(b)).toEqual(before);
  });
});
