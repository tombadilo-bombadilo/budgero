import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Real databases stand in for devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import * as registry from '@shared/mutations/op-code-registry';
import { BANK_EXPIRY_REMINDERS_KEY } from '@features/bank-sync/ui/BankAutoSync';
import { TRIAL_ENDING_DISMISSED_KEY } from '@features/subscription/ui/TrialEndingBanner';
import { SAVINGS_TARGET_KEY } from '@pages/analytics/reports/useSavingsTarget';
import {
  SCHEDULING_GUIDES_SEEN_KEY,
  schedulingGuideEntry,
} from '@shared/store/useSchedulingGuideStore';
import { budgetScope, userScope } from './synced-state';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Call = { op: string; args: Record<string, unknown> };

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

/** Runs an op on its device (offline) and returns what it would sync. */
async function local(device: Services, op: string, args: Record<string, unknown>): Promise<Call> {
  runtime.services = device;
  const sent = await registry.prepareMutationArgs(op, args);
  await registry.executeMutationOp(op, sent, { mutationId: 'local', isReceiver: false });
  return { op, args: JSON.parse(JSON.stringify(sent)) as Record<string, unknown> };
}

async function receive(device: Services, calls: Call[]) {
  runtime.services = device;
  for (const call of calls) {
    await registry.executeMutationOp(call.op, call.args, { mutationId: 'r', isReceiver: true });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('synced state across devices', () => {
  it('keeps entries two offline devices merge into the same key', async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const fromA = await local(a, 'syncedState.merge', {
      scope: 'workspace',
      key: 'importTemplates',
      patch: { set: { bank1: { delimiter: ';' } } },
    });
    const fromB = await local(b, 'syncedState.merge', {
      scope: 'workspace',
      key: 'importTemplates',
      patch: { set: { bank2: { delimiter: ',' } } },
    });
    await receive(a, [fromB]);
    await receive(b, [fromA]);
    const expected = { bank1: { delimiter: ';' }, bank2: { delimiter: ',' } };
    expect(a.syncedState.get('workspace', 'importTemplates')).toEqual(expected);
    expect(b.syncedState.get('workspace', 'importTemplates')).toEqual(expected);
  });

  it('settles a set from two devices on the newer one, in either arrival order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const [a, b] = [await openDevice(), await openDevice()];
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    const older = await local(a, 'syncedState.set', {
      scope: 'user:u1',
      key: 'theme',
      value: 'light',
    });
    vi.setSystemTime(new Date('2026-11-12T10:00:05Z'));
    const newer = await local(b, 'syncedState.set', {
      scope: 'user:u1',
      key: 'theme',
      value: 'dark',
    });
    expect(older.args.at).toBe('2026-11-12T10:00:00.000Z');
    await receive(a, [newer]);
    await receive(b, [older]);
    expect(a.syncedState.get('user:u1', 'theme')).toBe('dark');
    expect(b.syncedState.get('user:u1', 'theme')).toBe('dark');
  });

  it('refuses an oversized value on the device that makes it, before anything is sent', async () => {
    runtime.services = await openDevice();
    await expect(
      registry.prepareMutationArgs('syncedState.set', {
        scope: 'workspace',
        key: 'big',
        value: 'x'.repeat(70_000),
      })
    ).rejects.toThrow(/too large/);
    await expect(
      registry.prepareMutationArgs('syncedState.set', { scope: 'nobody', key: 'k', value: 1 })
    ).rejects.toThrow(/scope/);
  });

  it('merges seen page guides from two devices', async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const fromA = await local(a, 'pageGuides.markSeen', { userId: 'u1', guides: ['budget'] });
    const fromB = await local(b, 'pageGuides.markSeen', { userId: 'u1', guides: ['reports'] });
    await receive(a, [fromB]);
    await receive(b, [fromA]);
    expect(a.pageGuides.getSeen('u1')).toEqual(['budget', 'reports']);
    expect(b.pageGuides.getSeen('u1')).toEqual(['budget', 'reports']);
  });
});

describe('device flags moved into synced state', () => {
  it('reach a second device with the keys and shapes the app writes', async () => {
    const [a, b] = [await openDevice(), await openDevice()];
    const fromA = [
      await local(a, 'syncedState.set', {
        scope: budgetScope(3),
        key: SAVINGS_TARGET_KEY,
        value: 20,
      }),
      await local(a, 'syncedState.merge', {
        scope: userScope('u1'),
        key: SCHEDULING_GUIDES_SEEN_KEY,
        patch: { set: { [schedulingGuideEntry('future', 3)]: true } },
      }),
      await local(a, 'syncedState.set', {
        scope: userScope('u1'),
        key: TRIAL_ENDING_DISMISSED_KEY,
        value: '2026-11-14T10:00:00.000Z',
      }),
      await local(a, 'syncedState.merge', {
        scope: userScope('u1'),
        key: BANK_EXPIRY_REMINDERS_KEY,
        patch: { set: { s1: '2026-11-13' } },
      }),
    ];
    const fromB = await local(b, 'syncedState.merge', {
      scope: userScope('u1'),
      key: BANK_EXPIRY_REMINDERS_KEY,
      patch: { set: { s2: '2026-11-13' } },
    });
    await receive(b, fromA);
    await receive(a, [fromB]);
    for (const device of [a, b]) {
      expect(device.syncedState.get('budget:3', SAVINGS_TARGET_KEY)).toBe(20);
      expect(device.syncedState.get('user:u1', SCHEDULING_GUIDES_SEEN_KEY)).toEqual({
        'future:3': true,
      });
      expect(device.syncedState.get('user:u1', TRIAL_ENDING_DISMISSED_KEY)).toBe(
        '2026-11-14T10:00:00.000Z'
      );
      expect(device.syncedState.get('user:u1', BANK_EXPIRY_REMINDERS_KEY)).toEqual({
        s1: '2026-11-13',
        s2: '2026-11-13',
      });
    }
  });
});

describe('synced state ops in undo and the audit log', () => {
  it('are neither undoable nor recorded, unlike preferences', () => {
    for (const op of ['syncedState.set', 'syncedState.merge', 'pageGuides.markSeen']) {
      expect(registry.getUndoSpec(op), op).toBeUndefined();
      expect(registry.isUnrecordedOp(op), op).toBe(true);
    }
    expect(registry.isUnrecordedOp('userPreferences.setWeekStartsOn')).toBe(false);
    expect(registry.isUnrecordedOp('futureDomain.op')).toBe(false);
  });
});
