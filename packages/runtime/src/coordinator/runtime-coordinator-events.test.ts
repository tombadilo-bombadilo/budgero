import { describe, expect, it, vi } from 'vitest';
import { RuntimeCoordinatorEvents } from './runtime-coordinator-events';

describe('RuntimeCoordinatorEvents', () => {
  it('manages listeners and emits events', () => {
    const events = new RuntimeCoordinatorEvents({ getCurrentConnection: () => true });

    const overlay = vi.fn();
    const conn = vi.fn();
    const sync = vi.fn();

    const offOverlay = events.onOverlayChange(overlay);
    const offConn = events.onConnectionChange(conn);
    const offSync = events.onSyncStatus(sync);

    events.emitOverlay('syncing');
    events.emitConnectionChange(false);
    events.emitSyncStatus({ isSyncing: true, lastSyncTime: null, syncError: null });

    expect(overlay).toHaveBeenCalledWith('syncing');
    expect(conn).toHaveBeenCalledWith(true);
    expect(conn).toHaveBeenCalledWith(false);
    expect(sync).toHaveBeenCalled();

    offOverlay();
    offConn();
    offSync();

    events.clear();
    events.emitOverlay('hidden');
    expect(overlay).toHaveBeenCalledTimes(1);
  });

  it('swallows listener errors', () => {
    const events = new RuntimeCoordinatorEvents({ getCurrentConnection: () => false });
    events.onConnectionChange(() => {
      throw new Error('ignore');
    });

    expect(() => events.emitConnectionChange(true)).not.toThrow();
  });
});
