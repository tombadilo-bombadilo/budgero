import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearIdbFiles,
  clearLocalFiles,
  deleteLocalFile,
  getOpfsRoot,
  idbListFiles,
  idbReadFile,
  idbWriteFile,
  localFileBackend,
  localFileExists,
  resetLocalFileStoreForTests,
} from '../src/database/local-file-store.js';
import { WebDatabaseAdapter } from '../src/database/web-adapter.js';
import { createMemoryIndexedDb, type MemoryIndexedDb } from './memory-indexeddb.helpers.js';

vi.mock('../src/database/migrations.js', () => ({
  MigrationRunner: class {
    runMigrations(): void {
      // Not needed here
    }
  },
}));

const IDB_NAME = 'budgero-local-files';

/** A small OPFS root: flat files, with optional refusals. */
function fakeOpfs(refuse: { getFileHandle?: string; createWritable?: string } = {}) {
  const files = new Map<string, Uint8Array>();
  const root = {
    files,
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (refuse.getFileHandle) throw new DOMException('refused', refuse.getFileHandle);
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        async createWritable() {
          if (refuse.createWritable) throw new DOMException('refused', refuse.createWritable);
          const chunks: Uint8Array[] = [];
          return {
            write: async (chunk: Uint8Array) => void chunks.push(chunk),
            close: async () => void files.set(name, chunks[0] ?? new Uint8Array()),
            abort: async () => undefined,
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError');
    },
    async *keys() {
      yield* [...files.keys()];
    },
    async *entries() {
      for (const [name, data] of files) yield [name, data] as [string, unknown];
    },
  };
  return root;
}

const originalNavigator = globalThis.navigator;
const originalIndexedDb = globalThis.indexedDB;
let idb: MemoryIndexedDb;

function setNavigator(getDirectory?: () => Promise<unknown>) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: getDirectory ? { getDirectory } : {} },
    configurable: true,
  });
}

const refuseOpfs = () =>
  setNavigator(async () => {
    throw new DOMException('Security error when calling GetDirectory', 'SecurityError');
  });

const bytes = (...values: number[]) => new Uint8Array(values);

beforeEach(() => {
  idb = createMemoryIndexedDb();
  Object.defineProperty(globalThis, 'indexedDB', { value: idb.indexedDB, configurable: true });
});

afterEach(() => {
  resetLocalFileStoreForTests();
  Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: originalIndexedDb, configurable: true });
});

describe('IndexedDB backend', () => {
  it('stores, finds, lists and deletes copies, closing every connection', async () => {
    refuseOpfs();
    expect(await getOpfsRoot()).toBeNull();
    await idbWriteFile('space_a.db', bytes(1, 2, 3));
    await idbWriteFile('space_b.db', bytes(4));

    expect(await idbReadFile('space_a.db')).toEqual(bytes(1, 2, 3));
    expect(await localFileExists('space_a.db')).toBe(true);
    expect(await localFileExists('space_x.db')).toBe(false);
    expect((await idbListFiles()).sort()).toEqual(['space_a.db', 'space_b.db']);

    await deleteLocalFile('space_a.db');
    expect(await idbReadFile('space_a.db')).toBeNull();
    expect(idb.openConnections()).toBe(0);
  });

  it('checks whether a copy exists without loading it', async () => {
    refuseOpfs();
    await idbWriteFile('space_a.db', new Uint8Array(1024));
    expect(await localFileExists('space_a.db')).toBe(true);
    expect(idb.valueReads()).toBe(0);
  });

  it('stores exactly the bytes of the view, and later changes to the buffer stay out', async () => {
    refuseOpfs();
    const whole = bytes(1, 2, 3);
    await idbWriteFile('whole.db', whole);
    whole[0] = 9;
    expect(await idbReadFile('whole.db')).toEqual(bytes(1, 2, 3));

    const window = bytes(0, 1, 2, 3, 0).subarray(1, 4);
    await idbWriteFile('window.db', window);
    const stored = idb.databases.get(IDB_NAME)!.get('files')!.get('window.db') as Uint8Array;
    expect(stored.buffer.byteLength).toBe(3);
    expect(stored).toEqual(bytes(1, 2, 3));
  });

  it('rejects a failed write instead of losing it quietly', async () => {
    refuseOpfs();
    idb.failWrites('QuotaExceededError');
    await expect(idbWriteFile('space_a.db', bytes(1))).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(idb.openConnections()).toBe(0);
  });
});

describe('choosing the store', () => {
  it('uses IndexedDB in a browser without OPFS, every time it is asked', async () => {
    setNavigator();
    expect(localFileBackend()).toBe('indexeddb');
    expect(await getOpfsRoot()).toBeNull();
    expect(localFileBackend()).toBe('indexeddb');
  });

  it.each([{ getFileHandle: 'SecurityError' }, { createWritable: 'SecurityError' }])(
    'uses IndexedDB when OPFS hands out a root but refuses writes (%j)',
    async (refuse) => {
      const root = fakeOpfs(refuse);
      setNavigator(async () => root);
      expect(await getOpfsRoot()).toBeNull();
      expect(localFileBackend()).toBe('indexeddb');
      expect(root.files.size).toBe(0);
    }
  );

  it('stays on OPFS when the probe fails for another reason', async () => {
    const root = fakeOpfs({ createWritable: 'NoModificationAllowedError' });
    setNavigator(async () => root);
    expect(await getOpfsRoot()).toBe(root);
    expect(localFileBackend()).toBe('opfs');
  });

  it('decides once for calls that arrive together, and leaves no probe file', async () => {
    const root = fakeOpfs();
    const getDirectory = vi.fn(async () => root);
    setNavigator(getDirectory);
    const [a, b] = await Promise.all([getOpfsRoot(), getOpfsRoot()]);
    expect(a).toBe(root);
    expect(b).toBe(root);
    expect(getDirectory).toHaveBeenCalledTimes(1);
    expect(root.files.size).toBe(0);
  });
});

describe('removing local copies', () => {
  it('deletes a copy from both stores', async () => {
    const root = fakeOpfs();
    setNavigator(async () => root);
    root.files.set('space_a.db', bytes(1));
    await idbWriteFile('space_a.db', bytes(2));

    await deleteLocalFile('space_a.db');
    expect(root.files.has('space_a.db')).toBe(false);
    expect(await idbReadFile('space_a.db')).toBeNull();
  });

  it('cleanupDatabaseFile reaches a copy in the store this tab does not use', async () => {
    const root = fakeOpfs();
    setNavigator(async () => root);
    await idbWriteFile('space_a.db', bytes(2));
    await WebDatabaseAdapter.cleanupDatabaseFile('space_a.db');
    expect(await idbListFiles()).toEqual([]);
  });

  it('does not create the fallback database just to clean it', async () => {
    setNavigator(async () => fakeOpfs());
    await deleteLocalFile('space_a.db');
    await clearLocalFiles();
    expect(idb.databases.has(IDB_NAME)).toBe(false);
  });

  it('removes stale space copies kept in IndexedDB (no OPFS)', async () => {
    setNavigator();
    await idbWriteFile('space_keep.db', bytes(1));
    await idbWriteFile('space_gone.db', bytes(2));
    await idbWriteFile('other.db', bytes(3));
    await WebDatabaseAdapter.cleanupStaleSpaceDatabases(['keep']);
    expect((await idbListFiles()).sort()).toEqual(['other.db', 'space_keep.db']);
  });

  it('wipes both stores on sign-out', async () => {
    const root = fakeOpfs();
    setNavigator(async () => root);
    root.files.set('space_a.db', bytes(1));
    await idbWriteFile('space_b.db', bytes(2));

    await clearLocalFiles();
    expect(root.files.size).toBe(0);
    expect(idb.databases.has(IDB_NAME)).toBe(false);
  });

  it('wipes IndexedDB copies in a private window, where OPFS throws', async () => {
    refuseOpfs();
    await idbWriteFile('space_a.db', bytes(1));
    await clearLocalFiles();
    expect(idb.databases.has(IDB_NAME)).toBe(false);
  });

  it('counts an emptied database as wiped when another tab blocks deleting it', async () => {
    refuseOpfs();
    await idbWriteFile('space_a.db', bytes(1));
    idb.blockDeletes(true);
    await clearIdbFiles(50);
    expect(idb.databases.get(IDB_NAME)!.get('files')!.size).toBe(0);
  });

  it('reports a wipe that could not remove the copies', async () => {
    refuseOpfs();
    await idbWriteFile('space_a.db', bytes(1));
    idb.failWrites('UnknownError');
    await expect(clearLocalFiles()).rejects.toMatchObject({ name: 'UnknownError' });
  });
});
