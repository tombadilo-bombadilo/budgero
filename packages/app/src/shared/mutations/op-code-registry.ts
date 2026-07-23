import { dispatchTrialSignalForOp } from '@shared/lib/analytics/trial-signal-dispatch';
import type { OpCodeEntry } from './op-code-registry/shared';
import { accountOps } from './op-code-registry/domains/accounts';
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

const flatOpCodeRegistry = {
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
  args: Record<string, unknown>
): Promise<unknown> {
  if (!isKnownOpCode(op)) {
    console.warn(`[OpCodeRegistry] Unknown op code: ${op}`);
    throw new Error(`Unknown mutation op code: ${op}`);
  }

  const entry = opCodeRegistry[op];

  try {
    const result = await entry.execute(args);
    dispatchTrialSignalForOp(op, args, result);
    return result;
  } catch (error) {
    console.error(`[OpCodeRegistry] Failed to apply mutation: ${op}`, error);
    throw error;
  }
}

/**
 * Get invalidation keys for a given op code.
 * Used by MutationManager when processing remote mutations.
 */
export function getInvalidatesForOp(op: string): string[][] | undefined {
  if (!isKnownOpCode(op)) return undefined;
  return opCodeRegistry[op]?.invalidates;
}

/**
 * Get undo spec for an op code if available.
 */
export function getUndoSpec(op: string) {
  if (!isKnownOpCode(op)) return undefined;
  return opCodeRegistry[op]?.undo;
}
