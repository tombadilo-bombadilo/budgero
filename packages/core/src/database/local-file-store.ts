/**
 * Where the local copy of a budget lives. OPFS when the browser allows it;
 * IndexedDB when it has no OPFS or refuses it. Firefox private windows (and
 * Firefox set to never remember history) throw SecurityError from
 * getDirectory() but still give pages an IndexedDB, kept for the length of the
 * session. A browser with no OPFS API at all keeps its IndexedDB like any
 * other site data, so those copies are cleaned up the same way OPFS ones are.
 *
 * The store is chosen once per tab, before anything is read. A tab that chose
 * OPFS never moves to IndexedDB later: a SecurityError after that is thrown to
 * the caller, because switching stores mid-session would fork the data.
 */

import { createLogger } from '../logger.js';

const log = createLogger('database:local-file-store');

const IDB_NAME = 'budgero-local-files';
const IDB_STORE = 'files';
const OPFS_PROBE_FILE = '.budgero-opfs-probe';

let opfsState: 'unknown' | 'available' | 'refused' = 'unknown';
let deciding: Promise<FileSystemDirectoryHandle | null> | null = null;
let announced: string | null = null;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isSecurityError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'SecurityError';
}

function opfsStorage(): StorageManager | undefined {
  const storage = globalThis.navigator?.storage;
  return typeof storage?.getDirectory === 'function' ? storage : undefined;
}

/** Log once per tab which store holds the local copies (error reports carry it as ctx_local_store). */
function announce(backend: 'OPFS' | 'IndexedDB', reason?: string): void {
  if (announced === backend) return;
  announced = backend;
  log(`Local budget copies use ${backend}${reason ? ` (${reason})` : ''}`);
}

/**
 * Whether OPFS hands out a root but refuses to create or write a file in it.
 * Only SecurityError counts: a busy probe file or a full disk says nothing
 * about whether OPFS may be used.
 */
async function opfsRefusesWrites(root: FileSystemDirectoryHandle): Promise<boolean> {
  let writable: FileSystemWritableFileStream | undefined;
  try {
    const handle = await root.getFileHandle(OPFS_PROBE_FILE, { create: true });
    // Safari < 26 has no createWritable() on the main thread (see opfs-sync-writer).
    if (typeof handle.createWritable === 'function') {
      writable = await handle.createWritable();
      await writable.write(new Uint8Array([1]));
      await writable.close();
    }
    return false;
  } catch (error) {
    try {
      await writable?.abort();
    } catch {
      // The stream is already gone.
    }
    return isSecurityError(error);
  } finally {
    try {
      await root.removeEntry(OPFS_PROBE_FILE);
    } catch {
      // Never created, or still held by another tab's probe.
    }
  }
}

async function decideBackend(storage: StorageManager): Promise<FileSystemDirectoryHandle | null> {
  let root: FileSystemDirectoryHandle;
  try {
    root = await storage.getDirectory();
  } catch (error) {
    // SecurityError: the browser denies OPFS here, and will for the whole session.
    if (!isSecurityError(error)) throw error;
    opfsState = 'refused';
    announce('IndexedDB', 'the browser refuses OPFS');
    return null;
  }
  if (await opfsRefusesWrites(root)) {
    opfsState = 'refused';
    announce('IndexedDB', 'the browser refuses OPFS writes');
    return null;
  }
  opfsState = 'available';
  announce('OPFS');
  return root;
}

/**
 * The OPFS root, or null when this tab keeps its local copies in IndexedDB.
 * Throws when OPFS fails for another reason, or fails after this tab chose it.
 */
export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsState === 'refused') return null;
  const storage = opfsStorage();
  if (!storage) {
    // Not remembered: nothing was probed, and the answer costs nothing to repeat.
    announce('IndexedDB', 'no OPFS in this browser');
    return null;
  }
  if (opfsState === 'available') return storage.getDirectory();

  deciding ??= decideBackend(storage).finally(() => {
    deciding = null;
  });
  return deciding;
}

/** Which store local copies use in this tab ('unknown' until the first access). */
export function localFileBackend(): 'opfs' | 'indexeddb' | 'unknown' {
  if (opfsState === 'available') return 'opfs';
  if (opfsState === 'refused') return 'indexeddb';
  if (typeof globalThis.navigator === 'undefined') return 'unknown';
  return opfsStorage() ? 'unknown' : 'indexeddb';
}

/** The OPFS root whatever this tab chose, for cleanup. Null when it can't be had. */
async function opfsRootForCleanup(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await opfsStorage()?.getDirectory()) ?? null;
  } catch {
    return null;
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Browser storage is unavailable. The budget could not be saved locally.'));
      return;
    }
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openIdb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const request = run(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * False only when the browser can say for sure that the fallback database was
 * never created, so cleanup in an OPFS tab doesn't create an empty one.
 */
async function idbStoreMayExist(): Promise<boolean> {
  if (!globalThis.indexedDB) return false;
  if (typeof indexedDB.databases !== 'function') return true;
  try {
    return (await indexedDB.databases()).some((db) => db.name === IDB_NAME);
  } catch {
    return true;
  }
}

export async function idbReadFile(name: string): Promise<Uint8Array | null> {
  const value = await withStore('readonly', (store) => store.get(name) as IDBRequest<unknown>);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export async function idbWriteFile(name: string, data: Uint8Array): Promise<void> {
  // put() clones the value before it returns, so the caller may reuse its
  // buffer afterwards. The clone takes the view's whole buffer though: copy
  // only when the view is a window into a larger (or shared) one.
  const wholeBuffer =
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength;
  const value = wholeBuffer ? data : data.slice();
  await withStore('readwrite', (store) => store.put(value, name));
}

export async function idbDeleteFile(name: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(name));
}

export async function idbFileExists(name: string): Promise<boolean> {
  // count() answers without reading (and cloning) the whole database blob.
  return (await withStore('readonly', (store) => store.count(name))) > 0;
}

/** Names of the local copies kept in IndexedDB. */
export async function idbListFiles(): Promise<string[]> {
  if (!(await idbStoreMayExist())) return [];
  const keys = await withStore('readonly', (store) => store.getAllKeys());
  return keys.filter((key): key is string => typeof key === 'string');
}

/** Whether a local copy with this name exists, in whichever store this tab uses. */
export async function localFileExists(name: string): Promise<boolean> {
  try {
    const root = await getOpfsRoot();
    if (root) {
      await root.getFileHandle(name, { create: false });
      return true;
    }
    return await idbFileExists(name);
  } catch {
    return false;
  }
}

/**
 * Remove a local copy from both stores: a copy written by an earlier session
 * that used the other store must not outlive the one this tab uses.
 */
export async function deleteLocalFile(name: string): Promise<void> {
  let failure: unknown;
  const root = await opfsRootForCleanup();
  if (root) {
    try {
      await root.removeEntry(name);
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name !== 'NotFoundError') failure = error;
    }
  }
  if (await idbStoreMayExist()) {
    try {
      await idbDeleteFile(name);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw asError(failure);
}

const IDB_DELETE_TIMEOUT_MS = 2000;

/**
 * Remove every local copy kept in IndexedDB (sign-out / reset). Resolves once
 * the copies are gone and rejects when they could not be removed.
 *
 * The store is emptied first: that works while another tab still has the
 * database open, which only blocks deleteDatabase(). Dropping the then-empty
 * database is tidying up, so a blocked or slow delete is not waited for.
 */
export async function clearIdbFiles(timeoutMs = IDB_DELETE_TIMEOUT_MS): Promise<void> {
  if (!(await idbStoreMayExist())) return;
  await withStore('readwrite', (store) => store.clear());
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      const request = indexedDB.deleteDatabase(IDB_NAME);
      request.onsuccess = done;
      request.onerror = done;
      request.onblocked = done;
    } catch {
      done();
    }
  });
}

/** Remove everything the page keeps in OPFS. */
async function clearOpfsFiles(): Promise<void> {
  const root = (await opfsRootForCleanup()) as
    | (FileSystemDirectoryHandle & {
        keys?: () => AsyncIterable<string>;
        entries?: () => AsyncIterable<[string, unknown]>;
      })
    | null;
  if (!root) return;
  const names: string[] = [];
  if (typeof root.keys === 'function') {
    for await (const name of root.keys()) names.push(name);
  } else if (typeof root.entries === 'function') {
    for await (const [name] of root.entries()) names.push(name);
  }
  let failure: unknown;
  for (const name of names) {
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name !== 'NotFoundError') failure ??= error;
    }
  }
  if (failure) throw asError(failure);
}

/**
 * Remove every local copy from both stores (sign-out / reset). Stop the
 * runtime and wait for writes in flight first (see whenLocalWritesSettle), or
 * a late save puts a budget back. Both stores are always tried; rejects with
 * the first failure.
 */
export async function clearLocalFiles(): Promise<void> {
  const results = await Promise.allSettled([clearOpfsFiles(), clearIdbFiles()]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Test hook. */
export function resetLocalFileStoreForTests(): void {
  opfsState = 'unknown';
  deciding = null;
  announced = null;
}
