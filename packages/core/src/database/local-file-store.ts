/**
 * Where the local copy of a budget lives. OPFS when the browser allows it;
 * IndexedDB when it refuses OPFS. Firefox private windows (and Firefox set to
 * never remember history) throw SecurityError from getDirectory() but still
 * give pages an IndexedDB, kept for the length of the session.
 */

const IDB_NAME = 'budgero-local-files';
const IDB_STORE = 'files';

let opfsState: 'unknown' | 'available' | 'refused' = 'unknown';

/** The OPFS root, or null when this browser context can't use OPFS. */
export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsState === 'refused') return null;
  const storage = globalThis.navigator?.storage;
  if (!storage?.getDirectory) {
    opfsState = 'refused';
    return null;
  }
  try {
    const root = await storage.getDirectory();
    opfsState = 'available';
    return root;
  } catch (error) {
    // SecurityError: the browser denies OPFS here, and will for the whole session.
    if ((error as { name?: string })?.name === 'SecurityError') {
      opfsState = 'refused';
      return null;
    }
    throw error;
  }
}

/** Which store local copies use in this tab (after the first access). */
export function localFileBackend(): 'opfs' | 'indexeddb' | 'unknown' {
  return opfsState === 'available' ? 'opfs' : opfsState === 'refused' ? 'indexeddb' : 'unknown';
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

export async function idbReadFile(name: string): Promise<Uint8Array | null> {
  const value = await withStore('readonly', (store) => store.get(name) as IDBRequest<unknown>);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export async function idbWriteFile(name: string, data: Uint8Array): Promise<void> {
  // Store a copy: the caller may reuse its buffer.
  await withStore('readwrite', (store) => store.put(data.slice(), name));
}

export async function idbDeleteFile(name: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(name));
}

/** Whether a local copy with this name exists, in whichever store this tab uses. */
export async function localFileExists(name: string): Promise<boolean> {
  try {
    const root = await getOpfsRoot();
    if (root) {
      await root.getFileHandle(name, { create: false });
      return true;
    }
    return (await idbReadFile(name)) !== null;
  } catch {
    return false;
  }
}

/** Remove every local copy kept in IndexedDB (sign-out / reset). */
export async function clearIdbFiles(): Promise<void> {
  if (!globalThis.indexedDB) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(IDB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Test hook. */
export function resetLocalFileStoreForTests(): void {
  opfsState = 'unknown';
}
