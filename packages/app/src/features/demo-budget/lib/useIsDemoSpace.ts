import { useEffect } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { setDemoSpaceId, useDemoSpaceId } from '@shared/lib/demo-space';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import { isDemoAccount } from './demo-workspace';

export interface DemoSpaceStatus {
  isDemo: boolean;
  /** Still reading the open workspace's accounts to find out. */
  checking: boolean;
}

/**
 * Whether the open workspace is the onboarding demo. The device's cached id
 * answers at once; otherwise (another device, or storage was cleared) the
 * demo's own accounts say so, and the cache is filled in for next time.
 */
export function useDemoSpaceStatus(): DemoSpaceStatus {
  const activeSpaceId = useActiveSpaceId();
  const cachedId = useDemoSpaceId();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const cached = Boolean(activeSpaceId && cachedId === activeSpaceId);
  const lookup = !cached && Boolean(activeSpaceId) && budgetId > 0;
  const { data: accounts, isPending } = useAccounts(budgetId, lookup);
  const marked = lookup && Boolean(accounts?.some(isDemoAccount));

  useEffect(() => {
    if (marked && activeSpaceId) setDemoSpaceId(activeSpaceId);
  }, [marked, activeSpaceId]);

  return { isDemo: cached || marked, checking: lookup && isPending };
}

export function useIsDemoSpace(): boolean {
  return useDemoSpaceStatus().isDemo;
}
