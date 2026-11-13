import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Two real databases stand in for two devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import {
  materializeDefaultHome,
  reuseHomeCopy,
  stopUsingAsHomeOp,
} from '@pages/custom-dashboards/useDashboardEditor';
import {
  BUILTIN_CARDS,
  builtinKeyOf,
  defaultHomeDashboard,
  defaultWidgetId,
  resolveHomeDashboard,
  visibleFor,
} from '@widgets/dashboard/builtin/builtin-cards';

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

let n = 0;
/** Run an op on `a` as the originating device and replay its JSON args on `b`. */
async function originate(a: Device, b: Device, op: string, args: Record<string, unknown>) {
  runtime.services = a.services;
  const sent = await registry.prepareMutationArgs(op, args);
  n += 1;
  const result = await registry.executeMutationOp(op, sent, {
    mutationId: `m-${n}`,
    isReceiver: false,
  });
  runtime.services = b.services;
  await registry.executeMutationOp(op, JSON.parse(JSON.stringify(sent)), {
    mutationId: `m-${n}`,
    isReceiver: true,
  });
  runtime.services = a.services;
  return result;
}

/** Run an op on one device and apply its undo, the way the undo stack does. */
async function runAndUndo(device: Device, op: string, args: Record<string, unknown>) {
  runtime.services = device.services;
  const spec = registry.getUndoSpec(op);
  const before = spec?.capture ? await spec.capture(args) : undefined;
  const result = await registry.executeMutationOp(op, args, { mutationId: 'x', isReceiver: false });
  const inverse = spec?.build(args, result, before) ?? [];
  return async () => {
    runtime.services = device.services;
    for (const call of inverse) {
      await registry.executeMutationOp(call.op, call.args, { mutationId: 'u', isReceiver: false });
    }
  };
}

const labelOf = (key: keyof typeof BUILTIN_CARDS) => BUILTIN_CARDS[key].label.message ?? key;

describe('home dashboard', () => {
  let a: Device;
  let b: Device;
  let budgetId: number;

  beforeEach(async () => {
    a = await openDevice();
    budgetId = await a.services.budgets.createBudget({
      name: 'Home',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    b = await openDevice(a.adapter.backup() as Uint8Array);
  });

  it('shows the default layout while nothing is stored', () => {
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBeNull();
    const home = defaultHomeDashboard(budgetId, 'Dashboard');
    expect(visibleFor(home.widgets, 'desktop').map(builtinKeyOf)).toEqual([
      'cash_balance',
      'at_a_glance',
      'cashflow_trend',
      'overspent',
      'section_spending',
      'spending_breakdown',
      'spending_overview',
      'section_actions',
      'upcoming',
      'uncategorized',
    ]);
    expect(visibleFor(home.widgets, 'mobile').map(builtinKeyOf)).toEqual([
      'at_a_glance',
      'overspent',
      'cash_balance',
      'spending_tabs',
      'cashflow_trend',
      'upcoming',
      'uncategorized',
    ]);
  });

  it('the first edit stores the default layout on every device, made the home', async () => {
    a.services.customDashboards.createDashboard({ budgetId, name: 'Home' });
    b.services.customDashboards.createDashboard({ budgetId, name: 'Home' });
    const target = await materializeDefaultHome({
      exec: (op, payload) => originate(a, b, op, payload),
      budgetId,
      name: 'Home',
      takenNames: ['Home'],
      labelOf,
    });

    for (const device of [a, b]) {
      const homeId = device.services.customDashboards.getHomeDashboardId(budgetId);
      expect(homeId).toBe(target.dashboardId);
      const stored = device.services.customDashboards.getDashboard(homeId!)!;
      expect(stored.name).toMatch(/^Home ·[0-9a-z]{4}$/);
      expect(stored.origin).toBe('home_default');
      const expected = defaultHomeDashboard(budgetId, '').widgets;
      expect(
        stored.widgets.map((w) => [w.reportId, w.chartId, w.desktopLayout, w.mobileLayout])
      ).toEqual(expected.map((w) => [w.reportId, w.chartId, w.desktopLayout, w.mobileLayout]));
      // Older builds show this title on their "source report is missing" card.
      expect(stored.widgets[0].titleOverride).toBe('Cash Balance');
      expect(visibleFor(stored.widgets, 'mobile').map(builtinKeyOf)).toEqual(
        visibleFor(expected, 'mobile').map(builtinKeyOf)
      );
    }
    // Shown IDs of the default cards map to the stored ones.
    expect(target.widgetId('default:overspent')).toBe(
      a.services.customDashboards
        .getDashboard(target.dashboardId)!
        .widgets.find((w) => w.reportId === 'builtin:overspent')!.id
    );
  });

  it('use as home, use the default home, and undo of both', async () => {
    const first = a.services.customDashboards.createDashboard({ budgetId, name: 'First' });
    const second = a.services.customDashboards.createDashboard({ budgetId, name: 'Second' });

    const undoFirst = await runAndUndo(a, 'customDashboards.update', {
      id: first.id,
      isHome: true,
    });
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBe(first.id);

    const undoSecond = await runAndUndo(a, 'customDashboards.update', {
      id: second.id,
      isHome: true,
    });
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBe(second.id);
    await undoSecond();
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBe(first.id);

    const undoUnset = await runAndUndo(a, 'customDashboards.update', {
      id: first.id,
      isHome: false,
    });
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBeNull();
    await undoUnset();
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBe(first.id);

    await undoFirst();
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBeNull();
    // A home-only update leaves the name alone.
    expect(a.services.customDashboards.getDashboard(first.id)?.name).toBe('First');
  });

  it('deleting the home falls back to the default; undo brings it back as home', async () => {
    const target = await materializeDefaultHome({
      exec: (op, payload) => originate(a, b, op, payload),
      budgetId,
      name: 'Home',
      takenNames: [],
      labelOf,
    });
    const undo = await runAndUndo(a, 'customDashboards.delete', { id: target.dashboardId });
    expect(a.services.customDashboards.getHomeDashboardId(budgetId)).toBeNull();
    await undo();
    const restored = a.services.customDashboards.getDashboard(target.dashboardId)!;
    expect(restored.isHome).toBe(true);
    expect(restored.origin).toBe('home_default');
    expect(restored.widgets).toHaveLength(defaultHomeDashboard(budgetId, '').widgets.length);
    expect(
      restored.widgets.find((w) => w.reportId === 'builtin:spending_tabs')?.desktopLayout
    ).toEqual({ colSpan: 12, rowSpan: 3, hidden: true });
  });

  it('a built-in card on a dashboard that is not the home', async () => {
    const dashboard = (await originate(a, b, 'customDashboards.create', {
      budgetId,
      name: 'Travel',
    })) as { id: string };
    await originate(a, b, 'customDashboardWidgets.add', {
      dashboardId: dashboard.id,
      reportId: 'builtin:cash_balance',
      chartId: 'builtin',
      desktopLayout: { colSpan: 12, rowSpan: 3 },
      mobileLayout: { size: 'm' },
      titleOverride: 'Cash Balance',
    });
    for (const device of [a, b]) {
      expect(device.services.customDashboards.getHomeDashboardId(budgetId)).toBeNull();
      const stored = device.services.customDashboards.getDashboard(dashboard.id)!;
      expect(stored.widgets.map(builtinKeyOf)).toEqual(['cash_balance']);
    }
  });

  it('undoing a widget edit restores phone order and visibility it did not have', async () => {
    const dashboard = a.services.customDashboards.createDashboard({ budgetId, name: 'D' });
    const widget = a.services.customDashboards.addWidget({
      dashboardId: dashboard.id,
      reportId: 'builtin:overspent',
      chartId: 'builtin',
    }).widgets[0];
    const undo = await runAndUndo(a, 'customDashboardWidgets.update', {
      id: widget.id,
      mobileLayout: { size: 'm', order: 4, hidden: true },
    });
    expect(a.services.customDashboards.getWidgetById(widget.id)?.mobileLayout).toEqual({
      size: 'm',
      order: 4,
      hidden: true,
    });
    await undo();
    expect(a.services.customDashboards.getWidgetById(widget.id)?.mobileLayout).toEqual({
      size: 'm',
    });
  });

  it('stop using a dashboard as home: the customised home comes back, and Customize edits it', async () => {
    const exec = (op: string, payload: Record<string, unknown>) => originate(a, b, op, payload);
    const copy = await materializeDefaultHome({
      exec,
      budgetId,
      name: 'Home',
      takenNames: [],
      labelOf,
    });
    // Customise: drop the cash balance card from the stored home.
    await exec('customDashboardWidgets.delete', {
      id: copy.widgetId(defaultWidgetId('cash_balance')),
    });
    const travel = (await exec('customDashboards.create', { budgetId, name: 'Travel' })) as {
      id: string;
    };
    await exec('customDashboards.update', { id: travel.id, isHome: true });
    expect(resolveHomeDashboard(a.services.customDashboards.getDashboards(budgetId))?.id).toBe(
      travel.id
    );

    const call = stopUsingAsHomeOp(travel.id, a.services.customDashboards.getDashboards(budgetId));
    await exec(call.op, call.args);
    for (const device of [a, b]) {
      const dashboards = device.services.customDashboards.getDashboards(budgetId);
      // Home is the customised copy again (not the pristine default), on both devices.
      expect(device.services.customDashboards.getHomeDashboardId(budgetId)).toBe(copy.dashboardId);
      expect(resolveHomeDashboard(dashboards)?.id).toBe(copy.dashboardId);
      const shown = device.services.customDashboards.getDashboard(copy.dashboardId)!;
      expect(shown.widgets.some((w) => w.reportId === 'builtin:cash_balance')).toBe(false);
    }
    // No second copy was made.
    expect(
      a.services.customDashboards.getDashboards(budgetId).filter((d) => d.origin === 'home_default')
    ).toHaveLength(1);
  });

  it('a left-over customised home is reused by the next edit of the default view', async () => {
    const exec = (op: string, payload: Record<string, unknown>) => originate(a, b, op, payload);
    const copy = await materializeDefaultHome({
      exec,
      budgetId,
      name: 'Home',
      takenNames: [],
      labelOf,
    });
    await exec('customDashboards.update', { id: copy.dashboardId, isHome: false });
    // Home resolves to the copy even when it isn't flagged.
    expect(resolveHomeDashboard(a.services.customDashboards.getDashboards(budgetId))?.id).toBe(
      copy.dashboardId
    );
    const stored = a.services.customDashboards.getDashboard(copy.dashboardId)!;
    const target = await reuseHomeCopy(exec, stored);
    await exec('customDashboardWidgets.delete', {
      id: target.widgetId(defaultWidgetId('overspent')),
    });
    for (const device of [a, b]) {
      expect(device.services.customDashboards.getHomeDashboardId(budgetId)).toBe(copy.dashboardId);
      const widgets = device.services.customDashboards.getDashboard(copy.dashboardId)!.widgets;
      expect(widgets.some((w) => w.reportId === 'builtin:overspent')).toBe(false);
      expect(widgets).toHaveLength(defaultHomeDashboard(budgetId, '').widgets.length - 1);
    }
  });

  it('without a customised home, stopping a dashboard as home gives the pristine default', async () => {
    const exec = (op: string, payload: Record<string, unknown>) => originate(a, b, op, payload);
    const travel = (await exec('customDashboards.create', { budgetId, name: 'Travel' })) as {
      id: string;
    };
    await exec('customDashboards.update', { id: travel.id, isHome: true });
    const call = stopUsingAsHomeOp(travel.id, a.services.customDashboards.getDashboards(budgetId));
    expect(call.args).toEqual({ id: travel.id, isHome: false });
    await exec(call.op, call.args);
    for (const device of [a, b]) {
      expect(
        resolveHomeDashboard(device.services.customDashboards.getDashboards(budgetId))
      ).toBeNull();
    }
    // Reset deletes the copies, after which home is the pristine default too.
    const copy = await materializeDefaultHome({
      exec,
      budgetId,
      name: 'Home',
      takenNames: ['Travel'],
      labelOf,
    });
    await exec('customDashboards.delete', { id: copy.dashboardId });
    expect(resolveHomeDashboard(a.services.customDashboards.getDashboards(budgetId))).toBeNull();
  });
});
