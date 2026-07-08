import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { Services } from '@budgero/core/browser';
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { resolveSpaceKey } from '@shared/lib/query-utils';

export interface SpaceQueryOptions<TData>
  extends Omit<UseQueryOptions<TData>, 'queryKey' | 'queryFn' | 'enabled'> {
  /**
   * Query key as `[root, ...parts]`. The active space key is inserted after
   * the root, producing the `['root', spaceKey, ...parts]` shape shared by
   * the entity layer and the invalidation helpers in
   * `@shared/lib/query-utils`.
   */
  key: readonly (string | number)[];
  /**
   * Extra gating ANDed with space readiness (`Boolean(spaceId)`).
   * Defaults to `true`.
   */
  enabled?: boolean;
  /**
   * Runs only once a space is active; receives the resolved runtime services
   * and the active space id. Throws "No active budget space selected" if the
   * query is somehow executed without one.
   */
  queryFn: (services: Services, spaceId: string) => TData | Promise<TData>;
}

/**
 * Space-scoped read query.
 *
 * Captures the boilerplate every entity/analytics read hook repeated by hand:
 * space-readiness gating in `enabled`, space-key composition via
 * {@link resolveSpaceKey}, the no-active-space guard, and resolving
 * `runtime.services()` into the query function. `staleTime` defaults to the
 * conventional 5 minutes; any other `useQuery` option passes through.
 */
export function useSpaceQuery<TData>({
  key,
  enabled = true,
  queryFn,
  staleTime = 1000 * 60 * 5,
  ...rest
}: SpaceQueryOptions<TData>) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const [root, ...parts] = key;
  return useQuery<TData>({
    queryKey: [root, resolveSpaceKey(spaceId), ...parts],
    queryFn: async () => {
      if (!spaceId) {
        throw new Error('No active budget space selected');
      }
      return queryFn(runtime.services(), spaceId);
    },
    enabled: Boolean(spaceId) && enabled,
    staleTime,
    ...rest,
  });
}
