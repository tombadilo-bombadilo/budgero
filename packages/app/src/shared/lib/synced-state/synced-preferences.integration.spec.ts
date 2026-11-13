import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Real databases stand in for devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import {
  reconcileSyncedPreference,
  readSyncedState,
  setSyncedState,
  userScope,
  type SyncedPreference,
  type SyncedStateRuntime,
} from '@shared/lib/synced-state';

type Call = { op: string; args: Record<string, unknown> };

const env = vi.hoisted(() => ({
  services: undefined as unknown,
  runtime: null as unknown,
}));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => env.runtime ?? { services: () => env.services },
}));

const analytics = vi.hoisted(() => ({
  observer: null as ((name: string, props: Record<string, string>) => void) | null,
  track: vi.fn(),
}));
vi.mock('@shared/lib/analytics/track', () => ({
  track: analytics.track,
  trackOnUnload: vi.fn(),
  observeTrackedEvents: (observer: (name: string, props: Record<string, string>) => void) => {
    analytics.observer = observer;
    return () => {
      analytics.observer = null;
    };
  },
}));

async function openDevice(): Promise<Services> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const manager = new ServiceManager();
    await manager.initialize(await NodeSqlJsAdapter.create());
    return manager.getServices();
  } finally {
    cwd.mockRestore();
  }
}

/** A device's runtime: ops run through the real registry; `sent` collects what would sync. */
function deviceRuntime(device: Services, sent: Call[]): SyncedStateRuntime {
  return {
    services: () => device,
    getActiveSpaceId: () => 'space-1',
    isInitialized: () => true,
    executeMutation: async ({ op, payload }) => {
      env.services = device;
      const args = await registry.prepareMutationArgs(op, payload);
      await registry.executeMutationOp(op, args, { mutationId: 'local', isReceiver: false });
      sent.push({ op, args: JSON.parse(JSON.stringify(args)) as Record<string, unknown> });
      return { result: undefined as never };
    },
  };
}

/** Applies another device's ops here (with no app runtime open, as the sync path does). */
async function receive(device: Services, calls: Call[]) {
  const open = env.runtime;
  env.runtime = null;
  env.services = device;
  try {
    for (const call of calls) {
      await registry.executeMutationOp(call.op, call.args, { mutationId: 'r', isReceiver: true });
    }
  } finally {
    env.runtime = open;
  }
}

/** A device's language cache, as the real preference keeps it. */
function languageOn(device: { stored: string | null; shown: string }): SyncedPreference<string> {
  return {
    key: 'language',
    readLocal: () => ({ value: device.stored ?? device.shown, explicit: device.stored !== null }),
    isValid: (value): value is string => typeof value === 'string',
    apply: (value) => {
      device.stored = value;
      device.shown = value;
    },
  };
}

async function load(pref: SyncedPreference<string>, rt: SyncedStateRuntime) {
  const scope = userScope('u1');
  return reconcileSyncedPreference(pref, readSyncedState(scope, 'language', rt), (value) =>
    setSyncedState(scope, 'language', value, rt)
  );
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  env.runtime = null;
  analytics.track.mockReset();
});

afterEach(() => {
  env.runtime = null;
});

describe('synced preferences across devices', () => {
  it("a fresh device takes the other device's choice and writes nothing", async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const fromA: Call[] = [];
    const fromB: Call[] = [];
    const rtA = deviceRuntime(a, fromA);
    const rtB = deviceRuntime(b, fromB);

    // A: chosen before this was synced, so it goes up once on load.
    const deviceA = { stored: 'de' as string | null, shown: 'de' };
    expect(await load(languageOn(deviceA), rtA)).toBe('written');
    expect(await load(languageOn(deviceA), rtA)).toBe('none');
    expect(fromA.map((c) => c.op)).toEqual(['syncedState.set']);

    // B: browser default only. Before A's write arrives, nothing is written.
    const deviceB = { stored: null as string | null, shown: 'en' };
    expect(await load(languageOn(deviceB), rtB)).toBe('none');
    await receive(b, fromA);
    expect(await load(languageOn(deviceB), rtB)).toBe('applied');
    expect(deviceB).toEqual({ stored: 'de', shown: 'de' });
    expect(fromB).toEqual([]);
  });

  it('a change on one device reaches the other, where the synced value wins over its cache', async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const fromA: Call[] = [];
    const rtA = deviceRuntime(a, fromA);
    const rtB = deviceRuntime(b, []);
    expect(await setSyncedState(userScope('u1'), 'language', 'fr', rtA)).toBe(true);
    await receive(b, fromA);

    const deviceB = { stored: 'nl' as string | null, shown: 'nl' };
    expect(await load(languageOn(deviceB), rtB)).toBe('applied');
    expect(deviceB.shown).toBe('fr');
  });
});

describe('first-month milestones across devices', () => {
  it('a milestone sent on one device is not sent again on another', async () => {
    const fm = await import('@shared/lib/analytics/first-month');
    const [a, b] = [await openDevice(), await openDevice()];
    const fromA: Call[] = [];
    const signedUp = new Date(Date.now() - 86_400_000).toISOString();

    env.runtime = deviceRuntime(a, fromA);
    fm.setFirstMonthUser('u1', signedUp);
    analytics.observer!('Assignment Upserted', {});
    await settle();
    expect(analytics.track).toHaveBeenCalledWith('activation_milestone', {
      milestone: 'first_assign',
      day: '1',
    });
    expect(fromA.map((c) => c.op)).toEqual(['syncedState.merge']);
    // Again on A: neither sent nor written again.
    analytics.observer!('Assignment Upserted', {});
    await settle();
    expect(fromA).toHaveLength(1);
    fm.resetFirstMonthForTests();

    // Device B: its own (empty) storage, A's write received.
    localStorage.clear();
    analytics.track.mockReset();
    await receive(b, fromA);
    const fromB: Call[] = [];
    env.runtime = deviceRuntime(b, fromB);
    fm.setFirstMonthUser('u1', signedUp);
    analytics.observer!('Assignment Upserted', {});
    await settle();
    expect(analytics.track).not.toHaveBeenCalledWith('activation_milestone', expect.anything());
    expect(fromB).toEqual([]);
    expect(JSON.parse(localStorage.getItem('budgero:fm-milestones')!)).toEqual({
      u1: ['first_assign'],
    });
    fm.resetFirstMonthForTests();
  });
});
