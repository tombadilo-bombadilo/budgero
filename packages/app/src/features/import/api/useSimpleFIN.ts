import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import {
  claimSetupToken,
  fetchAccounts,
  type SimpleFINCredentials,
  type SimpleFINAccountSet,
} from '@features/import/lib';

const STORAGE_KEY = 'simplefin_credentials';

function loadCredentials(): SimpleFINCredentials | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function saveCredentials(credentials: SimpleFINCredentials): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

function clearCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Hook for managing SimpleFIN connection and data fetching
 */
export function useSimpleFIN() {
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<SimpleFINCredentials | null>(loadCredentials);

  const claimMutation = useMutation({
    mutationFn: async (setupToken: string) => {
      const creds = await claimSetupToken(setupToken);
      return creds;
    },
    onSuccess: (creds) => {
      saveCredentials(creds);
      setCredentials(creds);
      void queryClient.invalidateQueries({ queryKey: ['simplefin', 'accounts'] });
    },
  });

  const accountsQuery = useQuery({
    queryKey: ['simplefin', 'accounts', credentials?.accessUrl],
    queryFn: async (): Promise<SimpleFINAccountSet> => {
      if (!credentials?.accessUrl) {
        throw new Error('No SimpleFIN credentials');
      }
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      return fetchAccounts(credentials.accessUrl, { startDate, endDate });
    },
    enabled: !!credentials?.accessUrl,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });

  const disconnect = useCallback(() => {
    clearCredentials();
    setCredentials(null);
    queryClient.removeQueries({ queryKey: ['simplefin'] });
  }, [queryClient]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['simplefin', 'accounts'] });
  }, [queryClient]);

  return {
    isConnected: !!credentials,
    credentials,

    claim: claimMutation.mutate,
    isClaiming: claimMutation.isPending,
    claimError: claimMutation.error,

    accounts: accountsQuery.data?.accounts ?? [],
    errors: accountsQuery.data?.errors ?? [],
    isLoading: accountsQuery.isLoading,
    isFetching: accountsQuery.isFetching,
    fetchError: accountsQuery.error,

    disconnect,
    refresh,
  };
}
