import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENCRYPTION_KEY_VERSION_PREFIX, SPACE_KEY_STORAGE_PREFIX } from '../types/storage-keys';
import { KeyVault } from './key-vault';
import { masterPasswordStore } from './master-password-store';
import { generateSpaceKey, wrapSpaceKeyWithMaster } from '../crypto';
import { createStorageMock } from '../__tests__/storage-mock';
import { FakeIndexedDBFactory } from '../__tests__/indexeddb-mock';
import * as cryptoModule from '../crypto';

/**
 * `new KeyVault()` delegates master-password state to the shared
 * MasterPasswordStore singleton; reset its private state between tests.
 */
function resetSharedMasterPasswordState(): void {
  const internals = masterPasswordStore as unknown as {
    inMemoryPassword: string | null;
    indexedDBPromise: unknown;
  };
  internals.inMemoryPassword = null;
  internals.indexedDBPromise = null;
}

const ownerSpace = {
  space_id: 's1',
  display_name: 'One',
  owner_user_id: 'u1',
  role: 'owner',
  invitation_status: 'accepted',
  encrypted_space_key: '',
  created_at: '2024-01-01',
};

const memberSpace = {
  ...ownerSpace,
  space_id: 's2',
  role: 'member',
};

describe('KeyVault', () => {
  const localStorageMock = createStorageMock();
  const sessionStorageMock = createStorageMock();
  const fakeIndexedDB = new FakeIndexedDBFactory();

  function stubStorages(): void {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    vi.stubGlobal('indexedDB', fakeIndexedDB as unknown as IDBFactory);
  }

  afterEach(() => {
    resetSharedMasterPasswordState();
    localStorageMock.clear();
    sessionStorageMock.clear();
    fakeIndexedDB.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores, resolves, verifies, and clears master password', async () => {
    stubStorages();
    const vault = new KeyVault();

    await vault.store('master');
    expect(vault.getMasterPassword()).toBe('master');
    expect(vault.hasPassword()).toBe(true);
    expect(await vault.get()).toBe('master');
    expect(await vault.resolveMasterPassword()).toBe('master');
    expect(await vault.verify('master')).toBe(true);
    expect(vault.canVerifyLocally()).toBe(true);

    vault.clearSessionOnly();
    expect(vault.getMasterPassword()).toBeNull();

    await expect(vault.resolveMasterPassword()).rejects.toThrow('Master password is required');

    await vault.store('new');
    vault.clear();
    expect(vault.hasPassword()).toBe(false);
    expect(vault.getMasterPassword()).toBeNull();
  });

  it('normalizes persistence setting and reads session cache', async () => {
    stubStorages();
    const vault = new KeyVault();

    vault.setPersistenceSetting({ mode: 'session', days: 100 });
    expect(vault.getPersistenceSetting()).toEqual({ mode: 'session', days: 30 });

    await vault.store('master');

    // Simulate a fresh context: the session cache must be readable again.
    resetSharedMasterPasswordState();
    const next = new KeyVault();
    expect(await next.resolveMasterPassword()).toBe('master');
    expect(await next.get()).toBe('master');

    // corrupt cache is ignored (reset the IndexedDB record so only the
    // corrupt legacy sessionStorage entry remains)
    fakeIndexedDB.reset();
    sessionStorage.setItem('master_password_session_cache_v1', '{bad}');
    resetSharedMasterPasswordState();
    const broken = new KeyVault();
    broken.setPersistenceSetting({ mode: 'session', days: 2 });
    expect(await broken.get()).toBeNull();
  });

  it('handles encryption key version persistence', () => {
    stubStorages();
    const vault = new KeyVault();
    expect(vault.getEncryptionKeyVersion('s1')).toBe(1);

    vault.setEncryptionKeyVersion('s1', 7);
    expect(vault.getEncryptionKeyVersion('s1')).toBe(7);

    localStorageMock.setItem(`${ENCRYPTION_KEY_VERSION_PREFIX}s1`, 'bad');
    expect(vault.getEncryptionKeyVersion('s1')).toBe(1);
  });

  it('ensures key from wrapped server key and exports passphrase', async () => {
    stubStorages();
    const vault = new KeyVault();
    const key = generateSpaceKey();
    const wrapped = await wrapSpaceKeyWithMaster(key, 'master');

    const spaces = [{ ...ownerSpace, encrypted_space_key: wrapped }];
    const resolved = await vault.ensureSpaceKey('s1', 'master', spaces);

    expect(resolved).toEqual(key);
    expect(vault.getSpaceKey('s1')).toEqual(key);
    expect(vault.getSpacePassphrase('s1')).toBeTruthy();
    expect(vault.exportSpaceKey('s1')).toBe(vault.getSpacePassphrase('s1'));
  });

  it('generates owner key and tolerates upload failures', async () => {
    stubStorages();
    const uploadEncryptedKey = vi.fn(async () => {
      throw new Error('offline');
    });
    const vault = new KeyVault({ uploadEncryptedKey });

    const key = await vault.ensureSpaceKey('s1', 'master', [ownerSpace]);

    expect(key.length).toBe(32);
    expect(vault.getSpacePassphrase('s1')).toBeTruthy();
    expect(uploadEncryptedKey).toHaveBeenCalledTimes(1);
  });

  it('rejects missing share for non-owner and unavailable workspace', async () => {
    stubStorages();
    const vault = new KeyVault();

    await expect(vault.ensureSpaceKey('missing', 'master', [ownerSpace])).rejects.toThrow(
      'Workspace not available'
    );

    await expect(vault.ensureSpaceKey('s2', 'master', [memberSpace])).rejects.toThrow(
      'Workspace owner has not shared access yet.'
    );
  });

  it('prunes key maps to active spaces', async () => {
    stubStorages();
    const vault = new KeyVault();
    await vault.ensureSpaceKey('s1', 'master', [ownerSpace]);
    await vault.ensureSpaceKey('s2', 'master', [{ ...ownerSpace, space_id: 's2' }]);

    vault.pruneKeys(['s1']);

    expect(vault.getSpaceKey('s1')).not.toBeNull();
    expect(vault.getSpaceKey('s2')).toBeNull();
  });

  it('migrates legacy shared key from localStorage to session storage', async () => {
    stubStorages();
    const key = generateSpaceKey();
    const encoded = btoa(String.fromCharCode(...Array.from(key)));

    localStorageMock.setItem(
      'master_password_persistence_v1',
      JSON.stringify({ mode: 'session', days: 1 })
    );
    localStorageMock.setItem(`${SPACE_KEY_STORAGE_PREFIX}s1`, encoded);

    const vault = new KeyVault();
    const loaded = await vault.ensureSpaceKey('s1', 'master', [
      { ...ownerSpace, encrypted_space_key: '' },
    ]);

    expect(loaded).toEqual(key);
    expect(localStorageMock.getItem(`${SPACE_KEY_STORAGE_PREFIX}s1`)).toBeNull();
    const persisted = sessionStorageMock.getItem(`${SPACE_KEY_STORAGE_PREFIX}s1`);
    expect(persisted).toMatch(/^enc1:/);
    expect(persisted).not.toContain(encoded);

    // A fresh vault restores the key from the encrypted token.
    const fresh = new KeyVault();
    const reloaded = await fresh.ensureSpaceKey('s1', 'master', [
      { ...ownerSpace, encrypted_space_key: '' },
    ]);
    expect(reloaded).toEqual(key);
  });

  it('normalizes decryption failures and handles provisioning lock concurrency', async () => {
    stubStorages();
    const key = generateSpaceKey();
    const wrapped = await wrapSpaceKeyWithMaster(key, 'correct');
    const vault = new KeyVault();

    await expect(
      vault.ensureSpaceKey('s1', 'wrong', [{ ...ownerSpace, encrypted_space_key: wrapped }])
    ).rejects.toThrow();

    const vault2 = new KeyVault();
    const provisionSpy = vi
      .spyOn(
        vault2 as unknown as { provisionSpaceKey: (...args: unknown[]) => Promise<Uint8Array> },
        'provisionSpaceKey'
      )
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const generated = new Uint8Array([1, 2, 3, 4]);
        (vault2 as unknown as { spaceKeys: Map<string, Uint8Array> }).spaceKeys.set(
          's1',
          generated
        );
        return generated;
      });

    const p1 = vault2.ensureSpaceKey('s1', 'master', [ownerSpace]);
    const p2 = vault2.ensureSpaceKey('s1', 'master', [ownerSpace]);
    const [k1, k2] = await Promise.all([p1, p2]);

    expect(k1).toEqual(k2);
    expect(provisionSpy).toHaveBeenCalledTimes(1);
  });

  it('clears stale shared-key caches when persistence mode is memory', async () => {
    stubStorages();
    const key = generateSpaceKey();
    const encoded = btoa(String.fromCharCode(...Array.from(key)));
    localStorageMock.setItem(`${SPACE_KEY_STORAGE_PREFIX}s1`, encoded);
    sessionStorageMock.setItem(`${SPACE_KEY_STORAGE_PREFIX}s1`, encoded);
    localStorageMock.setItem('master_password_persistence_v1', JSON.stringify({ mode: 'memory' }));

    const vault = new KeyVault();
    const loaded = await (
      vault as unknown as {
        loadStoredSpaceKeyByKey: (storageKey: string) => Promise<Uint8Array | null>;
      }
    ).loadStoredSpaceKeyByKey(`${SPACE_KEY_STORAGE_PREFIX}s1`);

    expect(loaded).toBeNull();
    expect(localStorageMock.getItem(`${SPACE_KEY_STORAGE_PREFIX}s1`)).toBeNull();
    expect(sessionStorageMock.getItem(`${SPACE_KEY_STORAGE_PREFIX}s1`)).toBeNull();
  });

  it('handles malformed cache payloads and storage exceptions defensively', async () => {
    const brokenStorage = {
      getItem: () => '{"password":"x","expiresAt":0}',
      setItem: () => {
        throw new Error('write fail');
      },
      removeItem: () => {
        throw new Error('remove fail');
      },
      clear: () => undefined,
      key: () => null,
      get length() {
        return 0;
      },
    };
    vi.stubGlobal('localStorage', brokenStorage as unknown as Storage);
    vi.stubGlobal('sessionStorage', brokenStorage as unknown as Storage);

    const vault = new KeyVault();
    expect(await vault.get()).toBeNull();

    expect(
      (
        vault as unknown as {
          decodeStoredSpaceKey: (encoded: string) => Uint8Array | null;
        }
      ).decodeStoredSpaceKey('%%%')
    ).toBeNull();

    expect(
      (
        vault as unknown as {
          removeSpaceKeyFromStorage: (storageType: 'local' | 'session', key: string) => void;
        }
      ).removeSpaceKeyFromStorage('local', 'k')
    ).toBeUndefined();
  });

  it('covers storage failure branches and cached password/key fast paths', async () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('get fail');
      },
      setItem: () => {
        throw new Error('set fail');
      },
      removeItem: () => {
        throw new Error('remove fail');
      },
      clear: () => undefined,
      key: () => null,
      get length() {
        return 0;
      },
    };
    vi.stubGlobal('localStorage', throwingStorage as unknown as Storage);
    vi.stubGlobal('sessionStorage', createStorageMock() as unknown as Storage);

    const vault = new KeyVault();
    vault.setPersistenceSetting({ mode: 'memory' });
    await vault.store('master');
    expect(vault.hasPassword()).toBe(false);
    expect(await vault.verify('master')).toBe(true);
    vault.clear();
    expect(vault.getEncryptionKeyVersion('s1')).toBe(1);
    expect(() => vault.setEncryptionKeyVersion('s1', 5)).not.toThrow();
    expect(await vault.verify('x')).toBe(false);

    const cachedVault = new KeyVault();
    (
      cachedVault as unknown as {
        spaceKeys: Map<string, Uint8Array>;
      }
    ).spaceKeys.set('s1', new Uint8Array([9, 8, 7]));
    const cached = await cachedVault.ensureSpaceKey('s1', 'master', [ownerSpace]);
    expect(Array.from(cached)).toEqual([9, 8, 7]);
    expect(cachedVault.getSpacePassphrase('s1')).toBeTruthy();
  });

  it('handles session cache parsing branches and cache-clearing loops', async () => {
    stubStorages();
    localStorageMock.setItem('master_password_status', 'true');
    localStorageMock.setItem(
      'master_password_persistence_v1',
      JSON.stringify({ mode: 'session', days: 1 })
    );
    const vault = new KeyVault();

    sessionStorageMock.setItem('master_password_session_cache_v1', JSON.stringify({ nope: true }));
    expect(await vault.get()).toBeNull();

    sessionStorageMock.setItem(
      'master_password_session_cache_v1',
      JSON.stringify({ password: 'x', expiresAt: Date.now() - 10 })
    );
    expect(await vault.get()).toBeNull();

    sessionStorageMock.setItem('master_password_session_cache_v1', 'not-json');
    expect(await vault.get()).toBeNull();

    sessionStorageMock.setItem(`${SPACE_KEY_STORAGE_PREFIX}s1`, 'abc');
    localStorageMock.setItem(`${SPACE_KEY_STORAGE_PREFIX}s2`, 'def');
    vault.clearSessionOnly();
    // clearSessionOnly clears persisted state asynchronously (fire-and-forget)
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionStorageMock.getItem(`${SPACE_KEY_STORAGE_PREFIX}s1`)).toBeNull();
    expect(localStorageMock.getItem(`${SPACE_KEY_STORAGE_PREFIX}s2`)).toBeNull();
  });

  it('wraps recognized decryption errors for shared space keys', async () => {
    stubStorages();
    const unwrapSpy = vi
      .spyOn(cryptoModule, 'unwrapSpaceKeyWithMaster')
      .mockRejectedValue(new DOMException('bad', 'OperationError'));

    const vault = new KeyVault();
    await expect(
      vault.ensureSpaceKey('s1', 'master', [{ ...ownerSpace, encrypted_space_key: 'wrapped' }])
    ).rejects.toThrow('Decryption failed');

    unwrapSpy.mockRestore();
  });

  it('covers private storage helper catch branches', async () => {
    const badSession = {
      getItem: () => {
        throw new Error('get');
      },
      setItem: () => {
        throw new Error('set');
      },
      removeItem: () => {
        throw new Error('remove');
      },
      clear: () => undefined,
      key: () => {
        throw new Error('key');
      },
      get length() {
        return 1;
      },
    };
    const badLocal = { ...badSession };
    vi.stubGlobal('sessionStorage', badSession as unknown as Storage);
    vi.stubGlobal('localStorage', badLocal as unknown as Storage);

    const vault = new KeyVault();

    expect(
      await (
        vault as unknown as {
          readSpaceKeyFromStorage(
            storageType: 'session' | 'local',
            storageKey: string
          ): Promise<Uint8Array | null>;
        }
      ).readSpaceKeyFromStorage('session', 'k')
    ).toBeNull();

    expect(
      (
        vault as unknown as {
          writeSpaceKeyToStorage(
            storageType: 'session' | 'local',
            storageKey: string,
            encoded: string
          ): void;
        }
      ).writeSpaceKeyToStorage('local', 'k', 'v')
    ).toBeUndefined();

    expect(() => {
      (
        masterPasswordStore as unknown as {
          clearSpaceKeyCaches(): void;
        }
      ).clearSpaceKeyCaches();
    }).not.toThrow();

    await expect(
      (
        vault as unknown as {
          persistStoredSpaceKeyByKey(storageKey: string, spaceKey: Uint8Array): Promise<void>;
        }
      ).persistStoredSpaceKeyByKey(`${SPACE_KEY_STORAGE_PREFIX}s1`, new Uint8Array([1, 2, 3]))
    ).resolves.toBeUndefined();
  });

  it('covers undefined-storage and non-Error branches for key persistence', async () => {
    vi.stubGlobal('localStorage', undefined as unknown as Storage);
    vi.stubGlobal('sessionStorage', undefined as unknown as Storage);
    const vault = new KeyVault({
      uploadEncryptedKey: async () => {
        throw 'upload failed';
      },
    });

    expect(vault.getEncryptionKeyVersion('s1')).toBe(1);
    expect(vault.getSpacePassphrase('missing')).toBeNull();
    vault.setPersistenceSetting({ mode: 'session', days: Number.POSITIVE_INFINITY });
    await vault.store('master');
    expect(await vault.get()).toBe('master');

    await expect(
      vault.ensureSpaceKey('s1', 'master', [{ ...ownerSpace, encrypted_space_key: '' }])
    ).resolves.toBeInstanceOf(Uint8Array);

    expect(
      (
        vault as unknown as {
          writeSpaceKeyToStorage(
            storageType: 'session' | 'local',
            storageKey: string,
            encoded: string
          ): void;
        }
      ).writeSpaceKeyToStorage('session', 'k', 'v')
    ).toBeUndefined();
    expect(
      (
        vault as unknown as {
          removeSpaceKeyFromStorage(storageType: 'session' | 'local', storageKey: string): void;
        }
      ).removeSpaceKeyFromStorage('local', 'k')
    ).toBeUndefined();
  });
});
