import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_SPACE_STORAGE, SPACE_CACHE_STORAGE } from '../types/storage-keys';
import { SpaceRegistry } from './space-registry';
import { createStorageMock } from '../__tests__/storage-mock';

const spaces = [
  {
    space_id: 's1',
    display_name: 'One',
    owner_user_id: 'u1',
    role: 'owner',
    invitation_status: 'accepted',
    encrypted_space_key: 'k1',
    created_at: '2024-01-01',
  },
  {
    space_id: 's2',
    display_name: 'Two',
    owner_user_id: 'u2',
    role: 'editor',
    invitation_status: 'accepted',
    encrypted_space_key: 'k2',
    created_at: '2024-01-01',
  },
];

describe('SpaceRegistry', () => {
  const localStorageMock = createStorageMock();

  function storage(): Storage {
    return localStorageMock as unknown as Storage;
  }

  afterEach(() => {
    localStorageMock.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks active space and available spaces', () => {
    vi.stubGlobal('localStorage', storage());
    const reg = new SpaceRegistry();
    const activeSpy = vi.fn();
    const listSpy = vi.fn();

    const off1 = reg.onActiveSpaceChange(activeSpy);
    const off2 = reg.onAvailableSpacesChange(listSpy);

    reg.setAvailableSpaces(spaces);
    reg.setActiveSpaceId('s1');

    expect(reg.getActiveSpaceId()).toBe('s1');
    expect(reg.getSpace('s1')?.display_name).toBe('One');
    expect(reg.isSpaceAvailable('s2')).toBe(true);
    expect(localStorageMock.getItem(SPACE_CACHE_STORAGE)).toContain('s1');
    expect(localStorageMock.getItem(ACTIVE_SPACE_STORAGE)).toBe('s1');

    off1();
    off2();
    reg.setActiveSpaceId('s2');
    expect(activeSpy).toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('updates encrypted key and notifies', () => {
    vi.stubGlobal('localStorage', storage());
    const reg = new SpaceRegistry();
    reg.setAvailableSpaces(spaces);
    reg.setActiveSpaceId('s1');

    const activeSpy = vi.fn();
    const listSpy = vi.fn();
    reg.onActiveSpaceChange(activeSpy);
    reg.onAvailableSpacesChange(listSpy);

    reg.updateSpaceEncryptedKey('s1', 'new-key');

    expect(reg.getSpace('s1')?.encrypted_space_key).toBe('new-key');
    expect(activeSpy).toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalled();
  });

  it('resolves initial space with default/cache/profile/first fallback', () => {
    vi.stubGlobal('localStorage', storage());
    const reg = new SpaceRegistry();

    localStorageMock.setItem('budgero_default_space_v1', 's2');
    expect(reg.resolveInitialSpace(spaces)?.space_id).toBe('s2');

    localStorageMock.setItem('budgero_default_space_v1', 'missing');
    localStorageMock.setItem(ACTIVE_SPACE_STORAGE, 's1');
    expect(reg.resolveInitialSpace(spaces)?.space_id).toBe('s1');

    localStorageMock.removeItem(ACTIVE_SPACE_STORAGE);
    expect(reg.resolveInitialSpace(spaces, 's2')?.space_id).toBe('s2');

    expect(reg.resolveInitialSpace(spaces, 'missing')?.space_id).toBe('s1');
  });

  it('loads cached summaries safely', () => {
    vi.stubGlobal('localStorage', storage());
    const reg = new SpaceRegistry();
    expect(reg.loadCachedSpaceSummaries()).toBeNull();

    localStorageMock.setItem(SPACE_CACHE_STORAGE, JSON.stringify(spaces));
    expect(reg.loadCachedSpaceSummaries()?.length).toBe(2);

    localStorageMock.setItem(SPACE_CACHE_STORAGE, 'not json');
    expect(reg.loadCachedSpaceSummaries()).toBeNull();
  });

  it('handles missing localStorage and listener failures', () => {
    vi.stubGlobal('localStorage', undefined as unknown as Storage);
    const reg = new SpaceRegistry();
    const off = reg.onActiveSpaceChange(() => {
      throw new Error('active listener fail');
    });
    reg.onAvailableSpacesChange(() => {
      throw new Error('list listener fail');
    });

    expect(() => reg.setActiveSpaceId('s1')).not.toThrow();
    expect(() => reg.setAvailableSpaces(spaces)).not.toThrow();
    expect(reg.loadCachedSpaceSummaries()).toBeNull();
    expect(reg.resolveInitialSpace(spaces, 's2')?.space_id).toBe('s2');
    off();
  });

  it('covers persistence catch branches and default-space cleanup branch', () => {
    const throwingStorage = {
      getItem: vi.fn((key: string) => {
        if (key === 'budgero_default_space_v1') return '   ';
        throw new Error('get failed');
      }),
      setItem: vi.fn(() => {
        throw new Error('set failed');
      }),
      removeItem: vi.fn(() => {
        throw new Error('remove failed');
      }),
      clear: vi.fn(),
      key: vi.fn(() => null),
      get length() {
        return 0;
      },
    };
    vi.stubGlobal('localStorage', throwingStorage as unknown as Storage);
    const reg = new SpaceRegistry();
    const listener = vi.fn(() => {
      throw new Error('listener fail');
    });
    reg.onActiveSpaceChange(listener);

    expect(reg.resolveInitialSpace(spaces, null)?.space_id).toBe('s1');
    expect(() => reg.notifyActiveSpaceChange('s1')).not.toThrow();
    expect(() => reg.notifyAvailableSpacesChange()).not.toThrow();
    expect(reg.loadCachedSpaceSummaries()).toBeNull();
  });

  it('covers storage parse/non-array and throw branches in persistence helpers', () => {
    const storageWithThrows = {
      getItem: vi.fn((key: string) => {
        if (key === SPACE_CACHE_STORAGE) return JSON.stringify({ bad: true });
        if (key === 'budgero_default_space_v1') return 'missing';
        return null;
      }),
      setItem: vi.fn(() => {
        throw new Error('set fail');
      }),
      removeItem: vi.fn(() => {
        throw new Error('remove fail');
      }),
      clear: vi.fn(),
      key: vi.fn(() => null),
      get length() {
        return 0;
      },
    };
    vi.stubGlobal('localStorage', storageWithThrows as unknown as Storage);
    const reg = new SpaceRegistry();

    expect(reg.loadCachedSpaceSummaries()).toBeNull();
    expect(() => reg.setAvailableSpaces(spaces)).not.toThrow();
    expect(() => reg.setActiveSpaceId('s1')).not.toThrow();
    expect(reg.resolveInitialSpace(spaces)?.space_id).toBe('s1');
  });

  it('covers getStoredDefault catch and clearStoredDefault undefined-storage branch', () => {
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('get failed');
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      get length() {
        return 0;
      },
    };
    vi.stubGlobal('localStorage', throwingStorage as unknown as Storage);
    const reg = new SpaceRegistry();
    expect(reg.resolveInitialSpace(spaces, 's2')?.space_id).toBe('s2');

    vi.stubGlobal('localStorage', undefined as unknown as Storage);
    expect(
      (
        reg as unknown as {
          clearStoredDefaultSpaceId(): void;
        }
      ).clearStoredDefaultSpaceId()
    ).toBeUndefined();
  });
});
