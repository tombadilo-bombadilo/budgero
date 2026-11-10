import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Real databases stand in for devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
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

/** Runs an op on its own device (offline) and records what it would sync. */
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

/** Applies synced ops as a receiver, counting any that fail to apply. */
async function receive(device: Device, calls: Call[], strip: string[] = []) {
  runtime.services = device.services;
  for (const call of calls) {
    const args = { ...call.args };
    for (const key of strip) delete args[key];
    try {
      await registry.executeMutationOp(call.op, JSON.parse(JSON.stringify(args)), {
        mutationId: call.id,
        isReceiver: true,
      });
    } catch (error) {
      device.failures.push(
        `${device.name} ${call.op} ${JSON.stringify(args).slice(0, 160)}: ${(error as Error).message}`
      );
    }
  }
}

const labelOf = (key: keyof typeof BUILTIN_CARDS) => BUILTIN_CARDS[key].label.message ?? key;

/** What the home page shows on a device, without device-local IDs. */
function homeContent(device: Device, budgetId: number) {
  const dashboards = device.services.customDashboards.getDashboards(budgetId);
  const home = resolveHomeDashboard(dashboards);
  if (!home) return { home: 'default' as const };
  const stored = device.services.customDashboards.getDashboard(home.id)!;
  return {
    home: 'stored' as const,
    copies: dashboards.filter((d) => d.origin === 'home_default').length,
    flagged: device.services.customDashboards.getHomeDashboardId(budgetId) === home.id,
    widgets: stored.widgets.map((w) => ({
      card: builtinKeyOf(w) ?? `${w.reportId}/${w.id}`,
      desktop: w.desktopLayout,
      mobile: w.mobileLayout,
    })),
  };
}

describe('two devices customise the default home before syncing', () => {
  let base: Uint8Array;
  let budgetId: number;

  beforeEach(async () => {
    const seed = await openDevice('seed');
    budgetId = await seed.services.budgets.createBudget({
      name: 'Race',
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

  /** A removes a card, B adds a question: each on its own copy, offline. */
  async function customiseOffline() {
    const a = await openDevice('A', base);
    const b = await openDevice('B', base);
    const aOps: Call[] = [];
    const bOps: Call[] = [];
    const aHome = await materializeDefaultHome({
      exec: (op, payload) => local(a, aOps, op, payload),
      budgetId,
      name: 'Home',
      takenNames: [],
      labelOf,
    });
    await local(a, aOps, 'customDashboardWidgets.delete', {
      id: aHome.widgetId(defaultWidgetId('cash_balance')),
    });
    const bHome = await materializeDefaultHome({
      exec: (op, payload) => local(b, bOps, op, payload),
      budgetId,
      name: 'Home',
      takenNames: [],
      labelOf,
    });
    await local(b, bOps, 'customDashboardWidgets.add', {
      id: 'question-widget',
      dashboardId: bHome.dashboardId,
      reportId: 'report-1',
      chartId: 'chart-1',
    });
    return { a, b, aOps, bOps };
  }

  for (const order of ['A first', 'B first'] as const) {
    it(`converges with both edits, one home and no failed op (${order} on the server)`, async () => {
      const { a, b, aOps, bOps } = await customiseOffline();
      const server = order === 'A first' ? [...aOps, ...bOps] : [...bOps, ...aOps];
      await receive(a, bOps);
      await receive(b, aOps);
      const c = await openDevice('C', base);
      await receive(c, server);

      for (const device of [a, b, c]) expect(device.failures).toEqual([]);
      const expected = homeContent(c, budgetId);
      expect(homeContent(a, budgetId)).toEqual(expected);
      expect(homeContent(b, budgetId)).toEqual(expected);
      expect(expected).toMatchObject({ home: 'stored', copies: 1, flagged: true });
      const cards = (expected as { widgets: { card: string }[] }).widgets.map((w) => w.card);
      expect(cards).not.toContain('cash_balance');
      expect(cards).toContain('report-1/question-widget');
      expect(cards.filter((card) => card === 'at_a_glance')).toHaveLength(1);

      // A build without home copies (v1.20) applies every op as given: it
      // ignores origin/isHome, keeps two dashboards, and nothing fails.
      const old = await openDevice('v1.20', base);
      await receive(old, server, ['origin', 'isHome']);
      expect(old.failures).toEqual([]);
      expect(old.services.customDashboards.getDashboards(budgetId)).toHaveLength(2);
    });
  }

  it('later edits from either device still reach the merged home', async () => {
    const { a, b, aOps, bOps } = await customiseOffline();
    await receive(a, bOps);
    await receive(b, aOps);
    // Each device edits by the IDs it knows: B resizes its cashflow card,
    // A hides the overspent card on the phone.
    const bHomeId = bOps[0].args.id as string;
    const aHomeId = aOps[0].args.id as string;
    const later: Call[] = [];
    const bLater: Call[] = [];
    await local(b, bLater, 'customDashboardWidgets.update', {
      id: `${bHomeId}:cashflow_trend`,
      dashboardId: bHomeId,
      desktopLayout: { colSpan: 12, rowSpan: 3 },
    });
    await local(a, later, 'customDashboardWidgets.update', {
      id: `${aHomeId}:overspent`,
      dashboardId: aHomeId,
      mobileLayout: { size: 'm', hidden: true },
    });
    await receive(a, bLater);
    await receive(b, later);
    for (const device of [a, b]) expect(device.failures).toEqual([]);
    expect(homeContent(a, budgetId)).toEqual(homeContent(b, budgetId));
    const widgets = (
      homeContent(a, budgetId) as { widgets: { card: string; desktop: unknown; mobile: unknown }[] }
    ).widgets;
    expect(widgets.find((w) => w.card === 'cashflow_trend')?.desktop).toEqual({
      colSpan: 12,
      rowSpan: 3,
    });
    expect(widgets.find((w) => w.card === 'overspent')?.mobile).toMatchObject({ hidden: true });
  });

  it('reset then customise again: no clash with the old copy, its sync history or undo', async () => {
    const { a, b, aOps, bOps } = await customiseOffline();
    await receive(a, bOps);
    await receive(b, aOps);

    // A resets (removes the customised home) and customises again.
    runtime.services = a.services;
    const resetOps: Call[] = [];
    const copyId = resolveHomeDashboard(a.services.customDashboards.getDashboards(budgetId))!.id;
    const resetSpec = registry.getUndoSpec('customDashboards.delete')!;
    const before = await resetSpec.capture!({ id: copyId });
    await local(a, resetOps, 'customDashboards.delete', { id: copyId });
    expect(homeContent(a, budgetId)).toEqual({ home: 'default' });
    const fresh = await materializeDefaultHome({
      exec: (op, payload) => local(a, resetOps, op, payload),
      budgetId,
      name: 'Home',
      takenNames: [],
      labelOf,
    });
    await local(a, resetOps, 'customDashboardWidgets.delete', {
      id: fresh.widgetId(defaultWidgetId('overspent')),
    });
    await receive(b, resetOps);
    const c = await openDevice('C', base);
    await receive(c, [...aOps, ...bOps, ...resetOps]);
    for (const device of [a, b, c]) expect(device.failures).toEqual([]);
    const expected = homeContent(c, budgetId);
    expect(homeContent(a, budgetId)).toEqual(expected);
    expect(homeContent(b, budgetId)).toEqual(expected);
    const cards = (expected as { widgets: { card: string }[] }).widgets.map((w) => w.card);
    // The new copy starts from the default: the old edits are gone, the new one holds.
    expect(cards).toContain('cash_balance');
    expect(cards).not.toContain('overspent');
    expect(cards).not.toContain('report-1/question-widget');

    // Undo of the reset while the new copy exists (e.g. replayed out of order):
    // the old copy comes back hidden behind the new one, nothing collides.
    const undoOps: Call[] = [];
    for (const call of resetSpec.build({ id: copyId }, undefined, before)) {
      await local(a, undoOps, call.op, call.args);
    }
    await receive(b, undoOps);
    await receive(c, undoOps);
    for (const device of [a, b, c]) expect(device.failures).toEqual([]);
    expect(homeContent(a, budgetId)).toEqual(homeContent(c, budgetId));
    expect(homeContent(b, budgetId)).toEqual(homeContent(c, budgetId));
    expect(homeContent(c, budgetId)).toMatchObject({ copies: 1 });

    const old = await openDevice('v1.20', base);
    await receive(old, [...aOps, ...bOps, ...resetOps, ...undoOps], ['origin', 'isHome']);
    expect(old.failures).toEqual([]);
  });
});
