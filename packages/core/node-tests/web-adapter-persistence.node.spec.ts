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

  it('saves through the worker writer when the browser has no createWritable (Safari < 26)', async () => {
    const posted: { filename: string; size: number }[] = [];
    const { __setOpfsWorkerFactoryForTests } = await import('../src/database/opfs-sync-writer');
    const w = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null,
      terminate: vi.fn(),
      postMessage(message: unknown) {
        const msg = message as { id: number; filename: string; buffer: ArrayBuffer };
        posted.push({ filename: msg.filename, size: msg.buffer.byteLength });
        queueMicrotask(() => w.onmessage?.({ data: { id: msg.id, ok: true } } as MessageEvent));
      },
    };
    __setOpfsWorkerFactoryForTests(() => w);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          async getDirectory() {
            return {
              // Safari 18: the handle exists, createWritable does not.
              async getFileHandle() {
                return {};
              },
            };
          },
        },
      },
      writable: true,
      configurable: true,
    });
    const adapter = createAdapterStub(async () => new Uint8Array([1, 2, 3, 4]), {
      encrypt: vi.fn(async (data: Uint8Array) => data),
      decrypt: vi.fn(async () => ({ decrypted: new Uint8Array(), wasEncrypted: false })),
    });

    await adapter.saveToOPFSPublic();

    expect(posted).toEqual([{ filename: 'test.db', size: 4 }]);
    __setOpfsWorkerFactoryForTests(null);
  });

  describe('Firefox: one writer per file', () => {
    /** OPFS like Firefox: a second createWritable() while one is open throws. */
    function mockExclusiveOPFS(options: { busyAttempts?: number } = {}) {
      let open = false;
      let busy = options.busyAttempts ?? 0;
      const file = { data: new Uint8Array() };
      const busyError = () =>
        Object.assign(new Error('file is locked'), { name: 'NoModificationAllowedError' });
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          storage: {
            async getDirectory() {
              return {
                async getFileHandle() {
                  return {
                    async createWritable() {
                      if (busy > 0) {
                        busy -= 1;
                        throw busyError();
                      }
                      if (open) throw busyError();
                      open = true;
                      let pending = new Uint8Array();
                      return {
                        async write(chunk: Blob) {
                          await new Promise((resolve) => setTimeout(resolve, 5));
                          pending = new Uint8Array(await chunk.arrayBuffer());
                        },
                        async close() {
                          file.data = pending;
                          open = false;
                        },
                        async abort() {
                          open = false;
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
      return file;
    }

    const plainCipher: LocalPersistenceCipher = {
      encrypt: vi.fn(async (data: Uint8Array) => data),
      decrypt: vi.fn(async () => ({ decrypted: new Uint8Array(), wasEncrypted: false })),
    };

    it('saves overlapping in call order instead of failing the second one', async () => {
      const file = mockExclusiveOPFS();
      let next = 1;
      const adapter = createAdapterStub(() => new Uint8Array([next++]), plainCipher);

      // A restore's save overlapping the debounced save (2026-11-01, Firefox 115).
      await Promise.all([
        adapter.saveToOPFSPublic(),
        adapter.saveToOPFSPublic(),
        adapter.saveToOPFSPublic(),
      ]);

      expect(Array.from(file.data)).toEqual([3]);
    });

    it('retries while another tab holds the file', async () => {
      const file = mockExclusiveOPFS({ busyAttempts: 2 });
      const adapter = createAdapterStub(() => new Uint8Array([9]), plainCipher);
      await adapter.saveToOPFSPublic();
      expect(Array.from(file.data)).toEqual([9]);
    });

    it('gives up with the original error when the file stays busy', async () => {
      mockExclusiveOPFS({ busyAttempts: 99 });
      const adapter = createAdapterStub(() => new Uint8Array([9]), plainCipher);
      await expect(adapter.saveToOPFSPublic()).rejects.toMatchObject({
        name: 'NoModificationAllowedError',
      });
    }, 10_000);
  });
});
