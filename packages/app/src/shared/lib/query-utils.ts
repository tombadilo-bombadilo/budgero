import type { QueryClient } from '@tanstack/react-query';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';

/**
 * Placeholder space-key segment used in query keys while the active space id is
 * still resolving, so a key stays stable (rather than `undefined`) until the
 * real space id arrives.
 */
const PENDING_SPACE_KEY = 'pending-space';

/**
 * Resolve a space id to the segment used in space-scoped query keys
 * (`['root', spaceKey, ...]`), falling back to {@link PENDING_SPACE_KEY} when
 * the active space is not yet known.
 */
export function resolveSpaceKey(spaceId: string | null | undefined): string {
  return spaceId ?? PENDING_SPACE_KEY;
}

/**
 * Build an `invalidateKey` helper bound to a QueryClient and (optionally) the
 * active space id.
 *
 * Calling the returned function invalidates the query identified by `parts`,
 * and—when a `spaceId` is present—also invalidates the space-scoped variant of
 * that key (`[head, spaceId, ...rest]`). This mirrors the space-scoping scheme
 * used by query keys throughout the entity layer.
 *
 * Note: TanStack Query matches query keys by prefix (partial match) by default,
 * so callers do not need to pass `exact: false`.
 */
export function makeInvalidateKey(qc: QueryClient, spaceId: string | null | undefined) {
  return (...parts: (string | number)[]) => {
    void qc.invalidateQueries({ queryKey: parts });
    if (spaceId) {
      void qc.invalidateQueries({ queryKey: [parts[0], spaceId, ...parts.slice(1)] });
    }
  };
}

/**
 * Invalidate every query whose root key (`queryKey[0]`) is one of `roots`.
 *
 * Space-agnostic: because the root is always the first key segment, this matches
 * across all space-scoped variants in a single pass. Use it for the many
 * `monthlyBudget`-style predicate invalidations in the entity mutation hooks;
 * pass several roots to collapse a run of single-root invalidations into one call.
 */
export function invalidateRoots(qc: QueryClient, ...roots: string[]) {
  void qc.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) && roots.includes(query.queryKey[0] as string),
  });
}

/**
 * Apply an op's registry invalidation list ({@link getInvalidatesForOp}) on the
 * client, at root level: every registry key — `['x']`, `['x', '*']`, or
 * `['x', anything]` — invalidates its whole root `x`, mirroring (and slightly
 * broadening) the receiver-side `MutationExecutor.ensureSpaceAwareKey`
 * semantics. Use in a mutation hook's onSuccess when the registry list covers
 * everything the hook needs; keep an explicit `invalidateRoots` call when the
 * hook must refresh roots the registry doesn't list.
 */
export function applyOpInvalidations(qc: QueryClient, op: string) {
  const keys = getInvalidatesForOp(op) ?? [];
  const roots = [...new Set(keys.map((key) => key[0]))];
  if (roots.length > 0) {
    invalidateRoots(qc, ...roots);
  }
}
