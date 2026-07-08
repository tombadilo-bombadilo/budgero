import { describe, expect, it, vi } from 'vitest';
import { ActiveSpaceSession } from './active-space-session';

function createContext(spaceId = 's1') {
  return {
    spaceId,
    db: { close: vi.fn() },
    sync: {
      isConnected: vi.fn(() => true),
      onConnectionChange: vi.fn((cb: (connected: boolean) => void) => {
        cb(true);
        return vi.fn();
      }),
      addSyncStatusListener: vi.fn((cb: (status: unknown) => void) => {
        cb({ isSyncing: false, lastSyncTime: null, syncError: null });
        return vi.fn();
      }),
      destroy: vi.fn(),
    },
    dbSync: { destroy: vi.fn() },
  };
}

describe('ActiveSpaceSession', () => {
  it('replaces context and forwards listeners', () => {
    const deps = {
      setActiveSpaceId: vi.fn(),
      setWebSocketProvider: vi.fn(),
      clearQueryClient: vi.fn(),
      clearUndo: vi.fn(),
      onConnectionChange: vi.fn(),
      onSyncStatus: vi.fn(),
    };
    const session = new ActiveSpaceSession(deps);
    const ctx = createContext();

    session.replace(ctx as never);

    expect(session.getContext()).toBe(ctx);
    expect(session.isConnected()).toBe(true);
    expect(deps.setActiveSpaceId).toHaveBeenCalledWith('s1');
    expect(deps.clearQueryClient).toHaveBeenCalled();
    expect(deps.onConnectionChange).toHaveBeenCalledWith(true);
    expect(deps.onSyncStatus).toHaveBeenCalled();
  });

  it('disposes context safely', () => {
    const deps = {
      setActiveSpaceId: vi.fn(),
      setWebSocketProvider: vi.fn(),
      clearQueryClient: vi.fn(),
      clearUndo: vi.fn(),
      onConnectionChange: vi.fn(),
      onSyncStatus: vi.fn(),
    };
    const session = new ActiveSpaceSession(deps);
    const ctx = createContext();
    session.replace(ctx as never);

    session.dispose();

    expect(ctx.sync.destroy).toHaveBeenCalled();
    expect(ctx.dbSync.destroy).toHaveBeenCalled();
    expect(ctx.db.close).toHaveBeenCalled();
    expect(session.getContext()).toBeNull();
    expect(deps.setActiveSpaceId).toHaveBeenLastCalledWith(null);
    expect(deps.clearQueryClient).toHaveBeenCalledTimes(2);
    expect(deps.clearUndo).toHaveBeenCalledTimes(2);
    expect(deps.onConnectionChange).toHaveBeenCalledWith(false);
    expect(deps.setWebSocketProvider).toHaveBeenCalledTimes(2);
    const lastProvider = deps.setWebSocketProvider.mock.calls[1]?.[0];
    expect(lastProvider?.()).toBe(false);
  });

  it('handles listener cleanup and disposal failures defensively', () => {
    const deps = {
      setActiveSpaceId: vi.fn(),
      setWebSocketProvider: vi.fn(),
      clearQueryClient: vi.fn(),
      clearUndo: vi.fn(() => {
        throw new Error('undo cleanup failed');
      }),
      onConnectionChange: vi.fn(),
      onSyncStatus: vi.fn(),
    };
    const session = new ActiveSpaceSession(deps);
    const cleanup1 = vi.fn(() => {
      throw new Error('cleanup failed');
    });
    const cleanup2 = vi.fn();
    const ctx = {
      ...createContext(),
      sync: {
        ...createContext().sync,
        onConnectionChange: vi.fn(() => cleanup1),
        addSyncStatusListener: vi.fn(() => cleanup2),
        destroy: vi.fn(() => {
          throw new Error('sync destroy failed');
        }),
      },
      dbSync: {
        destroy: vi.fn(() => {
          throw new Error('dbSync destroy failed');
        }),
      },
      db: {
        close: vi.fn(() => {
          throw new Error('db close failed');
        }),
      },
    };

    session.replace(ctx as never);
    session.replace(createContext('s2') as never);
    session.dispose();
    session.dispose();

    expect(cleanup1).toHaveBeenCalled();
    expect(cleanup2).toHaveBeenCalled();
    expect(session.isConnected()).toBe(false);
  });

  it('swallows disposal errors on the active context', () => {
    const deps = {
      setActiveSpaceId: vi.fn(),
      setWebSocketProvider: vi.fn(),
      clearQueryClient: vi.fn(),
      clearUndo: vi.fn(),
      onConnectionChange: vi.fn(),
      onSyncStatus: vi.fn(),
    };
    const session = new ActiveSpaceSession(deps);
    const ctx = createContext();
    ctx.sync.destroy = vi.fn(() => {
      throw new Error('sync fail');
    });
    ctx.dbSync.destroy = vi.fn(() => {
      throw new Error('dbSync fail');
    });
    ctx.db.close = vi.fn(() => {
      throw new Error('close fail');
    });

    session.replace(ctx as never);
    expect(() => session.dispose()).not.toThrow();
  });
});
