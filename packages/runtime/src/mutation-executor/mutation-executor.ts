/**
 * MutationExecutor — executes SQL op + records undo + records history + invalidates UI queries.
 *
 * Does NOT own sync routing — no online/offline decision.
 * Used identically by both outbound and inbound mutation paths.
 *
 * Atomicity: apply mutation + record metadata in one path; invalidate queries AFTER.
 * Remote mutations: NO undo entries, YES history entries (flagged as origin: 'remote').
 * All side effects via injected callbacks.
 */

import type { MutationSpec, MutationExecutorDeps, SpecWithUserId } from '../types';
import { extractBudgetId } from '../types';
import { generateMutationId } from '../utils/id';
import { errorMessage } from '../utils/diagnostics';
import { logRuntime } from '../logging';

export interface ExecuteResult<T = unknown> {
  result: T;
  mutationId: string;
  isReceiver: boolean;
}

export class MutationExecutor {
  private readonly deps: MutationExecutorDeps;

  constructor(deps: MutationExecutorDeps) {
    this.deps = deps;
  }

  async execute<T>(spec: MutationSpec): Promise<ExecuteResult<T>> {
    if (!spec?.op || !spec?.payload) {
      throw new Error('[MutationExecutor] Invalid spec');
    }

    const mutationId = spec.mutationId || spec.idempotencyKey || generateMutationId();
    const isReceiver = !!spec.mutationId;
    const isMutator = !isReceiver;

    const activeSpaceId = spec.spaceId || this.deps.getActiveSpaceId();
    if (!activeSpaceId) {
      throw new Error('[MutationExecutor] No active budget space');
    }

    // Owner check for budget mutations
    const isBudgetMutation = spec.op.startsWith('budgets.');
    if (isMutator && isBudgetMutation) {
      const role = this.deps.getSpaceRole(activeSpaceId);
      if (role !== 'owner') {
        throw new Error(
          'Only the workspace owner can create or edit budgets. Ask the owner to make this change.'
        );
      }
    }

    logRuntime('debug', 'MutationExecutor', 'Executing mutation', {
      mutationId,
      isReceiver,
      op: spec.op,
      activeSpaceId,
    });

    // Capture before-state for undo
    let beforeState: unknown;
    const undoSpec = this.deps.getUndoSpec(spec.op);
    if (!spec.meta?.skipUndo && undoSpec?.capture) {
      try {
        beforeState = await undoSpec.capture(spec.payload);
      } catch {
        /* ignore capture errors */
      }
    }

    // Determine invalidates. The op's declared `invalidates` is the single
    // source of truth for BOTH local and remote mutations; a spec may still
    // pass an explicit list (undo/redo) to override.
    let { invalidates } = spec;
    if (!invalidates) {
      invalidates = this.deps.getInvalidatesForOp(spec.op);
    }
    const hasInvalidates = Array.isArray(invalidates) && invalidates.length > 0;

    // Execute op via registry
    const result = (await this.deps.executeOp(spec.op, spec.payload)) as T;

    // Invalidate queries for every origin (local + remote) off the op's
    // declared set. Previously only remote/forced mutations invalidated here
    // and local mutations relied on per-hook onSuccess handlers; consolidating
    // to one place removes that duplicated, drift-prone invalidation policy.
    const shouldInvalidate = hasInvalidates && spec.meta?.skipInvalidate !== true;

    if (shouldInvalidate && invalidates) {
      const qc = this.deps.getQueryClient();
      if (qc) {
        for (const key of invalidates) {
          const spaceAwareKey = this.ensureSpaceAwareKey(key, activeSpaceId);
          if (key.includes('*')) {
            const base = key[0];
            await qc.invalidateQueries({
              predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === base,
            });
            const spaceBase = spaceAwareKey[0];
            if (spaceBase !== base) {
              await qc.invalidateQueries({
                predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === spaceBase,
              });
            }
          } else {
            await qc.invalidateQueries({ queryKey: key });
            if (!this.keysEqual(key, spaceAwareKey)) {
              await qc.invalidateQueries({ queryKey: spaceAwareKey });
            }
          }
        }
      }
    }

    // Record undo for local actions
    let undoOps: { op: string; args: Record<string, unknown> }[] | null = null;
    let redoOps: { op: string; args: Record<string, unknown> }[] | null = null;

    if (isMutator && !spec.meta?.skipUndo && undoSpec?.build) {
      try {
        const builtUndoOps = undoSpec.build(spec.payload, result, beforeState) || [];
        if (builtUndoOps.length) {
          undoOps = builtUndoOps;
          redoOps = [{ op: spec.op, args: { ...spec.payload } }];
        }
      } catch {
        /* ignore */
      }
    }

    const budgetId = this.resolveHistoryBudgetId({
      spec,
      result,
      beforeState,
      undoOps,
      redoOps,
      spaceId: activeSpaceId,
      isReceiver,
    });

    if (budgetId !== null) {
      undoOps = this.withBudgetIdOnOps(undoOps, budgetId);
      redoOps = this.withBudgetIdOnOps(redoOps, budgetId);
    }

    if (isMutator && undoOps?.length) {
      this.deps.pushUndo({
        id: mutationId,
        label: spec.meta?.label,
        undo: undoOps,
        redo: redoOps ?? [{ op: spec.op, args: { ...spec.payload } }],
        ts: Date.now(),
      });
    }

    // Record to mutation history
    try {
      if (budgetId !== null) {
        const recordOrigin = spec.meta?.origin ?? (isMutator ? 'local' : 'remote');
        const s = spec as unknown as SpecWithUserId;

        this.deps.recordHistory({
          budgetId,
          spaceId: activeSpaceId,
          mutationId,
          userId: s.userId ?? null,
          op: spec.op,
          payload: spec.payload,
          origin: recordOrigin,
          undoOps: undoOps && undoOps.length > 0 ? undoOps : null,
          redoOps: redoOps && redoOps.length > 0 ? redoOps : null,
        });
      }
    } catch (historyError) {
      logRuntime('warn', 'MutationExecutor', 'Failed to record mutation history', {
        error: errorMessage(historyError),
      });
    }

    // Analytics tracking
    if (isMutator) {
      try {
        this.deps.onAnalyticsEvent?.(spec.op);
      } catch {
        /* no-op */
      }
    }

    logRuntime('debug', 'MutationExecutor', 'Mutation result', {
      mutationId,
      isReceiver,
    });

    return { result, mutationId, isReceiver };
  }

  private ensureSpaceAwareKey(key: string[], spaceId: string): string[] {
    if (!Array.isArray(key) || key.length === 0) {
      return ['space', spaceId];
    }
    if (key.some((part) => part === spaceId || part === `space:${spaceId}`)) {
      return key;
    }
    if (key[0] === 'space') {
      if (key[1] === spaceId) {
        return key;
      }
      return ['space', spaceId, ...key.slice(2)];
    }
    return [key[0], spaceId, ...key.slice(1)];
  }

  private keysEqual(a: string[], b: string[]): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private withBudgetIdOnOps(
    ops: { op: string; args: Record<string, unknown> }[] | null,
    budgetId: number
  ): { op: string; args: Record<string, unknown> }[] | null {
    if (!ops?.length) return ops;
    return ops.map((entry) => {
      const current = extractBudgetId(entry.args);
      if (current !== null) {
        return entry;
      }
      return {
        ...entry,
        args: { ...entry.args, budgetId },
      };
    });
  }

  private resolveHistoryBudgetId(params: {
    spec: MutationSpec;
    result: unknown;
    beforeState: unknown;
    undoOps: { op: string; args: Record<string, unknown> }[] | null;
    redoOps: { op: string; args: Record<string, unknown> }[] | null;
    spaceId: string;
    isReceiver: boolean;
  }): number | null {
    const directCandidates: (number | null)[] = [
      this.extractBudgetIdFromValue(params.spec.payload),
      this.extractBudgetIdFromValue(params.result),
      this.extractBudgetIdFromValue(params.beforeState),
      this.extractBudgetIdFromOps(params.undoOps),
      this.extractBudgetIdFromOps(params.redoOps),
    ];

    if (params.spec.op === 'budgets.create') {
      directCandidates.push(this.normalizeBudgetId(params.result));
    }

    for (const candidate of directCandidates) {
      if (candidate !== null) {
        return candidate;
      }
    }

    if (!this.deps.resolveHistoryBudgetId) {
      return null;
    }

    try {
      return this.normalizeBudgetId(
        this.deps.resolveHistoryBudgetId({
          op: params.spec.op,
          payload: params.spec.payload,
          result: params.result,
          beforeState: params.beforeState,
          undoOps: params.undoOps,
          redoOps: params.redoOps,
          spaceId: params.spaceId,
          isReceiver: params.isReceiver,
        })
      );
    } catch {
      return null;
    }
  }

  private extractBudgetIdFromOps(
    ops: { op: string; args: Record<string, unknown> }[] | null
  ): number | null {
    if (!ops?.length) return null;
    for (const entry of ops) {
      const budgetId = this.extractBudgetIdFromValue(entry.args);
      if (budgetId !== null) {
        return budgetId;
      }
    }
    return null;
  }

  private extractBudgetIdFromValue(value: unknown): number | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
    const visited = new Set<object>();

    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) break;
      const { value: current, depth } = next;

      if (!current || typeof current !== 'object' || depth > 3) {
        continue;
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          stack.push({ value: item, depth: depth + 1 });
        }
        continue;
      }

      const direct = extractBudgetId(current as Record<string, unknown>);
      if (direct !== null) {
        return direct;
      }

      for (const nested of Object.values(current as Record<string, unknown>)) {
        if (nested && typeof nested === 'object') {
          stack.push({ value: nested, depth: depth + 1 });
        }
      }
    }

    return null;
  }

  private normalizeBudgetId(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.trunc(parsed);
  }
}
