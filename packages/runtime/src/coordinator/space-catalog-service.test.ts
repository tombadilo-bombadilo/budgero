import { describe, expect, it, vi } from 'vitest';
import { SpaceCatalogService } from './space-catalog-service';

const accepted = {
  space_id: 's1',
  display_name: 'One',
  owner_user_id: 'u1',
  role: 'owner',
  invitation_status: 'accepted',
  encrypted_space_key: 'k1',
  created_at: '2024-01-01',
};

const pending = {
  ...accepted,
  space_id: 's2',
  invitation_status: 'pending',
};

describe('SpaceCatalogService', () => {
  it('prepares initial space and provisions keys', async () => {
    const keyVault = {
      ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
      pruneKeys: vi.fn(),
      getMasterPassword: vi.fn(() => 'master'),
    };
    const spaceRegistry = {
      resolveInitialSpace: vi.fn(() => accepted),
      setAvailableSpaces: vi.fn(),
      loadCachedSpaceSummaries: vi.fn(() => null),
      getActiveSpaceId: vi.fn(() => 's1'),
      notifyActiveSpaceChange: vi.fn(),
    };

    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted, pending],
      getProfile: async () => ({ primary_space_id: 's1' }),
      keyVault: keyVault as never,
      spaceRegistry: spaceRegistry as never,
      cleanupStaleSpaceDatabases: vi.fn(async () => undefined),
    });

    const spaceId = await service.prepareInitialSpace('master', new AbortController().signal);

    expect(spaceId).toBe('s1');
    expect(spaceRegistry.setAvailableSpaces).toHaveBeenCalledWith([accepted]);
    expect(keyVault.ensureSpaceKey).toHaveBeenCalledWith('s1', 'master', [accepted]);
  });

  it('falls back to cached spaces when listSpaces fails', async () => {
    const keyVault = {
      ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
      pruneKeys: vi.fn(),
      getMasterPassword: vi.fn(() => null),
    };
    const spaceRegistry = {
      resolveInitialSpace: vi.fn(() => accepted),
      setAvailableSpaces: vi.fn(),
      loadCachedSpaceSummaries: vi.fn(() => [accepted]),
      getActiveSpaceId: vi.fn(() => 's1'),
      notifyActiveSpaceChange: vi.fn(),
    };

    const service = new SpaceCatalogService({
      listSpaces: async () => {
        throw new Error('offline');
      },
      keyVault: keyVault as never,
      spaceRegistry: spaceRegistry as never,
    });

    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).resolves.toBe('s1');
  });

  it('throws when no accepted spaces exist', async () => {
    const service = new SpaceCatalogService({
      listSpaces: async () => [pending],
      keyVault: {
        ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => null),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => null),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
    });

    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).rejects.toThrow('No accepted budget spaces');
  });

  it('refreshes spaces and reports fallback when active is missing', async () => {
    const keyVault = {
      ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
      pruneKeys: vi.fn(),
      getMasterPassword: vi.fn(() => 'master'),
    };
    const spaceRegistry = {
      resolveInitialSpace: vi.fn(() => accepted),
      setAvailableSpaces: vi.fn(),
      loadCachedSpaceSummaries: vi.fn(() => null),
      getActiveSpaceId: vi.fn(() => 'missing'),
      notifyActiveSpaceChange: vi.fn(),
    };

    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted],
      keyVault: keyVault as never,
      spaceRegistry: spaceRegistry as never,
    });

    const out = await service.refreshSpaces();
    expect(out.fallbackSpaceId).toBe('s1');
    expect(out.activeStillAvailable).toBe(false);
    expect(keyVault.pruneKeys).toHaveBeenCalledWith(['s1']);
  });

  it('ignores locked accepted spaces when resolving an accessible initial space', async () => {
    const accessibleShared = {
      ...accepted,
      space_id: 'shared-1',
      owner_user_id: 'owner-2',
      role: 'member',
    };
    const lockedOwned = {
      ...accepted,
      space_id: 'locked-owned',
      is_accessible: false,
      access_reason: 'owned_subscription_required' as const,
    };
    const keyVault = {
      ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
      pruneKeys: vi.fn(),
      getMasterPassword: vi.fn(() => 'master'),
    };
    const spaceRegistry = {
      resolveInitialSpace: vi.fn((spaces: typeof accepted[]) => spaces[0]),
      setAvailableSpaces: vi.fn(),
      loadCachedSpaceSummaries: vi.fn(() => null),
      getActiveSpaceId: vi.fn(() => 'locked-owned'),
      notifyActiveSpaceChange: vi.fn(),
    };

    const service = new SpaceCatalogService({
      listSpaces: async () => [lockedOwned, accessibleShared],
      getProfile: async () => ({ primary_space_id: 'locked-owned' }),
      keyVault: keyVault as never,
      spaceRegistry: spaceRegistry as never,
      cleanupStaleSpaceDatabases: vi.fn(async () => undefined),
    });

    const spaceId = await service.prepareInitialSpace('master', new AbortController().signal);

    expect(spaceId).toBe('shared-1');
    expect(spaceRegistry.setAvailableSpaces).toHaveBeenCalledWith([accessibleShared]);
    expect(spaceRegistry.resolveInitialSpace).toHaveBeenCalledWith([accessibleShared], 'locked-owned');
    expect(keyVault.ensureSpaceKey).toHaveBeenCalledWith('shared-1', 'master', [accessibleShared]);
  });

  it('normalizes decryption provisioning errors', async () => {
    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted],
      keyVault: {
        ensureSpaceKey: vi.fn(async () => {
          throw new Error('wrong key or password');
        }),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => accepted),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => 's1'),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
    });

    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).rejects.toThrow('Decryption failed');
  });

  it('throws when initial space cannot be resolved', async () => {
    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted],
      keyVault: {
        ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => null),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => null),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
    });

    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).rejects.toThrow('No workspace available to activate');
  });

  it('handles profile and cleanup failures while keeping flow alive', async () => {
    const log = vi.fn();
    const cleanup = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted],
      getProfile: async () => {
        throw 'profile failed';
      },
      keyVault: {
        ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => accepted),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => 's1'),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
      cleanupStaleSpaceDatabases: cleanup,
      log,
    });

    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).resolves.toBe('s1');
    expect(log).toHaveBeenCalledWith('warn', 'Failed to load profile', expect.any(Object));
    expect(cleanup).toHaveBeenCalled();
  });

  it('refresh path keeps active space and logs ensure failures', async () => {
    const log = vi.fn();
    const keyVault = {
      ensureSpaceKey: vi
          .fn()
          .mockRejectedValueOnce('key fail')
          .mockResolvedValueOnce(new Uint8Array([1])),
      pruneKeys: vi.fn(),
      getMasterPassword: vi.fn(() => 'master'),
    };
    const spaceRegistry = {
      resolveInitialSpace: vi.fn(() => accepted),
      setAvailableSpaces: vi.fn(),
      loadCachedSpaceSummaries: vi.fn(() => null),
      getActiveSpaceId: vi.fn(() => 's1'),
      notifyActiveSpaceChange: vi.fn(),
    };

    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted, { ...accepted, space_id: 's3' }],
      keyVault: keyVault as never,
      spaceRegistry: spaceRegistry as never,
      log,
    });

    const out = await service.refreshSpaces();
    expect(out.activeSpaceId).toBe('s1');
    expect(out.activeStillAvailable).toBe(true);
    expect(out.fallbackSpaceId).toBeNull();
    expect(spaceRegistry.notifyActiveSpaceChange).toHaveBeenCalledWith('s1');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'Failed to ensure space key during refresh',
      expect.any(Object)
    );
  });

  it('logs and continues when provisioning non-decryption errors happen', async () => {
    const log = vi.fn();
    const service = new SpaceCatalogService({
      listSpaces: async () => [accepted, { ...accepted, space_id: 's4' }],
      keyVault: {
        ensureSpaceKey: vi
          .fn()
          .mockRejectedValueOnce('temporary key fetch failure')
          .mockResolvedValueOnce(new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => null),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => ({ ...accepted, space_id: 's4' })),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => null),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
      log,
    });

    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).resolves.toBe('s4');
    expect(log).toHaveBeenCalledWith('warn', 'Failed to provision space key', expect.any(Object));
  });

  it('covers non-array list responses and non-error list fallback', async () => {
    const service = new SpaceCatalogService({
      listSpaces: async () => ({ bad: true } as never),
      keyVault: {
        ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => null),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => accepted),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => null),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
    });
    await expect(
      service.prepareInitialSpace('master', new AbortController().signal)
    ).rejects.toThrow('No accepted budget spaces');

    const log = vi.fn();
    const withListError = new SpaceCatalogService({
      listSpaces: async () => {
        throw 'offline';
      },
      keyVault: {
        ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => null),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => accepted),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => null),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
      log,
    });
    await expect(
      withListError.prepareInitialSpace('master', new AbortController().signal)
    ).rejects.toThrow('Unable to load workspaces while offline.');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'Failed to list spaces; attempting offline cache',
      expect.any(Object)
    );
  });

  it('returns null fallback when first accepted space has no id', async () => {
    const service = new SpaceCatalogService({
      listSpaces: async () => [
        {
          ...accepted,
          space_id: undefined as unknown as string,
        },
      ],
      keyVault: {
        ensureSpaceKey: vi.fn(async () => new Uint8Array([1])),
        pruneKeys: vi.fn(),
        getMasterPassword: vi.fn(() => null),
      } as never,
      spaceRegistry: {
        resolveInitialSpace: vi.fn(() => accepted),
        setAvailableSpaces: vi.fn(),
        loadCachedSpaceSummaries: vi.fn(() => null),
        getActiveSpaceId: vi.fn(() => 'missing'),
        notifyActiveSpaceChange: vi.fn(),
      } as never,
    });

    const out = await service.refreshSpaces();
    expect(out.fallbackSpaceId).toBeNull();
  });
});
