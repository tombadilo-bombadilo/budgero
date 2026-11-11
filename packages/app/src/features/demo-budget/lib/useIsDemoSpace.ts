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
 * Whether the open workspace is the onboarding demo. Only the workspace's own
 * data counts: the open budget's accounts must carry the seed's marker. The
 * device's cached id is just a hint (it is set before the seed runs), so it is
 * filled in when the marker is found and dropped when the open budget turns
 * out to have none — e.g. a tab closed before the seed ran, after which a real
 * budget was set up in that workspace.
 */
export function useDemoSpaceStatus(): DemoSpaceStatus {
  const activeSpaceId = useActiveSpaceId();
  const cachedId = useDemoSpaceId();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const lookup = Boolean(activeSpaceId) && budgetId > 0;
  const { data: accounts, isPending } = useAccounts(budgetId, lookup);
  const marked = lookup && Boolean(accounts?.some(isDemoAccount));
  const disproved =
    lookup && cachedId === activeSpaceId && !isPending && accounts !== undefined && !marked;

  useEffect(() => {
    if (marked && activeSpaceId) setDemoSpaceId(activeSpaceId);
    else if (disproved) setDemoSpaceId(null);
  }, [marked, disproved, activeSpaceId]);

  return { isDemo: marked, checking: lookup && isPending };
}

export function useIsDemoSpace(): boolean {
  return useDemoSpaceStatus().isDemo;
}
