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

const monthly = (target: number) => ({
  goalType: GoalType.MONTHLY,
  target: target * 1000,
  startDate: '2020-01-01',
  endDate: '',
  purpose: 'spending',
  recurring: false,
  cycleMonths: null,
});

const usd = (target: number, extra: Record<string, unknown> = {}) => ({
  ...monthly(target),
  targetCurrency: 'USD',
  ...extra,
});

const currencies = (device: Device) =>
  (goalRows(device) as { ID: number; Target: number; TargetCurrency: string | null }[]).map(
    (row) => [row.Target, row.TargetCurrency]
  );

describe('goals in another currency on two devices', () => {
  let a: Device;
  let b: Device;
  let budgetId: number;
  let trip: number;

  beforeEach(async () => {
    a = await openDevice();
    b = await openDevice();
    for (const device of [a, b]) {
      budgetId = await device.services.budgets.createBudget({
        name: 'Two devices',
        display_currency: 'EUR',
        badge_icon: 'euro',
        number_format: '123,456.78',
        create_default_categories: false,
      });
      const group = device.services.categories.addCategoryGroup('Plans', budgetId);
      trip = device.services.categories.addCategory(group, budgetId, 'Trip', '');
    }
  });

  it('a goal in another currency syncs with its currency, as format 8', async () => {
    const { format } = await originate(a, b, 'goals.create', {
      ...usd(1_000),
      categoryId: trip,
      budgetId,
    });
    // v1.22 would store $1,000 as €1,000: it must stop and update first.
    expect(format).toBe(8);
    expect(currencies(a)).toEqual([[1_000_000, 'USD']]);
    expect(goalRows(b)).toEqual(goalRows(a));
  });

  it('a goal in the budget currency stays at the format older builds apply', async () => {
    const plain = await originate(a, b, 'goals.create', {
      ...monthly(200),
      categoryId: trip,
      budgetId,
    });
    expect(plain.format).toBe(2);
    // Picking the budget currency explicitly is the same as none.
    const prepared = await prepareMutationArgs('goals.setFrom', {
      ...monthly(250),
      targetCurrency: null,
      categoryId: trip,
      budgetId,
      fromMonth: '2021-06',
    });
    expect(mutationFormatVersion('goals.setFrom', prepared)).toBe(7);
    expect(currencies(b)).toEqual([[200_000, null]]);
  });

  it('setting, undoing and redoing a currency edit puts every device back exactly', async () => {
    await originate(a, b, 'goals.create', { ...monthly(200), categoryId: trip, budgetId });
    const before = goalRows(a);
    const edit = await originate(a, b, 'goals.update', {
      ...usd(300),
      categoryId: trip,
      budgetId,
      effectiveFrom: '2020-01',
    });
    expect(edit.format).toBe(8);
    const after = goalRows(a);
    expect(currencies(b)).toEqual([[300_000, 'USD']]);

    // The undo puts TargetCurrency back to NULL: undo data with the column.
    expect(edit.undo.map((call) => call.op)).toEqual(['history.restoreRows']);
    const undone = await originate(a, b, edit.undo[0].op, edit.undo[0].args);
    expect(undone.format).toBe(8);
    expect(goalRows(a)).toEqual(before);
    expect(goalRows(b)).toEqual(before);

    await originate(a, b, 'goals.update', edit.sent);
    expect(goalRows(a)).toEqual(after);
    expect(goalRows(b)).toEqual(after);
  });

  it('switching back to the budget currency clears it on every device', async () => {
    await originate(a, b, 'goals.create', { ...usd(300), categoryId: trip, budgetId });
    const back = await originate(a, b, 'goals.update', {
      ...monthly(280),
      categoryId: trip,
      budgetId,
      effectiveFrom: '2020-01',
    });
    expect(currencies(a)).toEqual([[280_000, null]]);
    expect(goalRows(b)).toEqual(goalRows(a));
    // Its undo brings USD back: format 8.
    expect((await originate(a, b, back.undo[0].op, back.undo[0].args)).format).toBe(8);
    expect(currencies(b)).toEqual([[300_000, 'USD']]);
  });

  it('a new timeframe in another currency leaves earlier months alone', async () => {
    await originate(a, b, 'goals.create', { ...monthly(200), categoryId: trip, budgetId });
    const { format } = await originate(a, b, 'goals.setFrom', {
      ...usd(250),
      categoryId: trip,
      budgetId,
      fromMonth: '2021-06',
    });
    expect(format).toBe(8);
    expect(currencies(b)).toEqual([
      [200_000, null],
      [250_000, 'USD'],
    ]);
    expect(goalRows(b)).toEqual(goalRows(a));
  });

  it('deleting a foreign goal and undoing it restores the currency (format 8)', async () => {
    await originate(a, b, 'goals.create', { ...usd(500), categoryId: trip, budgetId });
    const before = goalRows(a);
    const { undo } = await originate(a, b, 'goals.delete', { categoryId: trip, budgetId });
    expect(goalRows(b)).toEqual([]);
    const formats: number[] = [];
    for (const call of undo) formats.push((await originate(a, b, call.op, call.args)).format);
    expect(formats.every((format) => format === 8)).toBe(true);
    expect(goalRows(a)).toEqual(before);
    expect(goalRows(b)).toEqual(before);
  });

  it('undoing a delete of a budget-currency goal needs no newer format than before', async () => {
    await originate(a, b, 'goals.create', { ...monthly(500), categoryId: trip, budgetId });
    const before = goalRows(a);
    const { undo } = await originate(a, b, 'goals.delete', { categoryId: trip, budgetId });
    const formats: number[] = [];
    for (const call of undo) formats.push((await originate(a, b, call.op, call.args)).format);
    expect(Math.max(...formats)).toBeLessThan(8);
    expect(goalRows(b)).toEqual(before);
  });

  it('an older build’s edit (no currency arg) means a budget-currency target', async () => {
    await originate(a, b, 'goals.create', { ...usd(300), categoryId: trip, budgetId });
    runtime.services = b.services;
    await executeMutationOp(
      'goals.update',
      { ...monthly(310), categoryId: trip, budgetId },
      { mutationId: 'old', isReceiver: true }
    );
    expect(currencies(b)).toEqual([[310_000, null]]);
  });
});
