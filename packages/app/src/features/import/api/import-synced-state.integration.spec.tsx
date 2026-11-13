import type { ReactNode } from 'react';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
// Real databases stand in for devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import type { ImportTemplate } from '@features/import/model/types';
import {
  LEGACY_TEMPLATES_STORAGE_KEY,
  resetImportTemplatesForTests,
  useImportTemplates,
} from '../ui/csv-pdf-dialog/useImportTemplates';
import {
  rememberRoutes,
  resetRememberedRoutesForTests,
  useRememberedRoutes,
} from './useRememberedRoutes';

type Call = { op: string; args: Record<string, unknown> };

/** One device with one workspace open; `sent` is what it would sync. */
interface Device {
  services: Services;
  spaceId: string;
  sent: Call[];
}

const env = vi.hoisted(() => ({
  device: null as null | { services: unknown; spaceId: string; sent: Call[] },
  client: null as null | { invalidateQueries: (filter: { queryKey: unknown[] }) => unknown },
}));

const runtime = {
  services: () => env.device?.services,
  getActiveSpaceId: () => env.device?.spaceId ?? null,
  isInitialized: () => true,
  executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
    const device = env.device!;
    const args = await registry.prepareMutationArgs(spec.op, spec.payload);
    await registry.executeMutationOp(spec.op, args, { mutationId: 'local', isReceiver: false });
    device.sent.push({ op: spec.op, args: JSON.parse(JSON.stringify(args)) });
    await env.client?.invalidateQueries({ queryKey: ['syncedState'] });
    return { result: undefined };
  },
};

vi.mock('@shared/runtime/global', () => ({ getRuntime: () => runtime }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
  useRuntimeInitialized: () => true,
  useRuntimeState: () => 'Ready',
  useActiveSpaceId: () => env.device?.spaceId ?? null,
}));

async function openDevice(spaceId = 'space-a'): Promise<Device> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const manager = new ServiceManager();
    await manager.initialize(await NodeSqlJsAdapter.create());
    return { services: manager.getServices(), spaceId, sent: [] };
  } finally {
    cwd.mockRestore();
  }
}

/** Makes `device` the open one, with a fresh query cache (as after opening the app). */
function openOn(device: Device) {
  env.device = device as typeof env.device;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  env.client = client;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return wrapper;
}

/** Delivers everything `from` sent since the last sync to `to`. */
async function sync(from: Device, to: Device) {
  env.device = to as typeof env.device;
  for (const call of from.sent.splice(0)) {
    await registry.executeMutationOp(call.op, call.args, { mutationId: 'r', isReceiver: true });
  }
}

function renderRoutes(device: Device, budgetId = 1) {
  return renderHook(() => useRememberedRoutes(budgetId), { wrapper: openOn(device) });
}

function renderTemplates(device: Device) {
  return renderHook(() => useImportTemplates(vi.fn(), vi.fn()), { wrapper: openOn(device) });
}

const template = (name: string): Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt'> => ({
  name,
  columnMapping: { date: 'Date', amount: 'Amount' },
  numberFormat: 'standard',
  dateFormat: 'YYYY-MM-DD',
});

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  resetRememberedRoutesForTests();
  resetImportTemplatesForTests();
});
afterEach(() => {
  cleanup();
  env.device = null;
  env.client = null;
});

describe('remembered import routes across devices', () => {
  it('pre-selects on B the account picked on A', async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const onA = renderRoutes(a);
    await waitFor(() => expect(onA.result.current).toEqual({}));
    await act(async () => {
      expect(await rememberRoutes(1, { 'DE89 3704 0044': 7 })).toBe(true);
    });
    await waitFor(() => expect(onA.result.current).toEqual({ 'DE89 3704 0044': 7 }));
    onA.unmount();

    await sync(a, b);
    const onB = renderRoutes(b);
    await waitFor(() => expect(onB.result.current).toEqual({ 'DE89 3704 0044': 7 }));
  });

  it('waits for the synced state before reporting routes', () => {
    const device = { services: undefined, spaceId: 'space-a', sent: [] } as unknown as Device;
    const { result } = renderRoutes(device);
    // Not loaded yet: null, so the configure step doesn't plan without it.
    expect(result.current).toBeNull();
  });

  it("moves this device's old choices in once, adds only what is new, and clears the old keys", async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    renderRoutes(a);
    await act(async () => {
      await rememberRoutes(1, { 'IBAN-X': 2 });
    });
    cleanup();
    await sync(a, b);

    localStorage.setItem(
      'budgero:import-account-routes:space-a:1',
      JSON.stringify({ 'IBAN-X': 9, 'IBAN-Y': 3 })
    );
    localStorage.setItem('budgero:import-account-routes:1', '{"IBAN-Z":4}');
    const onB = renderRoutes(b);
    await waitFor(() => expect(onB.result.current).toEqual({ 'IBAN-X': 2, 'IBAN-Y': 3 }));
    expect(b.sent).toHaveLength(1);
    expect(localStorage.getItem('budgero:import-account-routes:space-a:1')).toBeNull();
    expect(localStorage.getItem('budgero:import-account-routes:1')).toBeNull();

    // Opening again writes nothing more.
    onB.unmount();
    resetRememberedRoutesForTests();
    const again = renderRoutes(b);
    await waitFor(() => expect(again.result.current).toEqual({ 'IBAN-X': 2, 'IBAN-Y': 3 }));
    expect(b.sent).toHaveLength(1);
  });

  it('keeps two workspaces apart, even for budgets with the same id', async () => {
    const [first, second] = [await openDevice('space-a'), await openDevice('space-b')];
    localStorage.setItem('budgero:import-account-routes:space-b:1', '{"IBAN-B":5}');
    const onFirst = renderRoutes(first);
    await waitFor(() => expect(onFirst.result.current).toEqual({}));
    await act(async () => {
      await rememberRoutes(1, { 'IBAN-A': 2 });
    });
    await waitFor(() => expect(onFirst.result.current).toEqual({ 'IBAN-A': 2 }));
    // The other workspace's old choices stay on the device until it is opened.
    expect(localStorage.getItem('budgero:import-account-routes:space-b:1')).not.toBeNull();
    cleanup();

    const onSecond = renderRoutes(second);
    await waitFor(() => expect(onSecond.result.current).toEqual({ 'IBAN-B': 5 }));
  });

  it('writes nothing in the demo workspace', async () => {
    const demo = await openDevice('demo-space');
    setDemoSpaceId('demo-space');
    localStorage.setItem('budgero:import-account-routes:demo-space:1', '{"IBAN-X":2}');
    const { result } = renderRoutes(demo);
    await waitFor(() => expect(result.current).toEqual({}));
    await act(async () => {
      expect(await rememberRoutes(1, { 'IBAN-Y': 1 })).toBe(false);
    });
    expect(demo.sent).toEqual([]);
  });
});

describe('import templates across devices', () => {
  it('keeps templates saved on A and B on both, and syncs a delete', async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const onA = renderTemplates(a);
    await waitFor(() => expect(onA.result.current.canEditTemplates).toBe(true));
    let fromA: ImportTemplate | null = null;
    await act(async () => {
      fromA = await onA.result.current.saveTemplate(template('Bank A'));
    });
    expect(fromA).not.toBeNull();
    await waitFor(() =>
      expect(onA.result.current.templates.map((t) => t.name)).toEqual(['Bank A'])
    );
    onA.unmount();

    const onB = renderTemplates(b);
    await waitFor(() => expect(onB.result.current.canEditTemplates).toBe(true));
    await act(async () => {
      await onB.result.current.saveTemplate(template('Bank B'));
    });
    onB.unmount();

    await sync(a, b);
    await sync(b, a);
    for (const device of [a, b]) {
      const view = renderTemplates(device);
      await waitFor(() =>
        expect(view.result.current.templates.map((t) => t.name).sort()).toEqual([
          'Bank A',
          'Bank B',
        ])
      );
      view.unmount();
    }

    const deleting = renderTemplates(b);
    await waitFor(() => expect(deleting.result.current.templates).toHaveLength(2));
    act(() => deleting.result.current.deleteTemplate(fromA!.id));
    await waitFor(() =>
      expect(deleting.result.current.templates.map((t) => t.name)).toEqual(['Bank B'])
    );
    deleting.unmount();
    await sync(b, a);
    const onAAgain = renderTemplates(a);
    await waitFor(() =>
      expect(onAAgain.result.current.templates.map((t) => t.name)).toEqual(['Bank B'])
    );
  });

  it("moves the device's templates into the open workspace once and clears the old key", async () => {
    const [a, b] = [await openDevice('space-a'), await openDevice('space-b')];
    const saved = (id: string, name: string): ImportTemplate => ({
      ...template(name),
      id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const onA = renderTemplates(a);
    await waitFor(() => expect(onA.result.current.canEditTemplates).toBe(true));
    await act(async () => {
      await onA.result.current.saveTemplate(template('Already synced'));
    });
    const existing = onA.result.current.templates[0];
    onA.unmount();
    a.sent.length = 0;
    resetImportTemplatesForTests();

    localStorage.setItem(
      LEGACY_TEMPLATES_STORAGE_KEY,
      JSON.stringify([
        { ...existing, name: 'Old copy' },
        saved('template_1_old', 'Local'),
        { id: '__proto__', name: 'bad' },
      ])
    );
    const migrating = renderTemplates(a);
    await waitFor(() =>
      expect(migrating.result.current.templates.map((t) => t.name)).toEqual([
        'Local',
        'Already synced',
      ])
    );
    expect(a.sent).toHaveLength(1);
    expect(localStorage.getItem(LEGACY_TEMPLATES_STORAGE_KEY)).toBeNull();
    migrating.unmount();

    // Another workspace opened later on this device doesn't get them.
    const other = renderTemplates(b);
    await waitFor(() => expect(other.result.current.canEditTemplates).toBe(true));
    expect(other.result.current.templates).toEqual([]);
    expect(b.sent).toEqual([]);
  });

  it("doesn't offer saving in the demo and reports a refused save", async () => {
    const demo = await openDevice('demo-space');
    setDemoSpaceId('demo-space');
    localStorage.setItem(LEGACY_TEMPLATES_STORAGE_KEY, '[]');
    const { result } = renderTemplates(demo);
    await waitFor(() => expect(result.current.templates).toEqual([]));
    expect(result.current.canEditTemplates).toBe(false);
    await act(async () => {
      expect(await result.current.saveTemplate(template('Nope'))).toBeNull();
    });
    expect(demo.sent).toEqual([]);
    // Not migrated (nothing may be written), so the device keeps its copy.
    expect(localStorage.getItem(LEGACY_TEMPLATES_STORAGE_KEY)).toBe('[]');
  });
});
