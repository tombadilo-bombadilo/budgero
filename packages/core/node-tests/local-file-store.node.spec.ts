import { afterEach, describe, expect, it } from 'vitest';
import {
  getOpfsRoot,
  localFileBackend,
  resetLocalFileStoreForTests,
} from '../src/database/local-file-store.js';

const original = globalThis.navigator;
function stubStorage(getDirectory: () => Promise<unknown>) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: { getDirectory } },
    configurable: true,
  });
}

afterEach(() => {
  resetLocalFileStoreForTests();
  Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
});

describe('local file store', () => {
  it('uses OPFS when the browser allows it', async () => {
    const root = {};
    stubStorage(async () => root);
    expect(await getOpfsRoot()).toBe(root);
    expect(localFileBackend()).toBe('opfs');
  });

  it('falls back for the session when OPFS is refused (Firefox private window)', async () => {
    let calls = 0;
    stubStorage(async () => {
      calls += 1;
      throw new DOMException('Security error when calling GetDirectory', 'SecurityError');
    });
    expect(await getOpfsRoot()).toBeNull();
    expect(await getOpfsRoot()).toBeNull();
    expect(calls).toBe(1);
    expect(localFileBackend()).toBe('indexeddb');
  });

  it('still surfaces other OPFS failures', async () => {
    stubStorage(async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await expect(getOpfsRoot()).rejects.toThrow('quota');
  });
});
