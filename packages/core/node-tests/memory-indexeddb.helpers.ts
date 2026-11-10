/**
 * A minimal in-memory IndexedDB: just what local-file-store uses (one object
 * store with out-of-line keys; get/put/delete/count/getAllKeys/clear;
 * deleteDatabase and databases()). Requests complete on a later task, like
 * the real thing, and values are structured-cloned on put.
 */

type Handler = ((event?: unknown) => void) | null;

interface FakeRequest<T = unknown> {
  result: T;
  error: DOMException | null;
  onsuccess: Handler;
  onerror: Handler;
  onblocked: Handler;
  onupgradeneeded: Handler;
}

export interface MemoryIndexedDb {
  indexedDB: IDBFactory;
  /** database name -> store name -> key -> value */
  databases: Map<string, Map<string, Map<IDBValidKey, unknown>>>;
  /** Connections not closed yet. */
  openConnections: () => number;
  /** How many values were read (get), to check a lookup doesn't load the file. */
  valueReads: () => number;
  /** Make the next write transactions fail with this error name. */
  failWrites: (name: string | null) => void;
  /** Make deleteDatabase() report blocked (another tab holds the database). */
  blockDeletes: (blocked: boolean) => void;
}

function request<T>(): FakeRequest<T> {
  return {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
    onupgradeneeded: null,
  };
}

const later = (fn: () => void) => setTimeout(fn, 0);

export function createMemoryIndexedDb(): MemoryIndexedDb {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  let open = 0;
  let reads = 0;
  let writeFailure: string | null = null;
  let deletesBlocked = false;

  function connection(name: string) {
    let closed = false;
    const stores = () => databases.get(name)!;
    return {
      objectStoreNames: { contains: (store: string) => stores().has(store) },
      createObjectStore: (store: string) => stores().set(store, new Map()),
      close: () => {
        if (!closed) open -= 1;
        closed = true;
      },
      transaction(storeName: string, mode: IDBTransactionMode) {
        const data = stores().get(storeName);
        if (!data) throw new DOMException(`No store ${storeName}`, 'NotFoundError');
        const tx = {
          error: null as DOMException | null,
          oncomplete: null as Handler,
          onerror: null as Handler,
          onabort: null as Handler,
          objectStore: () => store,
        };
        const run = <T>(work: () => T, writes: boolean): FakeRequest<T> => {
          const req = request<T>();
          later(() => {
            if (writes && writeFailure) {
              req.error = new DOMException('write failed', writeFailure);
              tx.error = req.error;
              req.onerror?.();
              tx.onerror?.();
              return;
            }
            req.result = work();
            req.onsuccess?.();
            tx.oncomplete?.();
          });
          return req;
        };
        const write = <T>(work: () => T) => {
          if (mode !== 'readwrite') throw new DOMException('read-only', 'ReadOnlyError');
          return run(work, true);
        };
        // put() clones the value when it is called, not when it is stored.
        const store = {
          get: (key: IDBValidKey) =>
            run(() => {
              reads += 1;
              return structuredClone(data.get(key));
            }, false),
          count: (key: IDBValidKey) => run(() => (data.has(key) ? 1 : 0), false),
          getAllKeys: () => run(() => [...data.keys()], false),
          put: (value: unknown, key: IDBValidKey) => {
            const copy = structuredClone(value);
            return write(() => {
              data.set(key, copy);
              return key;
            });
          },
          delete: (key: IDBValidKey) => write(() => void data.delete(key)),
          clear: () => write(() => void data.clear()),
        };
        return tx;
      },
    };
  }

  const factory = {
    open(name: string) {
      const req = request<ReturnType<typeof connection>>();
      later(() => {
        const created = !databases.has(name);
        if (created) databases.set(name, new Map());
        open += 1;
        req.result = connection(name);
        if (created) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name: string) {
      const req = request<undefined>();
      later(() => {
        if (deletesBlocked) {
          req.onblocked?.();
          return;
        }
        databases.delete(name);
        req.onsuccess?.();
      });
      return req;
    },
    databases: async () => [...databases.keys()].map((name) => ({ name, version: 1 })),
  };

  return {
    indexedDB: factory as unknown as IDBFactory,
    databases,
    openConnections: () => open,
    valueReads: () => reads,
    failWrites: (name) => {
      writeFailure = name;
    },
    blockDeletes: (blocked) => {
      deletesBlocked = blocked;
    },
  };
}
