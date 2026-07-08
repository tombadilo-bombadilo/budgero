import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trialApi } from '@shared/api/api-client';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

/**
 * Fetches the user's trial-rewards progress and earned codes. Disabled in
 * self-host builds (the rewards endpoints don't exist there).
 *
 * Polled every 30s while mounted so unlocks earned in this session show up
 * without a page reload — the unlock modal hooks off this query result.
 */
export function useTrialProgress() {
  return useQuery({
    queryKey: ['trial-progress'],
    queryFn: trialApi.getProgress,
    enabled: !IS_SELF_HOSTABLE_BUILD,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/** Dev-only: force-unlock a tier. Server-gated by DEV_TOOLS_ENABLED. */
export function useDevForceUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tier: 1 | 2 | 3) => trialApi.devForceUnlock(tier),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trial-progress'] }),
  });
}

/** Dev-only: wipe trial-rewards state. */
export function useDevResetTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => trialApi.devReset(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trial-progress'] }),
  });
}
