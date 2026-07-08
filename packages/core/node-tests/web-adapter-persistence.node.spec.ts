import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebDatabaseAdapter } from '../src/database/web-adapter.js';
import type { LocalPersistenceCipher } from '../src/database/interface.js';

vi.mock('../src/database/migrations.js', () => ({
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

  function mockOPFS() {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          async getDirectory() {
            return {
              async getFileHandle() {
                return {
                  async createWritable() {
                    return {
                      async write() {
                        // Empty mock implementation
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
  }

  function createAdapterStub(
    backup: (() => Uint8Array) | (() => Promise<Uint8Array>),
    cipher: LocalPersistenceCipher
  ) {
    const adapter = Object.create(WebDatabaseAdapter.prototype) as WebDatabaseAdapter & {
      backup: typeof backup;
    };
    const adapterInternal = adapter as unknown as {
      dbFilename: string;
      localPersistenceCipher: LocalPersistenceCipher;
    };
    adapterInternal.dbFilename = 'test.db';
    adapter.backup = backup;
    adapterInternal.localPersistenceCipher = cipher;
    return adapter;
  }

  it('encrypts actual bytes when backup is overridden to async', async () => {
    const plaintext = new Uint8Array([10, 20, 30]);
    const encrypted = new Uint8Array([7, 7, 7]);
    let encryptInput: unknown = null;

    mockOPFS();

    const adapter = createAdapterStub(
      // Async backup — same as runtime-bridge does
      async () => plaintext,
      {
        encrypt: vi.fn(async (data: Uint8Array) => {
          encryptInput = data;
          return encrypted;
        }),
        decrypt: vi.fn(async () => ({
          decrypted: new Uint8Array(),
          wasEncrypted: false,
        })),
      }
    );

    await adapter.saveToOPFSPublic();

    // encrypt must receive the actual Uint8Array, not a Promise object.
    // If saveToOPFSPublic doesn't await backup(), this fails.
    expect(encryptInput).toBeInstanceOf(Uint8Array);
    expect(Array.from(encryptInput as Uint8Array)).toEqual([10, 20, 30]);
  });
});
