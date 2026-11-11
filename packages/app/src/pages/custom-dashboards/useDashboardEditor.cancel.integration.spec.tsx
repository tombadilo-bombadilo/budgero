import { resolve } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// A real database stands in for the device; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { defaultHomeDashboard } from '@widgets/dashboard/builtin/builtin-cards';
import { useDashboardEditor } from './useDashboardEditor';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined, n: 0 }));

/** The router as it behaves for these ops: run, then push the inverse as an undo entry. */
async function execute(spec: {
  op: string;
  payload: Record<string, unknown>;
  meta?: { skipUndo?: boolean };
}) {
  const args = await registry.prepareMutationArgs(spec.op, spec.payload);
  const undoSpec = registry.getUndoSpec(spec.op);
  const before = undoSpec?.capture ? await undoSpec.capture(args) : undefined;
  runtime.n += 1;
  const result = await registry.executeMutationOp(spec.op, args, {
    mutationId: `m${runtime.n}`,
    isReceiver: false,
  });
  const inverse = undoSpec?.build(args, result, before) ?? [];
  if (!spec.meta?.skipUndo && inverse.length) {
    useUndoStore.getState().push({
      id: `m${runtime.n}`,
      undo: inverse,
      redo: [{ op: spec.op, args }],
      ts: Date.now(),
    });
  }
  return { result };
}

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services, mutationsRouter: () => ({ execute }) }),
}));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({ services: () => runtime.services, mutationsRouter: () => ({ execute }) }),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

async function openDevice() {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    return manager.getServices();
  } finally {
    cwd.mockRestore();
  }
}

describe('Cancel in dashboard edit mode', () => {
  it('undoes the edits of this session only, including storing the default home', async () => {
    runtime.services = await openDevice();
    const services = runtime.services;
    useUndoStore.getState().clear();
    const budgetId = await services.budgets.createBudget({
      name: 'Cancel',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    // A change made before editing started: Cancel must leave it alone.
    await execute({ op: 'customDashboards.create', payload: { budgetId, name: 'Travel' } });
    const before = useUndoStore.getState().past.length;

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
    act(() => result.current.beginSession());
    await act(async () => {
      await result.current.remove('default:overspent');
    });
    await act(async () => {
      await result.current.updateDesktopLayout('default:cashflow_trend', { colSpan: 9 });
    });
    expect(services.customDashboards.getDashboards(budgetId).map((d) => d.origin)).toContain(
      'home_default'
    );

    await act(async () => {
      await result.current.cancelSession();
    });
    expect(services.customDashboards.getDashboards(budgetId).map((d) => d.name)).toEqual([
      'Travel',
    ]);
    expect(useUndoStore.getState().past).toHaveLength(before);
    expect(toastError).not.toHaveBeenCalled();
  });
});
