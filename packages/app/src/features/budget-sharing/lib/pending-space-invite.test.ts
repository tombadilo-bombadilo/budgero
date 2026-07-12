import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDBFactory } from '@/test/indexeddb-mock';
import {
  PENDING_SPACE_INVITE_KEY,
  clearPendingSpaceInvite,
  readPendingSpaceInvite,
  writePendingSpaceInvite,
} from './pending-space-invite';

describe('pending workspace invite vault', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('uses a bounded fallback, migrates legacy data, encrypts cross-tab data, and enforces expiry', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await writePendingSpaceInvite('session-secret')).toBe(false);
    expect(localStorage.getItem(PENDING_SPACE_INVITE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_SPACE_INVITE_KEY)).toContain('session-secret');
    expect(await readPendingSpaceInvite()).toBe('session-secret');
    sessionStorage.clear();

    localStorage.setItem(PENDING_SPACE_INVITE_KEY, 'legacy-without-indexeddb');
    expect(await readPendingSpaceInvite()).toBe('legacy-without-indexeddb');
    expect(localStorage.getItem(PENDING_SPACE_INVITE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_SPACE_INVITE_KEY)).toContain('legacy-without-indexeddb');
    sessionStorage.clear();

    const indexedDB = new FakeIndexedDBFactory();
    vi.stubGlobal('indexedDB', indexedDB as unknown as IDBFactory);

    localStorage.setItem(PENDING_SPACE_INVITE_KEY, 'legacy-secret');
    expect(await readPendingSpaceInvite()).toBe('legacy-secret');
    expect(localStorage.getItem(PENDING_SPACE_INVITE_KEY)).toBeNull();
    expect(JSON.stringify(indexedDB.read('vault', 'invite'))).not.toContain('legacy-secret');
    await clearPendingSpaceInvite();

    expect(await writePendingSpaceInvite('invite-secret')).toBe(true);
    expect(localStorage.getItem(PENDING_SPACE_INVITE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_SPACE_INVITE_KEY)).toBeNull();
    expect(JSON.stringify(indexedDB.read('vault', 'invite'))).not.toContain('invite-secret');
    expect(await readPendingSpaceInvite()).toBe('invite-secret');

    await clearPendingSpaceInvite();
    expect(await readPendingSpaceInvite()).toBeNull();

    expect(await writePendingSpaceInvite('expired', Date.now() - 1)).toBe(true);
    expect(await readPendingSpaceInvite()).toBeNull();
  });
});
