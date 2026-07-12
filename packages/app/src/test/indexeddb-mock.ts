/** Minimal in-memory IndexedDB fake for app storage tests. */
class FakeIndexedDBDatabase {
  private stores = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  } as unknown as DOMStringList;

  createObjectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return {} as IDBObjectStore;
  }

  transaction(name: string, _mode: IDBTransactionMode): IDBTransaction {
    const values = this.stores.get(name);
    if (!values) throw new Error(`missing object store: ${name}`);

    const transaction: Partial<IDBTransaction> = {};
    const complete = () =>
      queueMicrotask(() =>
        transaction.oncomplete?.call(transaction as IDBTransaction, new Event('complete'))
      );
    transaction.objectStore = () =>
      ({
        get: (key: IDBValidKey) => {
          const request: Partial<IDBRequest> = {};
          queueMicrotask(() => {
            Object.defineProperty(request, 'result', {
              configurable: true,
              value: values.get(String(key)),
            });
            request.onsuccess?.call(request as IDBRequest, new Event('success'));
          });
          return request as IDBRequest;
        },
        add: (value: unknown, key?: IDBValidKey) => {
          const request: Partial<IDBRequest> = {};
          queueMicrotask(() => {
            if (values.has(String(key))) {
              request.onerror?.call(request as IDBRequest, new Event('error'));
              transaction.onabort?.call(transaction as IDBTransaction, new Event('abort'));
              return;
            }
            values.set(String(key), value);
            request.onsuccess?.call(request as IDBRequest, new Event('success'));
            transaction.oncomplete?.call(transaction as IDBTransaction, new Event('complete'));
          });
          return request as IDBRequest;
        },
        put: (value: unknown, key?: IDBValidKey) => {
          values.set(String(key), value);
          complete();
          return {} as IDBRequest;
        },
        delete: (key: IDBValidKey) => {
          values.delete(String(key));
          complete();
          return {} as IDBRequest;
        },
      }) as IDBObjectStore;
    return transaction as IDBTransaction;
  }

  read(storeName: string, key: string): unknown {
    return this.stores.get(storeName)?.get(key);
  }
}

export class FakeIndexedDBFactory {
  private initialized = false;

  private database = new FakeIndexedDBDatabase();

  open(_name: string, _version?: number): IDBOpenDBRequest {
    const request: Partial<IDBOpenDBRequest> = {};
    queueMicrotask(() => {
      Object.defineProperty(request, 'result', {
        configurable: true,
        value: this.database as unknown as IDBDatabase,
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
    this.database = new FakeIndexedDBDatabase();
  }

  read(storeName: string, key: string): unknown {
    return this.database.read(storeName, key);
  }
}
