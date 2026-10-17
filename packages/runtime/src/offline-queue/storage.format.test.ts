import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBQueueStorage } from './storage';
import { masterPasswordStore } from '../key-vault/master-password-store';
import { createStorageMock } from '../__tests__/storage-mock';

function resetDeviceKeyDbCache(): void {
  (masterPasswordStore as unknown as { indexedDBStore: unknown }).indexedDBStore = null;
}

describe('queue storage formats', () => {
  const localStorageMock = createStorageMock();
  const orig = globalThis.indexedDB;

  afterEach(() => {
    localStorageMock.clear();
    resetDeviceKeyDbCache();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: orig });
  });

  it('upgrades only pre-milliunit entries and records each entry’s own format', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          throw new Error('idb disabled');
        },
      },
    });
    resetDeviceKeyDbCache();
    const at = '2024-01-01T00:00:00.000Z';
    localStorageMock.setItem(
      'budgero_offline_mutation_queue_s1',
      JSON.stringify([
        { id: 'legacy', op: 'transactions.add', args: { inflow: 1.5 }, timestamp: at },
        { id: 'v2', v: 2, op: 'transactions.add', args: { inflow: 1500 }, timestamp: at },
        { id: 'v3', v: 3, op: 'transactions.saveSplits', args: { inflow: 1500 }, timestamp: at },
      ])
    );

    const loaded = await new IndexedDBQueueStorage().load('s1');

    expect(loaded.map((m) => [m.id, m.v, m.args])).toEqual([
      ['legacy', 2, { inflow: 1500 }],
      ['v2', 2, { inflow: 1500 }],
      ['v3', 3, { inflow: 1500 }],
    ]);
  });
});
