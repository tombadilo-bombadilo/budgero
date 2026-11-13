import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { userScope } from '@shared/lib/synced-state/synced-state';
import { useSyncedState } from '@shared/lib/synced-state/useSyncedState';
import {
  FIRST_STEPS_KEY,
  firstStepsDeviceEntry,
  firstStepsDeviceKey,
  firstStepsFrom,
  firstStepsOverlay,
  noteFirstStepsLoaded,
  setFirstStepsUser,
  subscribeFirstSteps,
  type FirstStepsState,
  type SyncedFirstSteps,
} from './first-steps';

/**
 * `userId`'s checklist in the open workspace, live (a change from any device
 * shows up). Null until the synced state is loaded, so nothing shows, hides
 * or ticks on a guess, and for a user who has none. While mounted it also
 * moves a device-only checklist into the synced state once and ticks "come
 * back" on a later day (see noteFirstStepsLoaded).
 */
export function useFirstSteps(
  spaceId: string | null,
  userId: string | null
): FirstStepsState | null {
  const key = spaceId && userId ? firstStepsDeviceKey(spaceId, userId) : null;
  const { loaded, available, value } = useSyncedState<SyncedFirstSteps>(
    spaceId && userId ? userScope(userId) : null,
    FIRST_STEPS_KEY
  );
  const overlay = useSyncExternalStore(
    subscribeFirstSteps,
    () => firstStepsOverlay(key),
    () => undefined
  );
  const device = useSyncExternalStore(
    subscribeFirstSteps,
    () => firstStepsDeviceEntry(key),
    () => undefined
  );

  useEffect(() => {
    if (spaceId && userId) setFirstStepsUser(spaceId, userId);
  }, [spaceId, userId]);

  useEffect(() => {
    if (spaceId && userId && loaded && available) noteFirstStepsLoaded(spaceId, userId, value);
  }, [spaceId, userId, loaded, available, value]);

  return useMemo(() => {
    if (!key || !loaded) return null;
    // Unreadable database (offline first run): this device's last copy.
    return firstStepsFrom(available ? value : device?.synced, overlay, device);
  }, [key, loaded, available, value, overlay, device]);
}
