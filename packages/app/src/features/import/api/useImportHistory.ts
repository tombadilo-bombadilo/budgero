import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type { ImportRun, ImportRunUndoResult, ImportRunRecordInput } from '@budgero/core/browser';

const HISTORY_QUERY_KEY = 'importHistory';

export function useImportHistory(budgetId: number) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);

  return useQuery<ImportRun[]>({
    queryKey: [HISTORY_QUERY_KEY, spaceKey, budgetId],
    queryFn: async () => {
      if (!spaceId || !budgetId) {
        return [];
      }
      const services = runtime.services();
      return services.importHistory.listImportRuns(budgetId);
    },
    enabled: Boolean(spaceId) && budgetId > 0,
    staleTime: 30_000,
    retry: 1,
  });
}

type RecordImportParams = {
  input: ImportRunRecordInput;
  budgetId: number;
};

export function useRecordImportRun() {
  const runtime = useRuntime();
  return useMutation<number, Error, RecordImportParams>({
    mutationFn: async ({ input }) => {
      return executeSpaceMutation<number>(runtime, {
        op: 'importHistory.record',
        payload: { input },
        meta: { label: 'useRecordImportRun' },
      });
    },
  });
}

type UndoImportParams = {
  id: number;
  budgetId: number;
};

export function useUndoImportRun() {
  const runtime = useRuntime();
  const qc = useQueryClient();
  return useMutation<ImportRunUndoResult, Error, UndoImportParams>({
    mutationFn: async ({ id }) => {
      return executeSpaceMutation<ImportRunUndoResult>(runtime, {
        op: 'importHistory.undo',
        payload: { id },
        meta: { label: 'useUndoImportRun' },
      });
    },
    onSuccess: async () => {
      // The op's declared invalidates cover import history and the transaction
      // roots. Undo can touch almost anything, so additionally nuke the whole
      // cache (similar to offline queue replay) so every hook refreshes.
      try {
        await qc.invalidateQueries();
      } catch (error) {
        console.warn('[useUndoImportRun] Failed to invalidate all queries after undo', error);
      }
    },
  });
}

type DeleteImportParams = {
  id: number;
  budgetId: number;
};

export function useDeleteImportRun() {
  const runtime = useRuntime();
  return useMutation<void, Error, DeleteImportParams>({
    mutationFn: async ({ id }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'importHistory.delete',
        payload: { id },
        meta: { label: 'useDeleteImportRun' },
      });
    },
  });
}
