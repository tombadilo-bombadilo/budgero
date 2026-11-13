import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Real databases stand in for devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import {
  getFirstSteps,
  hideFirstSteps,
  migrateLegacyFirstSteps,
  noteFirstStepsMutation,
  noteFirstStepsVisit,
  resetFirstStepsForTests,
  setFirstStepsUser,
  showFirstSteps,
  startFirstSteps,
} from './first-steps';

type Call = { op: string; args: Record<string, unknown> };

/** One device: its database, its localStorage, and what it would sync. */
interface Device {
  services: Services;
  storage: Record<string, string>;
  outbox: Call[];
}

const runtime = vi.hoisted(() => ({
  device: undefined as unknown as {
    services: unknown;
    outbox: { op: string; args: Record<string, unknown> }[];
  },
  role: 'owner',
}));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => runtime.device.services,
    getActiveSpaceId: () => 'space-1',
    isInitialized: () => true,
    listSpaces: () => [{ space_id: 'space-1', role: runtime.role }],
    executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
      const sent = await registry.prepareMutationArgs(spec.op, spec.payload);
      await registry.executeMutationOp(spec.op, sent, { mutationId: 'local', isReceiver: false });
      runtime.device.outbox.push({ op: spec.op, args: JSON.parse(JSON.stringify(sent)) });
      return { result: undefined };
    },
  }),
}));

async function openDevice(): Promise<Device> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const manager = new ServiceManager();
    await manager.initialize(await NodeSqlJsAdapter.create());
    return { services: manager.getServices(), storage: {}, outbox: [] };
  } finally {
    cwd.mockRestore();
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
};

let current: Device | null = null;

/** Switch to a device (as a signed-in user): its own storage and a fresh app. */
async function use(device: Device, userId: string): Promise<void> {
  await settle();
  if (current) current.storage = { ...localStorage };
  localStorage.clear();
  for (const [key, value] of Object.entries(device.storage)) localStorage.setItem(key, value);
  resetFirstStepsForTests();
  current = device;
  runtime.device = device as unknown as typeof runtime.device;
  setFirstStepsUser('space-1', userId);
}

/** Deliver what `from` sent since the last delivery into `to`'s database. */
async function deliver(from: Device, to: Device): Promise<void> {
  await settle();
  const previous = runtime.device;
  runtime.device = to as unknown as typeof runtime.device;
  for (const call of from.outbox.splice(0)) {
    await registry.executeMutationOp(call.op, call.args, { mutationId: 'r', isReceiver: true });
  }
  runtime.device = previous;
}

const ops = (device: Device) => device.outbox.map((call) => call.op);

beforeEach(() => {
  localStorage.clear();
  current = null;
  runtime.role = 'owner';
  resetFirstStepsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('first steps across devices', () => {
  it('shows on a device that never ran onboarding, and either device’s ticks count on both', async () => {
    const [desktop, phone] = [await openDevice(), await openDevice()];
    await use(desktop, 'u1');
    startFirstSteps('space-1', 'u1', new Date(2026, 10, 3));
    await deliver(desktop, phone);

    await use(phone, 'u1');
    expect(getFirstSteps('space-1')).toMatchObject({ startedOn: '2026-11-03', dismissed: false });
    // A transaction added on the phone, and the phone opened the next day.
    noteFirstStepsMutation('space-1', 'transactions.add');
    noteFirstStepsVisit('space-1', new Date(2026, 10, 4, 8));
    await deliver(phone, desktop);

    await use(desktop, 'u1');
    expect(getFirstSteps('space-1')?.done).toMatchObject({ transaction: true, return: true });
  });

  it('hide and show settle on the newer choice on both devices, in any order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const [desktop, phone] = [await openDevice(), await openDevice()];
    await use(desktop, 'u1');
    startFirstSteps('space-1', 'u1');
    await deliver(desktop, phone);

    // Offline on both: hidden on the desktop, then shown again on the phone.
    await use(desktop, 'u1');
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    hideFirstSteps('space-1');
    await use(phone, 'u1');
    vi.setSystemTime(new Date('2026-11-12T10:00:05Z'));
    hideFirstSteps('space-1');
    await settle();
    vi.setSystemTime(new Date('2026-11-12T10:00:06Z'));
    showFirstSteps('space-1');
    await deliver(phone, desktop);
    await use(desktop, 'u1');
    await deliver(desktop, phone);

    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
    await use(phone, 'u1');
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  });

  it('keeps two members of a shared workspace apart', async () => {
    const [mine, theirs] = [await openDevice(), await openDevice()];
    await use(mine, 'u1');
    startFirstSteps('space-1', 'u1');
    hideFirstSteps('space-1');
    await deliver(mine, theirs);

    await use(theirs, 'u2');
    expect(getFirstSteps('space-1')).toBeNull();
    noteFirstStepsMutation('space-1', 'transactions.add');
    expect(theirs.outbox).toEqual([]);
    // The same shared computer, the other member signed in.
    await use(mine, 'u2');
    expect(getFirstSteps('space-1')).toBeNull();
    await use(mine, 'u1');
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
  });

  it('moves a device-only checklist in with one write, once, and the other device gets it', async () => {
    const [old, phone] = [await openDevice(), await openDevice()];
    old.storage['budgero:first-steps'] = JSON.stringify({
      'space-1': {
        startedOn: '2026-11-01',
        done: { assign: true, goal: true, transaction: false, return: false },
        dismissed: false,
        v: 2,
      },
    });
    await use(old, 'u1');
    migrateLegacyFirstSteps('space-1', 'u1');
    await settle();
    expect(ops(old)).toEqual(['syncedState.merge']);
    await deliver(old, phone);
    await use(old, 'u1');
    migrateLegacyFirstSteps('space-1', 'u1');
    await settle();
    expect(old.outbox).toEqual([]);

    await use(phone, 'u1');
    expect(getFirstSteps('space-1')).toMatchObject({
      startedOn: '2026-11-01',
      // The v2 → v3 rule still applies: its assignment was announced back then.
      done: { assign: true, goal: true, transaction: false, everyCoin: true },
    });
  });

  it('a member on the owner’s computer does not take the owner’s device-only list', async () => {
    const device = await openDevice();
    device.storage['budgero:first-steps'] = JSON.stringify({
      'space-1': { startedOn: '2026-11-01', done: {}, dismissed: false, v: 3 },
    });
    runtime.role = 'editor';
    await use(device, 'u2');
    migrateLegacyFirstSteps('space-1', 'u2');
    await settle();
    expect(device.outbox).toEqual([]);
    expect(getFirstSteps('space-1')).toBeNull();
  });
});
