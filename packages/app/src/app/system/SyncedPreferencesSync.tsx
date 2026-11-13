import { useEffect } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { setSyncedPreferencesUser, useSyncedPreference } from '@shared/lib/synced-state';
import { budgetTargetColumnPreference, languagePreference } from './personal-preferences';

/**
 * Personal preferences that follow the user through the open workspace's
 * encrypted database (synced-preferences.ts). Theme, font and start page are
 * not here: they already follow the user through the account profile
 * (UserPreferencesSync).
 */
export function SyncedPreferencesSync() {
  const { data: profile } = useProfile();
  const userId = profile?.id ?? null;

  useEffect(() => {
    setSyncedPreferencesUser(userId);
    return () => setSyncedPreferencesUser(null);
  }, [userId]);

  useSyncedPreference(userId, languagePreference);
  useSyncedPreference(userId, budgetTargetColumnPreference);
  return null;
}
