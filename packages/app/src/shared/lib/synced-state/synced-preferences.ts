/**
 * Personal preferences that must paint before the workspace database is
 * unlocked (language, ...) keep their localStorage value as a device cache and
 * sync per user through synced state (userScope, `set`, newest write wins):
 *
 * - Load: once the open workspace's value is read, a stored value that differs
 *   from the device's is applied here (one switch, cache updated). With none
 *   stored, the device's value is written up only if the user chose it on this
 *   device; a default never is, so a fresh phone can't overwrite the desktop's
 *   choice with its default.
 * - Change: the user's change updates the cache and sends one write
 *   (saveSyncedPreference). Applying a synced value never writes back, so two
 *   tabs or devices settle on the newest write instead of trading values.
 * - Pre-unlock, signed out, demo (writes refused): the cache only.
 *
 * Known limit: synced state lives in each workspace's own database, so a user
 * with two workspaces has one value per workspace; opening the other workspace
 * applies that workspace's value.
 */
import { setSyncedState, userScope } from './synced-state';

export interface SyncedPreference<T> {
  /** Synced state key under userScope(userId). */
  key: string;
  /** The device's value now, and whether the user chose it here (not a default). */
  readLocal(): { value: T; explicit: boolean };
  isValid(value: unknown): value is T;
  /** Shows a value from the database and caches it; must not write it back. */
  apply(value: T): void | Promise<void>;
}

/** Signed-in user the change writes go to; set by the component that runs the sync. */
let preferencesUserId: string | null = null;

export function setSyncedPreferencesUser(userId: string | null): void {
  preferencesUserId = userId;
}

/**
 * A user changed a synced preference on this device (its cache is already
 * updated): one write to the open workspace. Refused without a signed-in
 * user, workspace or synced store, and in the demo.
 */
export function saveSyncedPreference(key: string, value: unknown): void {
  if (!preferencesUserId) return;
  void setSyncedState(userScope(preferencesUserId), key, value).catch(() => {
    /* the cache keeps it; the next change writes again */
  });
}

/**
 * The load step: apply the stored value, or write up the device's explicit
 * one when nothing is stored. Returns what it did.
 */
export async function reconcileSyncedPreference<T>(
  pref: SyncedPreference<T>,
  synced: { available: boolean; value: unknown },
  write: (value: T) => Promise<boolean>
): Promise<'applied' | 'written' | 'none'> {
  if (!synced.available) return 'none';
  const local = pref.readLocal();
  if (synced.value !== undefined && synced.value !== null) {
    if (!pref.isValid(synced.value) || synced.value === local.value) return 'none';
    await pref.apply(synced.value);
    return 'applied';
  }
  if (!local.explicit) return 'none';
  return (await write(local.value)) ? 'written' : 'none';
}
