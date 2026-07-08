import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { WebDatabaseAdapter } from '../web-adapter.js';
import type { LocalPersistenceCipher } from '../interface.js';

vi.mock('../migrations.js', () => ({
  MigrationRunner: class {
    runMigrations(): void {
      // Empty mock implementation
    }
  },
}));

describe('WebDatabaseAdapter local persistence', () => {
  let originalWindow: typeof globalThis.window | undefined;
  let originalNavigator: typeof globalThis.navigator | undefined;

  beforeEach(() => {
    originalWindow = globalThis.window;
    originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'window', {
      value: { budgero: { desktop: false } },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    } else {
      delete (globalThis as Record<string, unknown>).navigator;
    }
    vi.restoreAllMocks();
  });

  it('writes encrypted bytes to OPFS when saving publicly', async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const encrypted = new Uint8Array([9, 9, 9]);
    const writes: Uint8Array[] = [];

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          async getDirectory() {
            return {
              async getFileHandle() {
                return {
                  async createWritable() {
                    return {
                      async write(blob: Blob) {
                        const buffer = await blob.arrayBuffer();
                        writes.push(new Uint8Array(buffer));
                      },
                      async close() {
                        // Empty mock implementation
                      },
                    };
                  },
                };
              },
            };
          },
        },
      },
      writable: true,
      configurable: true,
    });

    const adapter = Object.create(WebDatabaseAdapter.prototype) as WebDatabaseAdapter & {
      backup: () => Uint8Array;
    };

    // Access private properties for testing using type assertion
    const adapterInternal = adapter as unknown as {
      dbFilename: string;
      localPersistenceCipher: {
        encrypt: Mock<
          Parameters<LocalPersistenceCipher['encrypt']>,
          ReturnType<LocalPersistenceCipher['encrypt']>
        >;
        decrypt: Mock<
          Parameters<LocalPersistenceCipher['decrypt']>,
          ReturnType<LocalPersistenceCipher['decrypt']>
        >;
      };
    };
    adapterInternal.dbFilename = 'test.db';
    adapter.backup = vi.fn(() => plaintext);
    adapterInternal.localPersistenceCipher = {
      encrypt: vi.fn(async (_data: Uint8Array) => encrypted),
      decrypt: vi.fn(async (_data: Uint8Array) => ({
        decrypted: new Uint8Array(),
        wasEncrypted: false,
      })),
    };

    await adapter.saveToOPFSPublic();

    expect(adapter.backup).toHaveBeenCalledTimes(1);
    expect(adapterInternal.localPersistenceCipher.encrypt).toHaveBeenCalledWith(plaintext);
    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0])).toEqual(Array.from(encrypted));
  });

  it('forces a save after plaintext local bytes are detected', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4]);
    // Type assertion needed to access private static methods for testing
    type WebDatabaseAdapterPrivate = typeof WebDatabaseAdapter & {
      loadSqlJs: () => Promise<unknown>;
      loadFromOPFS: () => Promise<Uint8Array | null>;
    };
    const loadSqlJsSpy = vi
      .spyOn(WebDatabaseAdapter as unknown as WebDatabaseAdapterPrivate, 'loadSqlJs')
      .mockResolvedValue({
        Database: class {
          exec(sql: string) {
            if (sql === 'PRAGMA foreign_keys') {
              return [{ values: [[1]] }];
            }
            return [];
          }
        },
      });
    const loadFromOPFSSpy = vi
      .spyOn(WebDatabaseAdapter as unknown as WebDatabaseAdapterPrivate, 'loadFromOPFS')
      .mockResolvedValue(plaintext);
    const forceSaveSpy = vi.spyOn(WebDatabaseAdapter.prototype, 'forceSave').mockResolvedValue();

    await WebDatabaseAdapter.create(undefined, {
      localPersistence: {
        encrypt: vi.fn(async (data: Uint8Array) => data),
        decrypt: vi.fn(async () => ({ decrypted: plaintext, wasEncrypted: false })),
      },
    });

    expect(loadSqlJsSpy).toHaveBeenCalledTimes(1);
    expect(loadFromOPFSSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces decryption failures from local persistence cipher', async () => {
    const decryptError = new Error('Decryption failed: invalid master password or corrupted data');
    // Type assertion needed to access private static methods for testing
    type WebDatabaseAdapterPrivate = typeof WebDatabaseAdapter & {
      loadSqlJs: () => Promise<unknown>;
      loadFromOPFS: () => Promise<Uint8Array | null>;
    };
    vi.spyOn(
      WebDatabaseAdapter as unknown as WebDatabaseAdapterPrivate,
      'loadSqlJs'
    ).mockResolvedValue({
      Database: class {
        // Empty mock class
      },
    });
    vi.spyOn(
      WebDatabaseAdapter as unknown as WebDatabaseAdapterPrivate,
      'loadFromOPFS'
    ).mockResolvedValue(new Uint8Array([9, 9]));

    await expect(
      WebDatabaseAdapter.create(undefined, {
        localPersistence: {
          encrypt: vi.fn(),
          decrypt: vi.fn(async () => {
            throw decryptError;
          }),
        },
      })
    ).rejects.toThrow('Decryption failed: invalid master password or corrupted data');
  });
});
