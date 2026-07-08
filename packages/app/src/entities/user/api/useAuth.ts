import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApiClient } from '@shared/hooks/useApiClient';
import { useOptionalClerkAuth } from '@shared/hooks/useOptionalClerkAuth';
import { MasterPasswordManager } from '@shared/lib/crypto';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { getRuntime } from '@shared/runtime/global';
import { getConnectivityService } from '@shared/runtime/connectivity-service';
import type { OnboardingStatus, User } from '@shared/model/auth';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';

export { useOptionalClerkAuth };

/** Response shape from backup settings API endpoints */
interface BackupSettingsResponse {
  backup_reminder_frequency_days?: number;
  last_user_db_backup?: string | null;
}

// Get user profile hook
export function useProfile() {
  const clerkAuth = useOptionalClerkAuth();
  const apiClient = useApiClient();
  const selfHostToken = useSelfHostAuth((state) => state.token);
  const setSelfHostProfile = useSelfHostAuth((state) => state.setProfile);
  const [, setConnectivityTick] = useState(0);
  let isSignedIn = Boolean(clerkAuth?.isSignedIn);
  if (IS_SELF_HOSTABLE_BUILD) {
    isSignedIn = Boolean(selfHostToken);
  }

  // The connectivity probe itself is started app-wide by RuntimeProvider;
  // this only subscribes for re-renders when the state changes.
  useEffect(() => {
    if (!IS_SELF_HOSTABLE_BUILD) return;
    const off = getConnectivityService().addListener(() => {
      setConnectivityTick((tick) => tick + 1);
    });
    return () => off();
  }, []);

  // For self-host: wait for connectivity service to probe before fetching
  // This prevents hammering the profile endpoint when offline
  const selfHostConnectivityState = IS_SELF_HOSTABLE_BUILD
    ? getConnectivityService().getState()
    : null;
  const connectivityKnown =
    !IS_SELF_HOSTABLE_BUILD || (selfHostConnectivityState?.lastChecked ?? 0) > 0;
  const isOffline =
    IS_SELF_HOSTABLE_BUILD &&
    connectivityKnown &&
    selfHostConnectivityState?.apiReachable === false;

  const query = useQuery<User | undefined>({
    queryKey: ['profile'],
    queryFn: async () => {
      return apiClient.get<User>('/profile');
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    // Self-host: use 'online' to respect connectivity; SaaS: always attempt
    networkMode: IS_SELF_HOSTABLE_BUILD ? 'online' : 'always',
    retry: (failureCount, error) => {
      // Don't retry on network errors that indicate offline state
      const errorMessage = error?.toString().toLowerCase() || '';
      const isNetworkError =
        errorMessage.includes('failed to fetch') ||
        errorMessage.includes('network error') ||
        errorMessage.includes('err_internet_disconnected') ||
        errorMessage.includes('err_network_changed') ||
        errorMessage.includes('aborted') ||
        errorMessage.includes('timeout');

      if (isNetworkError) {
        return false; // Don't retry network errors
      }

      return failureCount < 1; // Only retry once for non-network errors
    },
    retryDelay: 1000, // 1 second delay between retries
    gcTime: 1000 * 60 * 10, // 10 minutes cache time
    // Self-host: wait for connectivity probe, skip if offline
    // SaaS: Clerk loading provides natural delay
    enabled: isSignedIn && (IS_SELF_HOSTABLE_BUILD ? connectivityKnown && !isOffline : true),
  });

  useEffect(() => {
    if (IS_SELF_HOSTABLE_BUILD) {
      const data = query.data as User | undefined;
      setSelfHostProfile(data ?? null);
    }
  }, [query.data, setSelfHostProfile]);

  return query;
}

export type UpdateOnboardingInput = {
  status: OnboardingStatus;
  snoozed_until?: string | null;
  /** Optional referral source captured on the "How did you hear about us?" step. */
  where_heard_about?: string;
};

export function useUpdateOnboarding() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation<void, Error, UpdateOnboardingInput>({
    mutationFn: async ({ status, snoozed_until, where_heard_about }) => {
      return apiClient.post('/profile/onboarding', {
        status,
        snoozed_until,
        where_heard_about,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export type UpdateBackupSettingsInput = {
  frequency_days: number;
};

export function useUpdateBackupSettings() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation<BackupSettingsResponse, Error, UpdateBackupSettingsInput>({
    mutationFn: async ({ frequency_days }) => {
      return apiClient.put('/profile/backup-settings', { frequency_days });
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
        if (!prev) return prev;
        const frequency =
          typeof data?.backup_reminder_frequency_days === 'number'
            ? data.backup_reminder_frequency_days
            : variables.frequency_days;
        return {
          ...prev,
          backup_reminder_frequency_days: frequency,
          last_user_db_backup: data?.last_user_db_backup ?? prev.last_user_db_backup ?? null,
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export type RecordBackupInput = {
  frequency_days?: number;
};

export function useRecordBackup() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation<BackupSettingsResponse, Error, RecordBackupInput | void>({
    mutationFn: async (payload = {}) => {
      return apiClient.post('/profile/backup/record', payload);
    },
    onSuccess: (data) => {
      const serverLastBackup = data?.last_user_db_backup;
      const serverFrequency = data?.backup_reminder_frequency_days;
      const fallbackNow = new Date().toISOString();

      queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
        if (!prev) return prev;
        const nextFrequency =
          typeof serverFrequency === 'number'
            ? serverFrequency
            : prev.backup_reminder_frequency_days;
        return {
          ...prev,
          last_user_db_backup: serverLastBackup ?? fallbackNow,
          backup_reminder_frequency_days: nextFrequency,
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// Logout hook - clears local data
export function useLogout() {
  const clerkAuth = useOptionalClerkAuth();
  const signOut =
    clerkAuth?.signOut ??
    (async () => {
      /* noop for non-Clerk builds */
    });
  const clearSelfHostSession = useSelfHostAuth((state) => state.clearSession);

  return useMutation({
    mutationFn: async () => {
      // 0. Destroy the AppRuntime to close DB connections, WebSockets, and clear in-memory state
      try {
        const runtime = getRuntime();
        if (runtime) {
          runtime.destroy();
        }
      } catch (error) {
        console.error('Failed to destroy runtime:', error);
      }

      // 1. Clear all localStorage items (including master password, cached data, etc.)
      if (typeof window !== 'undefined') {
        try {
          MasterPasswordManager.clear();
        } catch (error) {
          console.error('Failed to clear master password cache:', error);
        }

        try {
          localStorage.removeItem('master_password_status');
          localStorage.removeItem('master_password_weak_hint');
        } catch (error) {
          console.error('Failed to remove master password markers:', error);
        }

        try {
          localStorage.clear();
        } catch (error) {
          console.error('Failed to clear localStorage:', error);
        }

        try {
          sessionStorage.clear();
        } catch (error) {
          console.error('Failed to clear sessionStorage:', error);
        }
      }

      // 2. Clear OPFS database cache
      if ('storage' in navigator && 'getDirectory' in navigator.storage) {
        try {
          const root = await navigator.storage.getDirectory();
          const rootWithIterators = root as FileSystemDirectoryHandle & {
            values?: () => AsyncIterable<{ name: string; kind: string }>;
          };
          if (rootWithIterators.values) {
            for await (const entry of rootWithIterators.values()) {
              if (entry.kind === 'file') {
                await root.removeEntry(entry.name);
              } else if (entry.kind === 'directory') {
                await root.removeEntry(entry.name, { recursive: true });
              }
            }
          }
        } catch (error) {
          console.error('Failed to clear OPFS:', error);
        }
      }

      // 3. Clear IndexedDB (used by some caching mechanisms)
      if ('indexedDB' in window) {
        try {
          const databases = indexedDB.databases ? await indexedDB.databases() : [];
          for (const db of databases) {
            if (db.name) {
              indexedDB.deleteDatabase(db.name);
            }
          }
        } catch (error) {
          console.error('Failed to clear IndexedDB:', error);
        }
      }

      // 4. Clear service worker caches
      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
        } catch (error) {
          console.error('Failed to clear service worker caches:', error);
        }
      }

      // 5. Sign out with Clerk
      if (IS_SELF_HOSTABLE_BUILD) {
        clearSelfHostSession();
      } else {
        await signOut();
      }

      // 6. Force page reload to ensure fresh runtime on next login
      // This prevents stale runtime state from persisting across logout/login cycles
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    },
  });
}

// Set analytics disabled hook
export type SetAnalyticsDisabledInput = {
  disabled: boolean;
};

export function useSetAnalyticsDisabled() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();

  return useMutation<
    { success: boolean; is_analytics_disabled: boolean },
    Error,
    SetAnalyticsDisabledInput
  >({
    mutationFn: async ({ disabled }) => {
      return apiClient.put('/profile/analytics', { disabled });
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
        if (!prev) return prev;
        return { ...prev, is_analytics_disabled: variables.disabled };
      });
    },
  });
}

// Set trial-signals disabled hook (trial-reward tracking, decoupled from analytics)
export type SetTrialSignalsDisabledInput = {
  disabled: boolean;
};

export function useSetTrialSignalsDisabled() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();

  return useMutation<
    { success: boolean; is_trial_signals_disabled: boolean },
    Error,
    SetTrialSignalsDisabledInput
  >({
    mutationFn: async ({ disabled }) => {
      return apiClient.put('/profile/trial-signals', { disabled });
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
        if (!prev) return prev;
        return { ...prev, is_trial_signals_disabled: variables.disabled };
      });
    },
  });
}
