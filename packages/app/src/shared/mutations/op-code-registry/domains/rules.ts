import { isRowJournal } from '@budgero/core/browser';
import type {
  LogAutofillApplicationInput,
  CreateRuleInput,
  ExecuteRuleOptions,
  RedoRunOptions,
  RuleExecutionResult,
  RuleRunState,
  TransactionRule,
  UpdateRuleInput,
} from '@budgero/core/browser';
import {
  RULE_EXECUTE_TX_INVALIDATIONS,
  RULE_INVALIDATION_KEYS,
  S,
  safeCapture,
  type OpCodeEntry,
} from '../shared';

type RuleRunSnapshot = {
  ruleId: number;
  budgetId: number;
  mode: TransactionRule['mode'];
  lastRunAt: string | null;
  oneTimeConsumed?: boolean;
};

/** Run statuses an execution can end with; core undoRun takes all of them (failed: allowFailed). */
const FINISHED_RUN_STATUSES = new Set<string>(['completed', 'partial', 'failed']);

export const ruleOps = {
  'rules.create': {
    execute: async (args) => {
      return await S().rules!.createRule(args.input as CreateRuleInput);
    },
    invalidates: RULE_INVALIDATION_KEYS,
    undo: {
      build: (_args, result) => {
        const rule = result as TransactionRule | undefined;
        if (!rule?.id) return [];
        return [
          {
            op: 'rules.delete',
            args: {
              id: rule.id,
              budgetId: rule.budgetId,
            },
          },
        ];
      },
    },
    // Redo restores the created rule as-is, keeping its ID.
    redo: {
      build: (_args, result) => {
        const rule = result as TransactionRule | undefined;
        return rule?.id ? [{ op: 'rules.restore', args: { snapshot: rule } }] : [];
      },
    },
  },

  'rules.update': {
    execute: async (args) => {
      return await S().rules!.updateRule(args.id as number, (args.patch || {}) as UpdateRuleInput);
    },
    invalidates: RULE_INVALIDATION_KEYS,
    undo: {
      capture: async (args) => safeCapture(() => S().rules!.getRule(args.id as number)),
      build: (args, _result, before) => {
        const snapshot = before as Partial<TransactionRule> | null | undefined;
        if (!snapshot) return [];
        return [
          {
            op: 'rules.update',
            args: {
              id: args.id,
              patch: {
                name: snapshot.name,
                description: snapshot.description,
                conditions: snapshot.conditions,
                actions: snapshot.actions,
                mode: snapshot.mode,
                enabled: snapshot.enabled,
                runOrder: snapshot.runOrder,
                oneTimeConsumed: snapshot.oneTimeConsumed,
                lastRunAt: snapshot.lastRunAt ?? null,
              } satisfies UpdateRuleInput,
            },
          },
        ];
      },
    },
  },

  'rules.delete': {
    // Returns the delete's journal (the rule with its run history), or null.
    execute: async (args) => {
      return S().rules!.deleteRuleWithUndo(args.id as number);
    },
    invalidates: RULE_INVALIDATION_KEYS,
    undo: {
      capture: async (args) => safeCapture(() => S().rules!.getRule(args.id as number)),
      build: (_args, result, before) => {
        // The journal brings back the rule's run history too; without one
        // (history too large) only the rule comes back.
        if (isRowJournal(result)) {
          return [{ op: 'rules.restoreDeleted', args: { journal: result } }];
        }
        if (!before) return [];
        return [
          {
            op: 'rules.restore',
            args: {
              snapshot: before,
            },
          },
        ];
      },
    },
  },

  /** Undo of rules.delete: put the rule and its run history back exactly. */
  'rules.restoreDeleted': {
    execute: async (args) => {
      if (!isRowJournal(args.journal)) throw new Error('Nothing to restore');
      return S().rules!.restoreDeletedRule(args.journal);
    },
    invalidates: RULE_INVALIDATION_KEYS,
  },

  'rules.restore': {
    execute: async (args) => {
      return await S().rules!.restoreRule(args.snapshot as TransactionRule);
    },
    invalidates: RULE_INVALIDATION_KEYS,
  },

  'rules.execute': {
    execute: async (args) => {
      return await S().rules!.executeRule(
        args.ruleId as number,
        (args.options || {}) as ExecuteRuleOptions
      );
    },
    invalidates: [...RULE_INVALIDATION_KEYS, ...RULE_EXECUTE_TX_INVALIDATIONS],
    undo: {
      capture: async (args) =>
        safeCapture(async () => {
          const rule = await S().rules!.getRule(args.ruleId as number);
          return {
            ruleId: rule.id,
            budgetId: rule.budgetId,
            mode: rule.mode,
            lastRunAt: rule.lastRunAt ?? null,
            oneTimeConsumed: rule.oneTimeConsumed,
          };
        }),
      // One op, same code path as Rules -> "Undo run": core undoRun restores
      // every logged field (payee included), marks the run undone, and puts
      // the rule's lastRunAt/oneTimeConsumed back as they were. A failed run
      // changed no transaction; it is marked undone the same way.
      build: (_args, result, before) => {
        const execResult = result as RuleExecutionResult | undefined;
        const snapshot = before as RuleRunSnapshot | null | undefined;
        if (!execResult?.run?.id || !snapshot) return [];
        if (!FINISHED_RUN_STATUSES.has(execResult.run.status)) return [];
        const ruleState: RuleRunState = {
          lastRunAt: snapshot.lastRunAt ?? null,
          oneTimeConsumed: Boolean(snapshot.oneTimeConsumed),
        };
        return [
          {
            op: 'rules.undoRun',
            args: {
              runId: execResult.run.id,
              ruleState,
              ...(execResult.run.status === 'failed' ? { allowFailed: true } : {}),
            },
          },
        ];
      },
    },
    redo: {
      // Re-running the rule would log a new run the undo entry doesn't know;
      // redo re-applies the same run instead.
      build: (args, result, before) => {
        const execResult = result as RuleExecutionResult | undefined;
        const snapshot = before as RuleRunSnapshot | null | undefined;
        if (!execResult?.run?.id || !snapshot) return [];
        if (!FINISHED_RUN_STATUSES.has(execResult.run.status)) {
          return [{ op: 'rules.execute', args }];
        }
        const trigger = (args.options as ExecuteRuleOptions | undefined)?.trigger;
        return [
          {
            op: 'rules.redoRun',
            args: {
              runId: execResult.run.id,
              ruleState: {
                lastRunAt: execResult.lastRunAt ?? execResult.run.completedAt ?? null,
                oneTimeConsumed:
                  snapshot.mode === 'one_time' ? true : Boolean(snapshot.oneTimeConsumed),
              } satisfies RuleRunState,
              run: {
                status: execResult.run.status,
                notes: execResult.run.notes ?? '',
                transactionCount: execResult.run.transactionCount,
              },
              // A continuous run is undone together with the add that
              // triggered it, whose undo deletes the row and with it the
              // run's change rows: redo needs them back. (Small: the rows of
              // one add. A manual run's change rows stay in the database.)
              ...(trigger === 'continuous' ? { changes: execResult.changes } : {}),
            },
          },
        ];
      },
    },
  },
  'rules.undoRun': {
    execute: async (args) => {
      return await S().rules!.undoRun(args.runId as number, {
        ...(args.ruleState ? { ruleState: args.ruleState as RuleRunState } : {}),
        ...(args.allowFailed === true ? { allowFailed: true } : {}),
      });
    },
    invalidates: [...RULE_INVALIDATION_KEYS, ...RULE_EXECUTE_TX_INVALIDATIONS],
  },
  'rules.redoRun': {
    execute: async (args) => {
      return await S().rules!.redoRun(args.runId as number, {
        ruleState: args.ruleState as RuleRunState | undefined,
        run: args.run as RedoRunOptions['run'],
        changes: Array.isArray(args.changes)
          ? (args.changes as RedoRunOptions['changes'])
          : undefined,
      });
    },
    invalidates: [...RULE_INVALIDATION_KEYS, ...RULE_EXECUTE_TX_INVALIDATIONS],
  },
  'rules.logAutofillApplication': {
    execute: async (args) => {
      const input: LogAutofillApplicationInput = {
        transactionId: Number(args.transactionId),
        changes: Array.isArray(args.changes)
          ? (args.changes as LogAutofillApplicationInput['changes'])
          : [],
      };
      return await S().rules!.logAutofillApplication(input);
    },
    invalidates: RULE_INVALIDATION_KEYS,
  },
} satisfies Record<string, OpCodeEntry>;
