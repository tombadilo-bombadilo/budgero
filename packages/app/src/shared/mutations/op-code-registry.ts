import type { OpCall, OpCodeEntry, OpCodeExecutionContext } from './op-code-registry/shared';
import { accountOps } from './op-code-registry/domains/accounts';
import { bankSyncOps } from './op-code-registry/domains/bank-sync';
import { budgetOps } from './op-code-registry/domains/budgets';
import { categoryOps } from './op-code-registry/domains/categories';
import { chatOps } from './op-code-registry/domains/chat';
import { currencyOps } from './op-code-registry/domains/currency';
import { goalOps } from './op-code-registry/domains/goals';
import { importHistoryOps } from './op-code-registry/domains/import-history';
import { labelOps } from './op-code-registry/domains/labels';
import { llmSettingsOps } from './op-code-registry/domains/llm-settings';
import { monthlyBudgetOps } from './op-code-registry/domains/monthly-budgets';
import { payeeOps } from './op-code-registry/domains/payees';
import { customDashboardOps } from './op-code-registry/domains/custom-dashboards';
import { recurringOps } from './op-code-registry/domains/recurring';
import { reportOps } from './op-code-registry/domains/reports';
import { ruleOps } from './op-code-registry/domains/rules';
import { scenarioOps } from './op-code-registry/domains/scenarios';
import { transactionOps } from './op-code-registry/domains/transactions';
import { userPreferenceOps } from './op-code-registry/domains/user-preferences';
import { warrantyOps } from './op-code-registry/domains/warranties';

const domainOpCodeRegistry = {
  ...budgetOps,
  ...transactionOps,
  ...payeeOps,
  ...labelOps,
  ...recurringOps,
  ...ruleOps,
  ...categoryOps,
  ...accountOps,
  ...monthlyBudgetOps,
  ...goalOps,
  ...reportOps,
  ...customDashboardOps,
  ...scenarioOps,
  ...currencyOps,
  ...importHistoryOps,
  ...warrantyOps,
  ...userPreferenceOps,
  ...chatOps,
  ...llmSettingsOps,
  ...bankSyncOps,
} satisfies Record<string, OpCodeEntry>;

/** Unique invalidation keys, first occurrence order. */
function uniqueKeys(keys: string[][]): string[][] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = JSON.stringify(key);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function readOpCalls(args: Record<string, unknown>): OpCall[] {
  const { ops } = args;
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('"ops" must be a non-empty list of operations.');
  }
  return ops.map((call) => {
    const entry = call as Partial<OpCall> | null;
    if (!entry || typeof entry.op !== 'string' || entry.op === APPLY_OPS) {
      throw new Error('Invalid operation in "ops".');
    }
    return { op: entry.op, args: (entry.args ?? {}) as Record<string, unknown> };
  });
}

/** Op code that applies a list of ops as one mutation (multi-step undo/redo). */
export const APPLY_OPS = 'history.applyOps';

/**
 * Apply `ops` in order as one unit. Each step's inverse is built from its own
 * undo spec as it runs; if a step throws, the steps already applied are
 * reverted (newest first) before the error propagates, so a multi-step undo or
 * redo either applies completely or leaves the data as it was. Because the
 * whole list is one mutation, nothing is queued for sync unless every step
 * succeeded.
 */
async function applyOpsAtomically(
  ops: OpCall[],
  context?: OpCodeExecutionContext
): Promise<unknown[]> {
  const results: unknown[] = [];
  const inverses: OpCall[][] = [];
  for (const call of ops) {
    const spec = getUndoSpec(call.op);
    let before: unknown;
    let captured = true;
    if (spec?.capture) {
      try {
        before = await spec.capture(call.args);
      } catch {
        captured = false;
      }
    }
    let result: unknown;
    try {
      result = await executeMutationOp(call.op, call.args, context);
    } catch (error) {
      await revertApplied(inverses, context);
      throw error;
    }
    results.push(result);
    let inverse: OpCall[] = [];
    if (spec && captured) {
      try {
        const { budgetId } = call.args;
        inverse = (spec.build(call.args, result, before) ?? []).map((entry) =>
          budgetId !== undefined && entry.args.budgetId === undefined
            ? { ...entry, args: { ...entry.args, budgetId } }
            : entry
        );
      } catch {
        inverse = [];
      }
    }
    if (!inverse.length) {
      console.warn(`[OpCodeRegistry] ${APPLY_OPS}: no inverse for ${call.op}; cannot revert it`);
    }
    inverses.push(inverse);
  }
  return results;
}

async function revertApplied(inverses: OpCall[][], context?: OpCodeExecutionContext) {
  for (const inverse of [...inverses].reverse()) {
    for (const call of inverse) {
      try {
        await executeMutationOp(call.op, call.args, context);
      } catch (error) {
        console.error(`[OpCodeRegistry] ${APPLY_OPS}: failed to revert ${call.op}`, error);
      }
    }
  }
}

const historyOps = {
  [APPLY_OPS]: {
    execute: async (args, context) => applyOpsAtomically(readOpCalls(args), context),
    invalidates: uniqueKeys(
      Object.values(domainOpCodeRegistry as Record<string, OpCodeEntry>).flatMap(
        (entry) => entry.invalidates
      )
    ),
    invalidatesFor: (args) =>
      uniqueKeys(
        readOpCalls(args).flatMap((call) => getInvalidatesForOp(call.op, call.args) ?? [])
      ),
  },
} satisfies Record<string, OpCodeEntry>;

const flatOpCodeRegistry = {
  ...domainOpCodeRegistry,
  ...historyOps,
} satisfies Record<string, OpCodeEntry>;

/** Every known mutation op code — derived from the registry keys, so an op
 * string exists iff its registry entry does. */
export type OpCode = keyof typeof flatOpCodeRegistry;
export type OpCodeRegistry = Record<OpCode, OpCodeEntry>;

export const opCodeRegistry: OpCodeRegistry = flatOpCodeRegistry;

export const KNOWN_OP_CODES = new Set<string>(Object.keys(flatOpCodeRegistry));

export function isKnownOpCode(op: string): op is OpCode {
  return KNOWN_OP_CODES.has(op);
}

export type { OpCodeEntry } from './op-code-registry/shared';

/**
 * Execute a mutation operation using the registered op code.
 * Used by MutationManager for both local and remote mutations.
 */
export async function executeMutationOp(
  op: string,
  args: Record<string, unknown>,
  context?: OpCodeExecutionContext
): Promise<unknown> {
  if (!isKnownOpCode(op)) {
    console.warn(`[OpCodeRegistry] Unknown op code: ${op}`);
    throw new Error(`Unknown mutation op code: ${op}`);
  }

  const entry = opCodeRegistry[op];

  try {
    return await entry.execute(args, context);
  } catch (error) {
    console.error(`[OpCodeRegistry] Failed to apply mutation: ${op}`, error);
    throw error;
  }
}

/**
 * Args to execute and send for a mutation that originates on this device:
 * runs the op's `prepare` (IDs, rates) so every device replays the same values.
 * Receivers never call this — they execute the args they were sent.
 */
export async function prepareMutationArgs(
  op: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!isKnownOpCode(op)) return args;
  const entry: OpCodeEntry = opCodeRegistry[op];
  return entry.prepare ? await entry.prepare(args) : args;
}

/**
 * Get invalidation keys for a given op code. With `args`, ops that declare
 * `invalidatesFor` return the set for that call (local, remote and undo/redo
 * replays all pass the op's payload); without, the op's full list.
 */
export function getInvalidatesForOp(
  op: string,
  args?: Record<string, unknown>
): string[][] | undefined {
  if (!isKnownOpCode(op)) return undefined;
  const entry: OpCodeEntry | undefined = opCodeRegistry[op];
  if (args && entry?.invalidatesFor) return entry.invalidatesFor(args);
  return entry?.invalidates;
}

/**
 * Get undo spec for an op code if available.
 */
export function getUndoSpec(op: string) {
  if (!isKnownOpCode(op)) return undefined;
  const entry = opCodeRegistry[op];
  if (!entry?.undo) return undefined;
  return entry.redo ? { ...entry.undo, buildRedo: entry.redo.build } : entry.undo;
}
