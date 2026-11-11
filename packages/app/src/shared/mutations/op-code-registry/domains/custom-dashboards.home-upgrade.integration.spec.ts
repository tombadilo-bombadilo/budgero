import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Real databases stand in for devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { migrations, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import { materializeDefaultHome } from '@pages/custom-dashboards/useDashboardEditor';
import {
  BUILTIN_CARDS,
  builtinKeyOf,
  defaultWidgetId,
  resolveHomeDashboard,
} from '@widgets/dashboard/builtin/builtin-cards';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Call = { op: string; args: Record<string, unknown>; id: string };
type Device = { name: string; services: Services; adapter: NodeSqlJsAdapter; failures: string[] };

async function openDevice(name: string, bytes?: Uint8Array): Promise<Device> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const adapter = await NodeSqlJsAdapter.create(bytes);
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    return { name, adapter, services: manager.getServices(), failures: [] };
  } finally {
    cwd.mockRestore();
  }
}

let seq = 0;
async function local(device: Device, log: Call[], op: string, args: Record<string, unknown>) {
  runtime.services = device.services;
  const sent = await registry.prepareMutationArgs(op, args);
  seq += 1;
  const call = {
    op,
    args: JSON.parse(JSON.stringify(sent)) as Record<string, unknown>,
    id: `m${seq}`,
  };
  const result = await registry.executeMutationOp(op, sent, {
    mutationId: call.id,
    isReceiver: false,
  });
  log.push(call);
  return result;
}

async function receive(device: Device, calls: Call[]) {
  runtime.services = device.services;
  for (const call of calls) {
    try {
      await registry.executeMutationOp(call.op, JSON.parse(JSON.stringify(call.args)), {
        mutationId: call.id,
        isReceiver: true,
      });
    } catch (error) {
      device.failures.push(`${device.name} ${call.op}: ${(error as Error).message}`);
    }
  }
}

/**
 * A device on v1.20.8: its handlers ignore origin / isHome / seed, and it
 * records each received op's payload (as sent) in its mutation history.
 */
async function receiveOnOldBuild(device: Device, budgetId: number, calls: Call[]) {
  runtime.services = device.services;
  for (const call of calls) {
    const { origin: _o, isHome: _h, seed: _s, ...args } = call.args;
    try {
      await registry.executeMutationOp(call.op, args, { mutationId: call.id, isReceiver: true });
      device.services.mutationHistory.record({
        budgetId,
        spaceId: '',
        mutationId: call.id,
        userId: null,
        op: call.op,
        payload: call.args,
        origin: 'remote',
        undoOps: null,
        redoOps: null,
      });
    } catch (error) {
      device.failures.push(`${device.name} ${call.op}: ${(error as Error).message}`);
    }
  }
}

/** Updating the app: the migrations this build adds run on the old database. */
function upgrade(device: Device) {
  const db = {
    exec: (sql: string) => device.adapter.exec(sql) as { columns: string[]; values: unknown[][] }[],
    prepare: () => {
      throw new Error('not used');
    },
  };
  for (const migration of migrations.filter((m) => m.version >= 77)) {
    if (typeof migration.up === 'function') migration.up(db as never);
  }
}

const labelOf = (key: keyof typeof BUILTIN_CARDS) => BUILTIN_CARDS[key].label.message ?? key;

/** An edit on the home page, the way the editor does it (stores the default first if needed). */
async function editHome(
  device: Device,
  log: Call[],
  budgetId: number,
  edit: (target: { dashboardId: string; widgetId: (id: string) => string }) => Promise<void>
) {
  runtime.services = device.services;
  const home = resolveHomeDashboard(device.services.customDashboards.getDashboards(budgetId));
  if (home) {
    await edit({ dashboardId: home.id, widgetId: (id) => id.replace('default:', `${home.id}:`) });
    return;
  }
  const target = await materializeDefaultHome({
    exec: (op, payload) => local(device, log, op, payload),
    budgetId,
    name: 'Home',
    takenNames: device.services.customDashboards.getDashboards(budgetId).map((d) => d.name),
    labelOf,
  });
  await edit(target);
}

function homeContent(device: Device, budgetId: number) {
  const dashboards = device.services.customDashboards.getDashboards(budgetId);
  const home = resolveHomeDashboard(dashboards);
  if (!home) return { home: 'default' };
  const flagged = device.services.customDashboards.getHomeDashboardId(budgetId);
  return {
    home: home.origin === 'home_default' ? 'copy' : home.name,
    copies: dashboards.filter((d) => d.origin === 'home_default').length,
    flagged: flagged ? (dashboards.find((d) => d.id === flagged)?.origin ?? 'custom') : null,
    cards: device.services.customDashboards
      .getDashboard(home.id)!
      .widgets.map((w) => builtinKeyOf(w) ?? `${w.reportId}/${w.id}`),
  };
}

describe('a device that was on v1.20.8 while the home was customised', () => {
  let base: Uint8Array;
  let budgetId: number;

  beforeEach(async () => {
    const seed = await openDevice('seed');
    budgetId = await seed.services.budgets.createBudget({
      name: 'Upgrade',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    seed.services.reports.saveReport({
      id: 'report-1',
      name: 'Spending',
      query: 'SELECT 1',
      charts: [
        {
          id: 'chart-1',
          chartType: 'bar',
          xAxisColumn: 'm',
          yAxisColumn: 'a',
          aggregateFunction: 'SUM',
        },
      ],
    });
    base = seed.adapter.backup() as Uint8Array;
  });

  async function customise(device: Device, log: Call[], removeKey: string, questionId: string) {
    await editHome(device, log, budgetId, async (target) => {
      await local(device, log, 'customDashboardWidgets.delete', {
        id: target.widgetId(defaultWidgetId(removeKey as 'cash_balance')),
      });
      await local(device, log, 'customDashboardWidgets.add', {
        id: questionId,
        dashboardId: target.dashboardId,
        reportId: 'report-1',
        chartId: 'chart-1',
      });
    });
  }

  it('adopts the customised home after updating, and later edits stay in step', async () => {
    const a = await openDevice('A', base);
    const c = await openDevice('C', base);
    const aOps: Call[] = [];
    await customise(a, aOps, 'cash_balance', 'qA');
    await receiveOnOldBuild(c, budgetId, aOps);
    upgrade(c);
    expect(homeContent(c, budgetId)).toEqual(homeContent(a, budgetId));

    const cOps: Call[] = [];
    await editHome(c, cOps, budgetId, async (target) => {
      await local(c, cOps, 'customDashboardWidgets.delete', {
        id: target.widgetId(defaultWidgetId('upcoming')),
      });
    });
    await receive(a, cOps);
    for (const device of [a, c]) expect(device.failures).toEqual([]);
    expect(homeContent(c, budgetId)).toEqual(homeContent(a, budgetId));
    expect(homeContent(a, budgetId)).toMatchObject({ home: 'copy', copies: 1 });
    expect((homeContent(a, budgetId) as { cards: string[] }).cards).not.toContain('upcoming');
  });

  for (const order of ['A first', 'B first'] as const) {
    it(`two copies made by two devices merge the same way after updating (${order})`, async () => {
      const a = await openDevice('A', base);
      const b = await openDevice('B', base);
      const aOps: Call[] = [];
      const bOps: Call[] = [];
      await customise(a, aOps, 'cash_balance', 'qA');
      await customise(b, bOps, 'overspent', 'qB');
      const server = order === 'A first' ? [...aOps, ...bOps] : [...bOps, ...aOps];
      // A new-build device that saw the same order, and the old one.
      const n = await openDevice('N', base);
      await receive(n, server);
      const c = await openDevice('C', base);
      await receiveOnOldBuild(c, budgetId, server);
      upgrade(c);
      for (const device of [n, c]) expect(device.failures).toEqual([]);
      expect(homeContent(c, budgetId)).toEqual(homeContent(n, budgetId));
      const { cards } = homeContent(c, budgetId) as { cards: string[] };
      expect(cards).not.toContain('cash_balance');
      expect(cards).not.toContain('overspent');
      expect(cards).toEqual(expect.arrayContaining(['report-1/qA', 'report-1/qB']));

      // After updating, C's edits by its IDs reach A and B, and theirs reach C.
      await receive(a, bOps);
      await receive(b, aOps);
      const cOps: Call[] = [];
      await editHome(c, cOps, budgetId, async (target) => {
        await local(c, cOps, 'customDashboardWidgets.delete', {
          id: target.widgetId(defaultWidgetId('upcoming')),
        });
      });
      await receive(a, cOps);
      await receive(b, cOps);
      await receive(n, cOps);
      for (const device of [a, b, c, n]) expect(device.failures).toEqual([]);
      const expected = homeContent(n, budgetId);
      // C saw the server order, like N: identical, order included.
      expect(homeContent(c, budgetId)).toEqual(expected);
      // A and B each added their own question before seeing the other's, so
      // the two questions sit in arrival order there (no rebase); same cards.
      const sorted = (content: ReturnType<typeof homeContent>) => ({
        ...content,
        cards: [...((content as { cards: string[] }).cards ?? [])].sort(),
      });
      for (const device of [a, b])
        expect(sorted(homeContent(device, budgetId))).toEqual(sorted(expected));
    });
  }

  it('a custom dashboard set as home on another device stays home after updating', async () => {
    const a = await openDevice('A', base);
    const c = await openDevice('C', base);
    const aOps: Call[] = [];
    await customise(a, aOps, 'cash_balance', 'qA');
    const travel = (await local(a, aOps, 'customDashboards.create', {
      budgetId,
      name: 'Travel',
    })) as {
      id: string;
    };
    await local(a, aOps, 'customDashboards.update', { id: travel.id, isHome: true });
    await receiveOnOldBuild(c, budgetId, aOps);
    upgrade(c);
    expect(homeContent(c, budgetId)).toEqual(homeContent(a, budgetId));
    expect(homeContent(c, budgetId)).toMatchObject({ home: 'Travel', flagged: 'custom' });
  });

  it('without the history (pruned), the copy is still adopted; the home choice is not recoverable', async () => {
    const a = await openDevice('A', base);
    const c = await openDevice('C', base);
    const aOps: Call[] = [];
    await customise(a, aOps, 'cash_balance', 'qA');
    const travel = (await local(a, aOps, 'customDashboards.create', {
      budgetId,
      name: 'Travel',
    })) as {
      id: string;
    };
    await local(a, aOps, 'customDashboards.update', { id: travel.id, isHome: true });
    await receiveOnOldBuild(c, budgetId, aOps);
    c.adapter.exec('DELETE FROM mutation_history');
    upgrade(c);
    expect(homeContent(c, budgetId)).toMatchObject({
      home: 'copy',
      copies: 1,
      flagged: 'home_default',
    });
  });

  it('the repair runs once: a second run changes nothing', async () => {
    const a = await openDevice('A', base);
    const c = await openDevice('C', base);
    const aOps: Call[] = [];
    await customise(a, aOps, 'cash_balance', 'qA');
    await receiveOnOldBuild(c, budgetId, aOps);
    upgrade(c);
    const once = homeContent(c, budgetId);
    upgrade(c);
    expect(homeContent(c, budgetId)).toEqual(once);
  });
});
