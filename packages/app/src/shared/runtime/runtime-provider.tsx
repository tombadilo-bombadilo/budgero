/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppRuntime } from '@shared/runtime/app-runtime';
import { useRequiredContext } from '@shared/lib/useRequiredContext';
import { setRuntime } from '@shared/runtime/global';
import { getConnectivityService } from '@shared/runtime/connectivity-service';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import type { RuntimeState } from '@budgero/runtime';

const RuntimeContext = createContext<AppRuntime | null>(null);

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useMemo(() => new AppRuntime(), []);
  // Expose runtime for non-React modules (e.g., MutationManager)
  setRuntime(runtime);

  // Kick off connectivity probing early so guards have a ready snapshot
  useEffect(() => {
    const cs = getConnectivityService();
    cs.start();
    cs.refresh();
    return () => cs.stop();
  }, []);

  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): AppRuntime {
  return useRequiredContext(RuntimeContext, 'Runtime');
}

export function useRuntimeState(): RuntimeState {
  const runtime = useRuntime();
  return useSyncExternalStore(
    (onStoreChange) => runtime.onStateChange(() => onStoreChange()),
    () => runtime.state(),
    () => runtime.state()
  );
}

const INITIALIZED_RUNTIME_STATES: ReadonlySet<RuntimeState> = new Set([
  'Ready',
  'Degraded',
  'Reconnecting',
]);

/**
 * Reactive equivalent of runtime.isInitialized(). Render-time code (e.g. a
 * query's `enabled` flag) must use this instead of calling isInitialized()
 * imperatively — the imperative read doesn't subscribe, so nothing re-renders
 * when init/switchSpace completes and the stale `false` sticks forever.
 */
export function useRuntimeInitialized(): boolean {
  return INITIALIZED_RUNTIME_STATES.has(useRuntimeState());
}

export function useActiveSpaceId(): string | null {
  const runtime = useRuntime();
  return useSyncExternalStore(
    (onStoreChange) => runtime.onActiveSpaceChange(() => onStoreChange()),
    () => runtime.getActiveSpaceId(),
    () => runtime.getActiveSpaceId()
  );
}

export function useAvailableSpaces(): BudgetSpaceSummary[] {
  const runtime = useRuntime();
  return useSyncExternalStore(
    (onStoreChange) => runtime.onAvailableSpacesChange(onStoreChange),
    () => runtime.listSpaces(),
    () => runtime.listSpaces()
  );
}

export function useActiveSpace(): BudgetSpaceSummary | null {
  const spaces = useAvailableSpaces();
  const activeSpaceId = useActiveSpaceId();

  return useMemo(() => {
    if (!activeSpaceId) {
      return null;
    }
    return spaces.find((space) => space.space_id === activeSpaceId) ?? null;
  }, [spaces, activeSpaceId]);
}
