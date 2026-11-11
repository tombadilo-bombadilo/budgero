import { resolve } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// A real database stands in for the device; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import { defaultHomeDashboard } from '@widgets/dashboard/builtin/builtin-cards';
import { useDashboardEditor } from './useDashboardEditor';

const runtime = vi.hoisted(() => ({
  services: undefined as Services | undefined,
  executed: [] as string[],
}));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    services: () => runtime.services,
    mutationsRouter: () => ({
      execute: async ({ op, payload }: { op: string; payload: Record<string, unknown> }) => {
        // Let other work interleave between ops, as the real router does.
        await new Promise((done) => setTimeout(done, 0));
        const args = await registry.prepareMutationArgs(op, payload);
        runtime.executed.push(op);
        const result = await registry.executeMutationOp(op, args, {
          mutationId: `m${runtime.executed.length}`,
          isReceiver: false,
        });
        return { result };
      },
    }),
  }),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

async function openDevice() {
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

describe('first edit of the default home', () => {
  it('two quick edits store the default once and both apply', async () => {
    const device = await openDevice();
    runtime.services = device.services;
    const budgetId = await device.services.budgets.createBudget({
      name: 'Double',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const home = defaultHomeDashboard(budgetId, '');
    const { result } = renderHook(() =>
      useDashboardEditor({
        dashboard: home,
        budgetId,
        platform: 'desktop',
        dashboards: [],
        claimHome: true,
      })
    );

    let pending!: Promise<unknown>;
    act(() => {
      // Double click: both handlers run against the same (default) render.
      pending = Promise.all([
        result.current.updateDesktopLayout('default:cashflow_trend', { colSpan: 9 }),
        result.current.remove('default:overspent'),
      ]);
    });
    // While the default is being stored the view keeps showing the default.
    expect(result.current.materializing).toBe(true);
    await act(async () => {
      await pending;
    });
    expect(result.current.materializing).toBe(false);

    const rows = device.adapter.exec(
      `SELECT ID, Origin FROM custom_dashboards WHERE BudgetID = ${budgetId}`
    ) as { values: unknown[][] }[];
    expect(rows[0].values).toHaveLength(1);
    expect(rows[0].values[0][1]).toBe('home_default');
    const stored = device.services.customDashboards.getDashboard(String(rows[0].values[0][0]))!;
    expect(
      stored.widgets.find((w) => w.reportId === 'builtin:cashflow_trend')?.desktopLayout
    ).toEqual({ colSpan: 9, rowSpan: 3 });
    expect(stored.widgets.some((w) => w.reportId === 'builtin:overspent')).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });
});
