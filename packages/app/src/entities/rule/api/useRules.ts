import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type {
  TransactionRule,
  TransactionRuleRun,
  TransactionRuleRunChange,
  CreateRuleInput,
  UpdateRuleInput,
  ExecuteRuleOptions,
  RuleExecutionResult,
  RuleRunUndoResult,
} from '@budgero/core/browser';

const RULE_QUERY_KEY = 'rules';
const RULE_RUNS_QUERY_KEY = 'ruleRuns';
const RULE_RUN_CHANGES_QUERY_KEY = 'ruleRunChanges';

export function useRules(budgetId: number) {
  return useSpaceQuery<TransactionRule[]>({
    key: [RULE_QUERY_KEY, budgetId],
    enabled: budgetId > 0,
    staleTime: 30 * 1000,
    queryFn: (services) => services.rules.listRules(budgetId),
  });
}

export function useRuleRuns(ruleId: number, limit = 20, enabled = true) {
  return useSpaceQuery<TransactionRuleRun[]>({
    key: [RULE_RUNS_QUERY_KEY, ruleId, limit],
    enabled: enabled && ruleId > 0,
    staleTime: 30 * 1000,
    queryFn: (services) => services.rules.listRuns(ruleId, limit, 0),
  });
}

export function useRuleRunChanges(runId: number, enabled = true) {
  return useSpaceQuery<TransactionRuleRunChange[]>({
    key: [RULE_RUN_CHANGES_QUERY_KEY, runId],
    enabled: enabled && runId > 0,
    staleTime: 30 * 1000,
    queryFn: (services) => services.rules.listRunChanges(runId),
  });
}

export function useCreateRule() {
  const runtime = useRuntime();
  return useMutation<TransactionRule, Error, CreateRuleInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<TransactionRule>(runtime, {
        op: 'rules.create',
        payload: { input },
        meta: { label: 'useCreateRule' },
      });
    },
  });
}

export function useUpdateRule() {
  const runtime = useRuntime();
  return useMutation<
    TransactionRule,
    Error,
    { id: number; budgetId: number; patch: UpdateRuleInput }
  >({
    mutationFn: async ({ id, patch }) => {
      return executeSpaceMutation<TransactionRule>(runtime, {
        op: 'rules.update',
        payload: { id, patch },
        meta: { label: 'useUpdateRule' },
      });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  const runtime = useRuntime();
  return useMutation<void, Error, { id: number; budgetId: number }>({
    mutationFn: async ({ id }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'rules.delete',
        payload: { id },
        meta: { label: 'useDeleteRule' },
      });
    },
    onSuccess: (_void, vars) => {
      // Invalidation is executor-driven (rules.delete invalidates). Still drop
      // the deleted rule's cached run history so it isn't refetched.
      qc.removeQueries({
        queryKey: [RULE_RUNS_QUERY_KEY, resolveSpaceKey(runtime.getActiveSpaceId()), vars.id],
      });
    },
  });
}

export function useExecuteRule() {
  const runtime = useRuntime();
  return useMutation<
    RuleExecutionResult,
    Error,
    { ruleId: number; budgetId: number; options?: ExecuteRuleOptions }
  >({
    mutationFn: async ({ ruleId, options }) => {
      // Invalidation is executor-driven from the rules.execute op invalidates,
      // which cover rule + run history and the transaction-side roots the run
      // may have touched.
      return executeSpaceMutation<RuleExecutionResult>(runtime, {
        op: 'rules.execute',
        payload: { ruleId, options },
        meta: { label: 'useExecuteRule' },
      });
    },
  });
}

export function useUndoRuleRun() {
  const runtime = useRuntime();
  return useMutation<RuleRunUndoResult, Error, { runId: number; ruleId: number; budgetId: number }>(
    {
      mutationFn: async ({ runId }) => {
        // Invalidation is executor-driven from the rules.undoRun op invalidates
        // (rule + run history + transaction-side roots).
        return executeSpaceMutation<RuleRunUndoResult>(runtime, {
          op: 'rules.undoRun',
          payload: { runId },
          meta: { label: 'useUndoRuleRun' },
        });
      },
    }
  );
}
