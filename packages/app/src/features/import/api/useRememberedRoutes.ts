import { useEffect, useMemo } from 'react';
import {
  budgetScope,
  mergeSyncedState,
  readSyncedState,
  syncedStateWriteBlocker,
  useSyncedState,
} from '@shared/lib/synced-state';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import {
  ACCOUNT_ROUTES_KEY,
  legacyRememberKeys,
  legacyRoutesPatch,
  readLegacyRememberedRoutes,
  rememberedRoutesOf,
  rememberRoutesPatch,
} from '../lib/account-routes';

const NO_ROUTES: Record<string, number> = Object.freeze(Object.create(null));

/** Space + budget pairs whose localStorage routes this session has moved (or is moving). */
const migrated = new Set<string>();

export function resetRememberedRoutesForTests(): void {
  migrated.clear();
}

/**
 * Moves this device's routes from localStorage into the synced map once:
 * only entries the map lacks, then the old keys go. Kept when the write
 * fails, so the next load tries again.
 */
async function migrateLegacyRoutes(spaceId: string, budgetId: number): Promise<void> {
  const scope = budgetScope(budgetId);
  const stored = readSyncedState(scope, ACCOUNT_ROUTES_KEY);
  if (!stored.available || syncedStateWriteBlocker()) return;
  const patch = legacyRoutesPatch(
    stored.value,
    readLegacyRememberedRoutes(spaceId, budgetId),
    Date.now()
  );
  if (patch) await mergeSyncedState(scope, ACCOUNT_ROUTES_KEY, patch);
  try {
    for (const key of legacyRememberKeys(spaceId, budgetId)) localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing to clear */
  }
}

/**
 * Remembers `chosen` (source → account id) for the budget's next import, on
 * every device of the workspace. Resolves false when nothing was written.
 */
export async function rememberRoutes(
  budgetId: number,
  chosen: Record<string, number>
): Promise<boolean> {
  if (!Number.isInteger(budgetId) || budgetId <= 0) return false;
  const scope = budgetScope(budgetId);
  const stored = readSyncedState(scope, ACCOUNT_ROUTES_KEY);
  if (!stored.available) return false;
  const patch = rememberRoutesPatch(stored.value, chosen, Date.now());
  if (!patch) return false;
  try {
    return await mergeSyncedState(scope, ACCOUNT_ROUTES_KEY, patch);
  } catch {
    // The next import asks again.
    return false;
  }
}

/**
 * Account routes picked in earlier imports into `budgetId` (source → account
 * id), shared by the workspace. Null until the synced state has loaded: plan
 * routes only after that. Also migrates this device's pre-sync choices.
 */
export function useRememberedRoutes(budgetId: number | undefined): Record<string, number> | null {
  const spaceId = useActiveSpaceId();
  const valid = budgetId !== undefined && Number.isInteger(budgetId) && budgetId > 0;
  const state = useSyncedState<unknown>(valid ? budgetScope(budgetId) : null, ACCOUNT_ROUTES_KEY);
  const routes = useMemo(
    () => (state.loaded ? rememberedRoutesOf(state.value) : null),
    [state.loaded, state.value]
  );

  useEffect(() => {
    if (!valid || !spaceId || !state.loaded || !state.canWrite) return;
    const id = `${spaceId}|${budgetId}`;
    if (migrated.has(id)) return;
    migrated.add(id);
    migrateLegacyRoutes(spaceId, budgetId).catch(() => migrated.delete(id));
  }, [valid, spaceId, budgetId, state.loaded, state.canWrite]);

  // Without a budget there is nothing to plan against.
  return valid ? routes : NO_ROUTES;
}
