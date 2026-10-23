/**
 * Analytics for local mutations: maps an op (+ its args/result) to registry
 * events. Called by AppRuntime.executeMutation after a local, non-replay
 * mutation commits. Only enum fields are read from args; nothing else is
 * forwarded (track() re-validates every value).
 */
import { track } from './track';
import { actionsBucket, countBucket, TRANSACTION_ENTRIES, type TransactionEntry } from './events';

interface GoalLike {
  Type?: string;
}
interface RuleLike {
  mode?: string;
  actions?: unknown[];
}
interface RecurringLike {
  toAccountId?: number | null;
  direction?: string;
  schedule?: { intervalUnit?: string };
}

/** The few service reads the mapping needs (structural, for tests). */
export interface MutationAnalyticsServices {
  goals?: { getGoalByCategoryID(categoryId: number): GoalLike | null | undefined };
  rules?: { getRule(id: number): RuleLike | null | undefined };
  recurring?: {
    getRecurringTransaction(
      id: number,
      opts?: { includeInactive?: boolean }
    ): RecurringLike | null | undefined;
  };
  budgets?: { getBudget(id: number): { DisplayCurrency?: string } | null | undefined };
}

export interface MutationAnalyticsSpec {
  op: string;
  payload?: unknown;
  meta?: {
    label?: string;
    origin?: 'local' | 'remote';
    analytics?: string;
    deferContinuousRules?: boolean;
    replay?: 'undo' | 'redo';
  };
}

type Args = Record<string, unknown>;
const asArgs = (v: unknown): Args => (v && typeof v === 'object' ? (v as Args) : {});
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

function entryOf(spec: MutationAnalyticsSpec, fallback: TransactionEntry): TransactionEntry {
  const hint = spec.meta?.analytics;
  if (hint && (TRANSACTION_ENTRIES as readonly string[]).includes(hint)) {
    return hint as TransactionEntry;
  }
  const label = spec.meta?.label ?? '';
  if (label === 'push-api') return 'push';
  if (label === 'bank-sync') return 'bank_sync';
  if (label.startsWith('ai.')) return 'ai_assistant';
  if (label.startsWith('convertToTransfer') || label.startsWith('unlinkTransfer')) {
    return 'transfer_convert';
  }
  return fallback;
}

function ruleTrigger(mode: unknown): 'manual' | 'continuous' | 'autofill' | null {
  if (mode === 'continuous' || mode === 'autofill') return mode;
  if (mode === 'one_time') return 'manual';
  return null;
}

function trackRule(name: 'rule_created' | 'rule_edited' | 'rule_deleted', rule: RuleLike | null) {
  const trigger = ruleTrigger(rule?.mode ?? 'continuous');
  if (!trigger) return;
  track(name, {
    trigger,
    actions_bucket: actionsBucket(Array.isArray(rule?.actions) ? rule.actions.length : 1),
  });
}

const FREQUENCIES = ['day', 'week', 'month', 'year'] as const;

function recurringProps(t: RecurringLike | null | undefined) {
  if (!t) return null;
  const frequency = FREQUENCIES.find((f) => f === t.schedule?.intervalUnit);
  if (!frequency) return null;
  const kind: 'expense' | 'income' | 'transfer' =
    t.toAccountId != null ? 'transfer' : t.direction === 'inflow' ? 'income' : 'expense';
  return { frequency, kind };
}

function safe<T>(read: () => T): T | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

/** State that must be read before the op runs (deletes). */
export interface BeforeState {
  goalType?: string | null;
  rule?: RuleLike | null;
  recurring?: RecurringLike | null;
}

export function readBeforeState(
  spec: MutationAnalyticsSpec,
  services: MutationAnalyticsServices | null
): BeforeState | null {
  if (!services) return null;
  const args = asArgs(spec.payload);
  switch (spec.op) {
    case 'goals.delete':
      return {
        goalType: safe(() => services.goals?.getGoalByCategoryID(num(args.categoryId))?.Type),
      };
    case 'rules.delete':
      return { rule: safe(() => services.rules?.getRule(num(args.id))) };
    case 'recurring.delete':
      return {
        recurring: safe(() =>
          services.recurring?.getRecurringTransaction(num(args.id), { includeInactive: true })
        ),
      };
    default:
      return null;
  }
}

export function reportMutationAnalytics(
  spec: MutationAnalyticsSpec,
  result: unknown,
  services: MutationAnalyticsServices | null,
  before: BeforeState | null = null
): void {
  if (spec.meta?.replay) return;
  const args = asArgs(spec.payload);
  const res = asArgs(result);

  switch (spec.op) {
    case 'transactions.add':
    case 'transactions.addTransfer': {
      const entry = entryOf(spec, 'other');
      track('Transaction Logged', { entry });
      if (Array.isArray(args.splits) && args.splits.length > 0) {
        track('feature_used', { feature: 'split', action: 'created' });
      }
      if (entry === 'transfer_convert') {
        track('feature_used', { feature: 'transfer_convert', action: 'created' });
      }
      return;
    }
    case 'transactions.import':
      if (res.created === false) return;
      track('Transaction Logged', {
        entry: entryOf(spec, spec.meta?.deferContinuousRules ? 'bank_sync' : 'import'),
      });
      return;
    case 'recurring.markReady':
      track('Transaction Logged', { entry: 'recurring' });
      return;
    case 'transactions.updateColumn':
      track('Transaction Edited');
      return;
    case 'transactions.delete':
      track('Transaction Deleted');
      return;
    case 'transactions.reconcileCleared':
      track('reconcile_completed');
      track('feature_used', { feature: 'reconcile', action: 'created' });
      return;
    case 'accounts.create': {
      const budgetCurrency = safe(
        () => services?.budgets?.getBudget(num(args.budgetId))?.DisplayCurrency
      );
      const type = typeof args.type === 'string' ? args.type : '';
      track('Account Added', {
        type:
          (
            [
              'Checking',
              'Savings',
              'Cash',
              'Credit',
              'Loan',
              'Mortgage',
              'Real Estate',
              'Other Asset',
              'Investment',
              'Crypto',
              'Retirement',
            ] as const
          ).find((t) => t.toLowerCase() === type.toLowerCase()) ?? 'other',
        currency_is_budget_currency:
          budgetCurrency && typeof args.currency === 'string' && args.currency !== budgetCurrency
            ? 'no'
            : 'yes',
      });
      return;
    }
    case 'accounts.setArchived':
      if (args.archived === true) track('account_closed');
      return;
    case 'categories.create':
      track('Category Added');
      return;
    case 'categories.updateName':
      track('Category Edited');
      return;
    case 'categories.delete':
      track('Category Deleted');
      return;
    case 'categoryGroups.create':
      track('Category Group Added');
      return;
    case 'categoryGroups.update':
      track('Category Group Edited');
      return;
    case 'categoryGroups.delete':
      track('Category Group Deleted');
      return;
    case 'monthlyBudgets.upsertAssignment':
      track('Assignment Upserted');
      return;
    case 'goals.create':
    case 'goals.update': {
      const type = String(args.goalType ?? '');
      track(spec.op === 'goals.create' ? 'goal_created' : 'goal_edited', { type } as never);
      if (spec.op === 'goals.create')
        track('feature_used', { feature: 'goals', action: 'created' });
      return;
    }
    case 'goals.delete':
      if (before?.goalType) track('goal_deleted', { type: before.goalType } as never);
      return;
    case 'rules.create':
      trackRule('rule_created', asArgs(args.input) as RuleLike);
      track('feature_used', { feature: 'rules', action: 'created' });
      return;
    case 'rules.update':
      trackRule('rule_edited', (result as RuleLike) ?? null);
      return;
    case 'rules.delete':
      if (before?.rule) trackRule('rule_deleted', before.rule);
      return;
    case 'rules.execute': {
      const options = asArgs(args.options);
      const trigger =
        options.trigger === 'continuous'
          ? spec.meta?.analytics === 'bank_sync' || spec.meta?.analytics === 'import'
            ? spec.meta.analytics
            : 'on_add'
          : 'manual';
      const matched = num(res.matchedCount);
      // Automatic runs that matched nothing are noise: skip them.
      if (trigger !== 'manual' && !(matched > 0)) return;
      const { status } = asArgs(res.run);
      track('rule_run', {
        trigger,
        outcome: status === 'failed' ? 'error' : 'ok',
        matched_bucket: countBucket(matched),
      });
      return;
    }
    case 'rules.undoRun':
      track('rule_run_undone');
      return;
    case 'recurring.create': {
      const props = recurringProps(asArgs(args.input) as RecurringLike);
      if (props) track('recurring_created', props);
      track('feature_used', { feature: 'recurring', action: 'created' });
      return;
    }
    case 'recurring.update': {
      const props = recurringProps(result as RecurringLike);
      if (props) track('recurring_edited', props);
      return;
    }
    case 'recurring.delete': {
      const props = recurringProps(before?.recurring);
      if (props) track('recurring_deleted', props);
      return;
    }
    case 'scenarios.save':
      track('feature_used', { feature: 'scenarios', action: 'created' });
      return;
    case 'recurring.skip':
      track('recurring_skipped');
      return;
    default:
      return;
  }
}
