/**
 * Minimal in-memory IndexedDB fake covering the API surface used by
 * MasterPasswordStore's session cache: open/onupgradeneeded/onsuccess,
 * createObjectStore, transaction().objectStore(), get/put/delete with
 * request.onsuccess and tx.oncomplete callbacks.
 */

class FakeIndexedDBDatabase {
  private stores = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  } as unknown as DOMStringList;

  createObjectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map<string, unknown>());
    }
    return {} as IDBObjectStore;
  }

  transaction(name: string, _mode: IDBTransactionMode): IDBTransaction {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`missing object store: ${name}`);
    }

    const tx: Partial<IDBTransaction> & { objectStore: (storeName: string) => IDBObjectStore } = {
      objectStore: () => {
        const objectStore: Partial<IDBObjectStore> = {
          get: (key: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              Object.defineProperty(request, 'result', {
                configurable: true,
                value: store.get(String(key)),
              });
              request.onsuccess?.call(
                request as IDBRequest,
                new Event('success') as Event & { target: IDBRequest }
              );
            });
            return request as IDBRequest;
          },
          add: (value: unknown, key?: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              if (store.has(String(key))) {
                // Real IndexedDB aborts the transaction on key collision.
                request.onerror?.call(
                  request as IDBRequest,
                  new Event('error') as Event & { target: IDBRequest }
                );
                tx.onabort?.call(tx as IDBTransaction, new Event('abort'));
                return;
              }
              store.set(String(key), value);
              request.onsuccess?.call(
                request as IDBRequest,
                new Event('success') as Event & { target: IDBRequest }
              );
              tx.oncomplete?.call(tx as IDBTransaction, new Event('complete'));
            });
            return request as IDBRequest;
          },
          put: (value: unknown, key?: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              store.set(String(key), value);
              request.onsuccess?.call(
                request as IDBRequest,
                new Event('success') as Event & { target: IDBRequest }
              );
              tx.oncomplete?.call(tx as IDBTransaction, new Event('complete'));
            });
            return request as IDBRequest;
          },
          delete: (key: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              store.delete(String(key));
              request.onsuccess?.call(
                request as IDBRequest,
                new Event('success') as Event & { target: IDBRequest }
              );
              tx.oncomplete?.call(tx as IDBTransaction, new Event('complete'));
            });
            return request as IDBRequest;
          },
        };
        return objectStore as IDBObjectStore;
      },
    };

    return tx as IDBTransaction;
  }

  read(storeName: string, key: string): unknown {
    return this.stores.get(storeName)?.get(key);
  }

  write(storeName: string, key: string, value: unknown): void {
    if (!this.stores.has(storeName)) {
      this.stores.set(storeName, new Map<string, unknown>());
    }
    this.stores.get(storeName)!.set(key, value);
  }
}

export class FakeIndexedDBFactory {
  private initialized = false;

  private db = new FakeIndexedDBDatabase();

  open(_name: string, _version?: number): IDBOpenDBRequest {
    const request: Partial<IDBOpenDBRequest> = {};
    queueMicrotask(() => {
      Object.defineProperty(request, 'result', {
        configurable: true,
        value: this.db as unknown as IDBDatabase,
      });
      if (!this.initialized) {
        this.initialized = true;
        request.onupgradeneeded?.call(
          request as IDBOpenDBRequest,
          new Event('upgradeneeded') as IDBVersionChangeEvent
        );
      }
      request.onsuccess?.call(request as IDBOpenDBRequest, new Event('success'));
    });
    return request as IDBOpenDBRequest;
  }

  reset(): void {
    this.initialized = false;
    this.db = new FakeIndexedDBDatabase();
  }

  read(storeName: string, key: string): unknown {
    return this.db.read(storeName, key);
  }

  write(storeName: string, key: string, value: unknown): void {
    this.db.write(storeName, key, value);
  }
}
