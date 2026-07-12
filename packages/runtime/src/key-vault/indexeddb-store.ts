/** Small promise-based wrapper around a single IndexedDB object store. */
export class IndexedDBStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly databaseName: string,
    private readonly version: number,
    private readonly storeName: string
  ) {}

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable'));
    }
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, this.version);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((error) => {
      this.databasePromise = null;
      throw error;
    });

    return this.databasePromise;
  }

  async get<T = unknown>(key: IDBValidKey): Promise<T | undefined> {
    const database = await this.open();
    return new Promise<T | undefined>((resolve, reject) => {
      const request = database
        .transaction(this.storeName, 'readonly')
        .objectStore(this.storeName)
        .get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
  }

  async put(key: IDBValidKey, value: unknown): Promise<void> {
    const database = await this.open();
    return this.write((store) => store.put(value, key), 'write', database);
  }

  async add(key: IDBValidKey, value: unknown): Promise<void> {
    const database = await this.open();
    return this.write((store) => store.add(value, key), 'add', database);
  }

  async delete(...keys: IDBValidKey[]): Promise<void> {
    if (keys.length === 0) return;
    const database = await this.open();
    return this.write(
      (store) => {
        for (const key of keys) store.delete(key);
      },
      'delete',
      database
    );
  }

  /** Drop a cached handle after tests or an external database deletion. */
  resetConnection(): void {
    this.databasePromise = null;
  }

  private async write(
    operation: (store: IDBObjectStore) => void,
    label: string,
    database?: IDBDatabase
  ): Promise<void> {
    const db = database ?? (await this.open());
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      operation(transaction.objectStore(this.storeName));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error(`IndexedDB ${label} aborted`));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error(`IndexedDB ${label} failed`));
    });
  }
}
