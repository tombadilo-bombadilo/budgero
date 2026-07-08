import { useMutation, useQuery } from '@tanstack/react-query';
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';

/** Service interface for user preferences */
interface UserMetaService {
  getAllowOverAssignment(): Promise<boolean> | boolean;
}

/** Runtime services with userMeta */
interface ServicesWithUserMeta {
  userMeta?: UserMetaService;
}

/**
 * Hook to get the allow over-assignment preference
 * Returns true if the user has enabled flexible budgeting (allows over-assignment)
 */
export function useAllowOverAssignment() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = spaceId ?? 'global';

  return useQuery<boolean>({
    queryKey: ['allowOverAssignment', spaceKey],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      if (services?.userMeta) {
        const result = await services.userMeta.getAllowOverAssignment();
        return result ?? false;
      }
      return false;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Hook to update the allow over-assignment preference
 * Uses the mutation system for proper ZK sync and persistence
 */
function useUpdateAllowOverAssignment() {
  const runtime = useRuntime();

  return useMutation<void, Error, boolean>({
    mutationFn: async (value: boolean) => {
      // Use the mutation router for proper sync, encryption, and persistence.
      // Invalidation is executor-driven from the op's declared invalidates.
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setAllowOverAssignment',
        payload: { value },
        meta: { label: 'Update budget over-assignment setting' },
      });
    },
  });
}

/**
 * Convenience hook that provides both the query and mutation
 */
export function useAllowOverAssignmentPreference() {
  const { data: allowOverAssignment = false, ...queryRest } = useAllowOverAssignment();
  const updateMutation = useUpdateAllowOverAssignment();

  return {
    allowOverAssignment,
    isLoading: queryRest.isLoading,
    isError: queryRest.isError,
    error: queryRest.error,
    updateAllowOverAssignment: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}
