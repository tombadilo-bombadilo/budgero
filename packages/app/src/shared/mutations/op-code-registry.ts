import { UnknownOpCodeError } from '@budgero/runtime';
import { getRuntime } from '@shared/runtime/global';
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

function readOpCalls(args: Record<string, unknown>, nested = [APPLY_OPS]): OpCall[] {
  const { ops } = args;
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('"ops" must be a non-empty list of operations.');
  }
  return ops.map((call) => {
    const entry = call as Partial<OpCall> | null;
    if (!entry || typeof entry.op !== 'string' || nested.includes(entry.op)) {
      throw new Error('Invalid operation in "ops".');
    }
    return { op: entry.op, args: (entry.args ?? {}) as Record<string, unknown> };
  });
}

/** Op code that applies a list of ops as one mutation (multi-step undo/redo). */
export const APPLY_OPS = 'history.applyOps';

/**
 * Op code of a redo that allocates the IDs of the op's first run again:
 * `{ ids, ops }`, where `ids` is the AUTOINCREMENT range per table the first
 * run used (see core id-reuse). Undo removes the rows an op created but the
 * counters stay put, so a plain redo would re-create every row but the main
 * one (passed explicitly) under new IDs: an account's opening row and payment
 * category, split lines, provenance, a payee entry. `ops` apply like
 * history.applyOps.
 */
export const REDO_WITH_IDS = 'history.redoWithIds';

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
  context?: OpCodeExecutionContext,
  /** Filled with each applied step's inverse, in order. */
  inverses: OpCall[][] = []
): Promise<unknown[]> {
  const results: unknown[] = [];
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
    if (call.op === REDO_WITH_IDS) {
      // A redo inside a grouped entry: its result lists the inverses it applied.
      inverse = (result as { undo?: OpCall[] } | undefined)?.undo ?? [];
    } else if (spec && captured) {
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

const ALL_DOMAIN_INVALIDATIONS = uniqueKeys(
  Object.values(domainOpCodeRegistry as Record<string, OpCodeEntry>).flatMap(
    (entry) => entry.invalidates
  )
);

const nestedInvalidations = (args: Record<string, unknown>) =>
  uniqueKeys(
    readOpCalls(args, []).flatMap((call) => getInvalidatesForOp(call.op, call.args) ?? [])
  );

const historyOps = {
  [APPLY_OPS]: {
    execute: async (args, context) => applyOpsAtomically(readOpCalls(args), context),
    invalidates: ALL_DOMAIN_INVALIDATIONS,
    invalidatesFor: nestedInvalidations,
  },
  [REDO_WITH_IDS]: {
    execute: async (args, context) => {
      const ops = readOpCalls(args, [APPLY_OPS, REDO_WITH_IDS]);
      const inverses: OpCall[][] = [];
      const apply = () => applyOpsAtomically(ops, context, inverses);
      const history = idHistory();
      const results = history ? await history.withReusedIds(args.ids, apply) : await apply();
      return { results, undo: [...inverses].reverse().flat() };
    },
    invalidates: ALL_DOMAIN_INVALIDATIONS,
    invalidatesFor: nestedInvalidations,
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
    // Typed so sync stops with "update required" instead of skipping it.
    throw new UnknownOpCodeError(op);
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

/** The MutationHistoryService methods behind REDO_WITH_IDS. */
interface IdHistory {
  idCounters(): Record<string, number>;
  allocatedIds(before: Record<string, number>): Record<string, [number | null, number]>;
  withReusedIds<T>(range: unknown, fn: () => Promise<T> | T): Promise<T>;
}

function idHistory(): IdHistory | null {
  try {
    const history = getRuntime()?.services?.()?.mutationHistory as Partial<IdHistory> | undefined;
    return typeof history?.idCounters === 'function' &&
      typeof history.allocatedIds === 'function' &&
      typeof history.withReusedIds === 'function'
      ? (history as IdHistory)
      : null;
  } catch {
    return null;
  }
}

function safeCounters(): Record<string, number> | null {
  try {
    return idHistory()?.idCounters() ?? null;
  } catch {
    return null;
  }
}

/** An op's undo capture plus the ID counters before it ran. */
class CaptureWithIds {
  constructor(
    readonly inner: unknown,
    readonly counters: Record<string, number>
  ) {}
}

const innerCapture = (before: unknown) =>
  before instanceof CaptureWithIds ? before.inner : before;

/**
 * Get undo spec for an op code if available. Its capture also notes the ID
 * counters, so the redo it builds carries the IDs the op allocated.
 */
export function getUndoSpec(op: string) {
  if (!isKnownOpCode(op)) return undefined;
  const entry: OpCodeEntry = opCodeRegistry[op];
  const { undo, redo } = entry;
  if (!undo) return undefined;
  return {
    capture: async (args: Record<string, unknown>) => {
      const inner = undo.capture ? await undo.capture(args) : undefined;
      const counters = safeCounters();
      return counters ? new CaptureWithIds(inner, counters) : inner;
    },
    build: (args: Record<string, unknown>, result: unknown, before: unknown) =>
      undo.build(args, result, innerCapture(before)),
    buildRedo: (
      args: Record<string, unknown>,
      result: unknown,
      before: unknown
    ): OpCall[] | null => {
      const built = redo?.build(args, result, innerCapture(before)) ?? null;
      if (!(before instanceof CaptureWithIds)) return built;
      const range = idHistory()?.allocatedIds(before.counters);
      if (!range || !Object.keys(range).length) return built;
      const ops = built?.length ? built : [{ op, args: { ...args } }];
      return [{ op: REDO_WITH_IDS, args: { ids: range, ops } }];
    },
  };
}
