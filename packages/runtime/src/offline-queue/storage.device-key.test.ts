import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBQueueStorage } from './storage';
import { masterPasswordStore } from '../key-vault/master-password-store';
import { createStorageMock } from '../__tests__/storage-mock';
import { FakeIndexedDBFactory } from '../__tests__/indexeddb-mock';
import {
  MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY,
  MASTER_PASSWORD_INDEXEDDB_NAME,
  MASTER_PASSWORD_INDEXEDDB_STORE,
  OFFLINE_QUEUE_DEVICE_KEY_RECORD_KEY,
} from '../types/storage-keys';

const QUEUE_DB = 'budgero_offline_queue';
const QUEUE_STORE = 'mutations';

function mutation(id: string) {
  return {
    id,
    baseVersion: 1,
    op: 'reports.saveQuestion',
    args: { name: id },
    timestamp: new Date('2026-11-01T00:00:00.000Z'),
    spaceId: 's1',
  };
}

/** Let fire-and-forget IndexedDB work (clear()) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('offline queue device key', () => {
  let idb: FakeIndexedDBFactory;

  beforeEach(() => {
    idb = new FakeIndexedDBFactory();
    vi.stubGlobal('indexedDB', idb as unknown as IDBFactory);
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
    (masterPasswordStore as unknown as { indexedDBStore: unknown }).indexedDBStore = null;
  });

  afterEach(() => {
    masterPasswordStore.clearSessionOnly();
    (masterPasswordStore as unknown as { indexedDBStore: unknown }).indexedDBStore = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const secureRecord = (key: string) =>
    idb.read(MASTER_PASSWORD_INDEXEDDB_STORE, key, MASTER_PASSWORD_INDEXEDDB_NAME);
  const queueRecord = (key: string) => idb.read(QUEUE_STORE, key, QUEUE_DB);

  it('keeps queued mutations readable across an unlock in memory mode', async () => {
    await new IndexedDBQueueStorage().save('s1', [mutation('m1')]);

    // Default 'memory' mode: every unlock clears the password cache and
    // deletes the shared device key.
    await masterPasswordStore.store('master');
    expect(secureRecord(MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY)).toBeUndefined();

    const loaded = await new IndexedDBQueueStorage().load('s1');
    expect(loaded.map((m) => m.id)).toEqual(['m1']);
  });

  it('reads a queue written under the shared device key and moves it to the queue key', async () => {
    const legacy = await masterPasswordStore.encryptStringForDevice(
      JSON.stringify([mutation('old')])
    );
    expect(legacy).toMatch(/^enc1:/);
    idb.write(QUEUE_STORE, 's1', legacy, QUEUE_DB);

    const loaded = await new IndexedDBQueueStorage().load('s1');

    expect(loaded.map((m) => m.id)).toEqual(['old']);
    expect(queueRecord('s1')).toMatch(/^encq1:/);
  });

  it('reports and keeps a queue it cannot decrypt instead of dropping it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const legacy = await masterPasswordStore.encryptStringForDevice(
      JSON.stringify([mutation('lost')])
    );
    idb.write(QUEUE_STORE, 's1', legacy, QUEUE_DB);
    // The shared key is gone (what an unlock in memory mode did before).
    await masterPasswordStore.store('master');

    const storage = new IndexedDBQueueStorage();
    expect(await storage.load('s1')).toEqual([]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Stored offline queue could not be decrypted'),
      expect.objectContaining({ spaceId: 's1' })
    );
    expect(queueRecord('s1:undecryptable')).toEqual([legacy]);

    // The next write does not overwrite it.
    await storage.save('s1', [mutation('new')]);
    expect(queueRecord('s1:undecryptable')).toEqual([legacy]);
    expect((await new IndexedDBQueueStorage().load('s1')).map((m) => m.id)).toEqual(['new']);
  });

  it('recovers a queue set aside after a transient key-store failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await new IndexedDBQueueStorage().save('s1', [mutation('m1')]);

    const decrypt = vi
      .spyOn(masterPasswordStore, 'decryptQueueToken')
      .mockRejectedValueOnce(new Error('IndexedDB read failed'));
    expect(await new IndexedDBQueueStorage().load('s1')).toEqual([]);
    expect(queueRecord('s1')).toBeUndefined();
    decrypt.mockRestore();

    await new IndexedDBQueueStorage().save('s1', [mutation('m2')]);
    const loaded = await new IndexedDBQueueStorage().load('s1');

    expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(queueRecord('s1:undecryptable')).toBeUndefined();
    expect((await new IndexedDBQueueStorage().load('s1')).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('sign-out / reset deletes the queue key so nothing queued stays readable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await new IndexedDBQueueStorage().save('s1', [mutation('m1')]);
    expect(secureRecord(OFFLINE_QUEUE_DEVICE_KEY_RECORD_KEY)).toBeDefined();

    masterPasswordStore.clear();
    await settle();

    expect(secureRecord(OFFLINE_QUEUE_DEVICE_KEY_RECORD_KEY)).toBeUndefined();
    expect(await new IndexedDBQueueStorage().load('s1')).toEqual([]);
  });
});
