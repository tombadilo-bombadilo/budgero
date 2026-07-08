import type {
  LogAutofillApplicationInput,
  CreateRuleInput,
  ExecuteRuleOptions,
  RuleExecutionResult,
  TransactionRule,
  TransactionRuleRunChange,
  UpdateRuleInput,
} from '@budgero/core/browser';
import {
  RULE_EXECUTE_TX_INVALIDATIONS,
  RULE_INVALIDATION_KEYS,
  S,
  safeCapture,
  type OpCodeEntry,
} from '../shared';

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
    execute: async (args) => {
      return await S().rules!.deleteRule(args.id as number);
    },
    invalidates: RULE_INVALIDATION_KEYS,
    undo: {
      capture: async (args) => safeCapture(() => S().rules!.getRule(args.id as number)),
      build: (_args, _result, before) => {
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
            lastRunAt: rule.lastRunAt ?? null,
            oneTimeConsumed: rule.oneTimeConsumed,
          };
        }),
      build: (args, result, before) => {
        const undoOps: { op: string; args: Record<string, unknown> }[] = [];
        const execResult = result as RuleExecutionResult | undefined;
        const snapshot = before as
          | { lastRunAt?: string | null; oneTimeConsumed?: boolean }
          | null
          | undefined;
        const changes = execResult?.changes ?? [];

        if (changes.length > 0) {
          [...changes].reverse().forEach((change: TransactionRuleRunChange) => {
            const metadata = (change.metadata || {}) as Record<string, unknown>;
            switch (change.field) {
              case 'memo': {
                const oldMemo =
                  typeof change.oldValue === 'string'
                    ? change.oldValue
                    : ((metadata.oldMemo as string) ?? '');
                undoOps.push({
                  op: 'transactions.updateColumn',
                  args: {
                    id: change.transactionId,
                    columnName: 'memo',
                    newValue: oldMemo,
                  },
                });
                break;
              }
              case 'categoryId': {
                const oldCategory = Number(
                  change.oldValue ?? metadata.previousCategoryId ?? metadata.categoryId
                );
                if (Number.isFinite(oldCategory)) {
                  undoOps.push({
                    op: 'transactions.updateColumn',
                    args: {
                      id: change.transactionId,
                      columnName: 'CategoryID',
                      newValue: oldCategory,
                    },
                  });
                }
                break;
              }
              case 'accountId': {
                const oldAccount = Number(
                  change.oldValue ?? metadata.previousAccountId ?? metadata.accountId
                );
                if (Number.isFinite(oldAccount)) {
                  undoOps.push({
                    op: 'transactions.updateColumn',
                    args: {
                      id: change.transactionId,
                      columnName: 'AccountID',
                      newValue: oldAccount,
                    },
                  });
                }
                break;
              }
              case 'amount': {
                const oldInflow = Number(metadata.oldInflow ?? 0);
                const oldOutflow = Number(metadata.oldOutflow ?? 0);
                if (Number.isFinite(oldInflow) && Number.isFinite(oldOutflow)) {
                  undoOps.push({
                    op: 'transactions.updateColumn',
                    args: {
                      id: change.transactionId,
                      columnName: 'inflow',
                      newValue: oldInflow,
                    },
                  });
                  undoOps.push({
                    op: 'transactions.updateColumn',
                    args: {
                      id: change.transactionId,
                      columnName: 'outflow',
                      newValue: oldOutflow,
                    },
                  });
                }
                break;
              }
              default:
                break;
            }
          });
        }

        if (snapshot) {
          undoOps.push({
            op: 'rules.update',
            args: {
              id: args.ruleId,
              patch: {
                lastRunAt: snapshot.lastRunAt,
                oneTimeConsumed: snapshot.oneTimeConsumed,
              } satisfies UpdateRuleInput,
            },
          });
        }

        return undoOps;
      },
    },
  },
  'rules.undoRun': {
    execute: async (args) => {
      return await S().rules!.undoRun(args.runId as number);
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
