import type { MutationSpec, MutationResult } from '@budgero/runtime';
import { getRuntime } from '@shared/runtime/global';

export type { MutationSpec, MutationResult };

/** Minimal runtime surface needed to run a space-scoped mutation. */
type SpaceMutationRuntime = {
  getActiveSpaceId(): string | null;
  mutationsRouter(): MutationRouter;
};

/** Resolve the active space id, throwing when none is selected. */
export function requireActiveSpaceId(
  runtime: Pick<SpaceMutationRuntime, 'getActiveSpaceId'>
): string {
  const spaceId = runtime.getActiveSpaceId();
  if (!spaceId) {
    throw new Error('No active budget space selected');
  }
  return spaceId;
}

/**
 * Execute a mutation scoped to the active budget space.
 *
 * Resolves the active space id (throwing when none is selected), forwards the
 * spec to the mutation router, and unwraps `result.result`. Centralizes the
 * boilerplate every entity mutation otherwise repeats inline.
 */
export async function executeSpaceMutation<T>(
  runtime: SpaceMutationRuntime,
  spec: Omit<MutationSpec, 'spaceId'>
): Promise<T> {
  const spaceId = requireActiveSpaceId(runtime);
  const { result } = await runtime.mutationsRouter().execute<T>({ ...spec, spaceId });
  return result;
}

export class MutationRouter {
  async execute<T>(spec: MutationSpec): Promise<MutationResult<T>> {
    const runtime = getRuntime();
    if (!runtime) throw new Error('[MutationRouter] No runtime');
    return runtime.executeMutation<T>(spec);
  }
}
