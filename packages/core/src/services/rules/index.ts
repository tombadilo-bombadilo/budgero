import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { asMilli, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import { NotFoundError, ValidationError } from '../../types/index.js';
import { safeParseJSON } from '../../utils/json.js';
import { TransactionService } from '../transactions/index.js';
import type { Transaction } from '../transactions/types.js';

import { createLogger } from '../../logger.js';

const debugLog = createLogger('services:rules');

export type RuleMode = 'continuous' | 'one_time' | 'autofill';

export type RuleConditionField = 'memo' | 'amount' | 'account' | 'payee';

export type MemoConditionOperator = 'equals' | 'contains' | 'regex';
export type PayeeConditionOperator = 'equals' | 'contains' | 'regex';
export type AmountConditionOperator = '>=' | '>' | '<=' | '<' | '=' | '!=';
export type AccountConditionOperator = 'is' | 'is_not';

export type RuleConditionOperator =
  | MemoConditionOperator
  | PayeeConditionOperator
  | AmountConditionOperator
  | AccountConditionOperator;

export interface RuleCondition {
  field: RuleConditionField;
  operator: RuleConditionOperator;
  value: string | number;
  options?: {
    caseSensitive?: boolean;
  };
}

export type RuleActionType =
  | 'memo.remove_regex'
  | 'memo.set'
  | 'category.set'
  | 'payee.set'
  | 'amount.set'
  | 'amount.adjust_value'
  | 'amount.adjust_percent'
  | 'account.set';

export interface RuleActionBase<TType extends RuleActionType, TMeta = Record<string, unknown>> {
  type: TType;
  payload: TMeta;
}

export type MemoRemoveRegexAction = RuleActionBase<
  'memo.remove_regex',
  {
    pattern: string;
    flags?: string;
  }
>;

export type MemoSetAction = RuleActionBase<
  'memo.set',
  {
    memo: string;
  }
>;

export type CategorySetAction = RuleActionBase<
  'category.set',
  {
    categoryId: number;
  }
>;

export type PayeeSetAction = RuleActionBase<
  'payee.set',
  {
    payee: string;
  }
>;

export type AmountSetAction = RuleActionBase<
  'amount.set',
  {
    amount: number;
  }
>;

export type AmountAdjustValueAction = RuleActionBase<
  'amount.adjust_value',
  {
    delta: number; // Positive to increase, negative to decrease
  }
>;

export type AmountAdjustPercentAction = RuleActionBase<
  'amount.adjust_percent',
  {
    percent: number; // Positive to increase, negative to decrease
  }
>;

export type AccountSetAction = RuleActionBase<
  'account.set',
  {
    accountId: number;
  }
>;

export type RuleAction =
  | MemoRemoveRegexAction
  | MemoSetAction
  | CategorySetAction
  | PayeeSetAction
  | AmountSetAction
  | AmountAdjustValueAction
  | AmountAdjustPercentAction
  | AccountSetAction;

export interface TransactionRule {
  id: number;
  budgetId: number;
  name: string;
  description: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  mode: RuleMode;
  enabled: boolean;
  oneTimeConsumed: boolean;
  runOrder: number;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RuleTrigger = 'manual' | 'retroactive' | 'continuous' | 'autofill';
export type RuleRunStatus = 'pending' | 'completed' | 'failed' | 'partial' | 'undone';

export interface TransactionRuleRun {
  id: number;
  ruleId: number;
  trigger: RuleTrigger;
  startedAt: string;
  completedAt?: string | null;
  status: RuleRunStatus;
  transactionCount: number;
  notes: string;
}

export interface TransactionRuleRunChange {
  id: number;
  runId: number;
  ruleId: number;
  transactionId: number;
  actionType: RuleActionType | string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface CreateRuleInput {
  budgetId: number;
  name: string;
  description?: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  mode?: RuleMode;
  enabled?: boolean;
  runOrder?: number;
}

export interface UpdateRuleInput {
  name?: string;
  description?: string;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  mode?: RuleMode;
  enabled?: boolean;
  runOrder?: number;
  oneTimeConsumed?: boolean;
  lastRunAt?: string | null;
}

export interface CreateRuleRunInput {
  ruleId: number;
  trigger: RuleTrigger;
  status?: RuleRunStatus;
  completedAt?: string | null;
  notes?: string;
  transactionCount?: number;
}

export interface UpdateRuleRunInput {
  runId: number;
  status?: RuleRunStatus;
  completedAt?: string | null;
  notes?: string;
  transactionCount?: number;
}

export interface LogRuleRunChangeInput {
  runId: number;
  ruleId: number;
  transactionId: number;
  actionType: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface ExecuteRuleOptions {
  transactionIds?: number[];
  trigger?: RuleTrigger;
}

export interface RuleExecutionResult {
  run: TransactionRuleRun;
  changes: TransactionRuleRunChange[];
  evaluatedCount: number;
  matchedCount: number;
  errors: string[];
}

export interface RuleRunUndoResult {
  run: TransactionRuleRun;
  restoredTransactions: number;
}

export interface AutofillApplicationChange {
  ruleId: number;
  ruleName: string;
  field: string;
  value: string | number;
  actionType: string;
}

export interface LogAutofillApplicationInput {
  transactionId: number;
  changes: AutofillApplicationChange[];
}

export interface AutofillApplicationResult {
  runs: TransactionRuleRun[];
  changes: TransactionRuleRunChange[];
}

interface TransactionWorkingState {
  memo: string;
  categoryId: number;
  accountId: number;
  inflow: MilliUnits;
  outflow: MilliUnits;
  payee: string;
}

interface TransactionRuleRow {
  ID: number | bigint;
  BudgetID: number | bigint;
  Name: string;
  Description: string | null;
  ConditionsJSON: string;
  ActionsJSON: string;
  Mode: string;
  Enabled: number | boolean;
  OneTimeConsumed: number | boolean;
  RunOrder: number;
  LastRunAt: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

interface TransactionRuleRunRow {
  ID: number | bigint;
  RuleID: number | bigint;
  Trigger: string;
  StartedAt: string;
  CompletedAt: string | null;
  Status: string;
  TransactionCount: number;
  Notes: string;
}

interface TransactionRuleRunChangeRow {
  ID: number | bigint;
  RunID: number | bigint;
  RuleID: number | bigint;
  TransactionID: number | bigint;
  ActionType: string;
  Field: string | null;
  OldValue: string | null;
  NewValue: string | null;
  Metadata: string | null;
}

function toJSON(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

export class RulesService {
  private transactions: TransactionService;

  constructor(private db: DatabaseAdapter) {
    this.transactions = new TransactionService(db);
    this.ensureSchema();
  }

  listRules(budgetId: number): TransactionRule[] {
    const rows = allRows<TransactionRuleRow>(
      this.db,
      `SELECT * FROM transaction_rules WHERE BudgetID = ? ORDER BY RunOrder ASC, ID ASC`,
      budgetId
    );
    return rows.map((row) => this.mapRule(row));
  }

  getRule(id: number): TransactionRule {
    const row = getRow<TransactionRuleRow>(
      this.db,
      `SELECT * FROM transaction_rules WHERE ID = ? LIMIT 1`,
      id
    );
    if (!row) {
      throw new NotFoundError(`Rule ${id} not found`);
    }
    return this.mapRule(row);
  }

  createRule(input: CreateRuleInput): TransactionRule {
    const description = input.description ?? '';
    const mode = input.mode ?? 'continuous';
    const enabled = input.enabled ?? true;
    const runOrder = input.runOrder ?? 0;

    const result = run(
      this.db,
      `
      INSERT INTO transaction_rules (
        BudgetID,
        Name,
        Description,
        ConditionsJSON,
        ActionsJSON,
        Mode,
        Enabled,
        RunOrder,
        OneTimeConsumed,
        LastRunAt,
        CreatedAt,
        UpdatedAt
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, NULL, datetime('now'), datetime('now'))
    `,
      input.budgetId,
      input.name,
      description,
      toJSON(input.conditions ?? []),
      toJSON(input.actions ?? []),
      mode,
      enabled ? 1 : 0,
      runOrder
    );

    const id = Number(result.lastInsertRowid);
    return this.getRule(id);
  }

  updateRule(id: number, input: UpdateRuleInput): TransactionRule {
    const existing = this.getRule(id);

    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description ?? '';
    const conditions = input.conditions ?? existing.conditions;
    const actions = input.actions ?? existing.actions;
    const mode = input.mode ?? existing.mode;
    const enabled = input.enabled ?? existing.enabled;
    const runOrder = input.runOrder ?? existing.runOrder;
    const consumed =
      typeof input.oneTimeConsumed === 'boolean' ? input.oneTimeConsumed : existing.oneTimeConsumed;
    const lastRunAt =
      input.lastRunAt === undefined ? (existing.lastRunAt ?? null) : input.lastRunAt;

    run(
      this.db,
      `
      UPDATE transaction_rules
      SET
        Name = ?2,
        Description = ?3,
        ConditionsJSON = ?4,
        ActionsJSON = ?5,
        Mode = ?6,
        Enabled = ?7,
        RunOrder = ?8,
        OneTimeConsumed = ?9,
        LastRunAt = ?10,
        UpdatedAt = datetime('now')
      WHERE ID = ?1
    `,
      id,
      name,
      description,
      toJSON(conditions),
      toJSON(actions),
      mode,
      enabled ? 1 : 0,
      runOrder,
      consumed ? 1 : 0,
      lastRunAt ?? null
    );

    return this.getRule(id);
  }

  deleteRule(id: number): void {
    run(this.db, `DELETE FROM transaction_rules WHERE ID = ?`, id);
  }

  restoreRule(snapshot: TransactionRule): TransactionRule {
    if (!snapshot?.id) {
      throw new ValidationError('Cannot restore rule without an ID');
    }

    run(
      this.db,
      `
      INSERT INTO transaction_rules (
        ID,
        BudgetID,
        Name,
        Description,
        ConditionsJSON,
        ActionsJSON,
        Mode,
        Enabled,
        OneTimeConsumed,
        RunOrder,
        LastRunAt,
        CreatedAt,
        UpdatedAt
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      ON CONFLICT(ID) DO UPDATE SET
        BudgetID = excluded.BudgetID,
        Name = excluded.Name,
        Description = excluded.Description,
        ConditionsJSON = excluded.ConditionsJSON,
        ActionsJSON = excluded.ActionsJSON,
        Mode = excluded.Mode,
        Enabled = excluded.Enabled,
        OneTimeConsumed = excluded.OneTimeConsumed,
        RunOrder = excluded.RunOrder,
        LastRunAt = excluded.LastRunAt,
        CreatedAt = excluded.CreatedAt,
        UpdatedAt = excluded.UpdatedAt
    `,
      snapshot.id,
      snapshot.budgetId,
      snapshot.name,
      snapshot.description ?? '',
      toJSON(snapshot.conditions ?? []),
      toJSON(snapshot.actions ?? []),
      snapshot.mode ?? 'continuous',
      snapshot.enabled ? 1 : 0,
      snapshot.oneTimeConsumed ? 1 : 0,
      snapshot.runOrder ?? 0,
      snapshot.lastRunAt ?? null,
      snapshot.createdAt ?? new Date().toISOString(),
      snapshot.updatedAt ?? new Date().toISOString()
    );

    return this.getRule(snapshot.id);
  }

  createRun(input: CreateRuleRunInput): TransactionRuleRun {
    const completedAt = input.completedAt ?? null;
    const status = input.status ?? 'pending';
    const notes = input.notes ?? '';
    const transactionCount = input.transactionCount ?? 0;

    const result = run(
      this.db,
      `
      INSERT INTO transaction_rule_runs (
        RuleID,
        Trigger,
        StartedAt,
        CompletedAt,
        Status,
        TransactionCount,
        Notes
      )
      VALUES (?1, ?2, datetime('now'), ?3, ?4, ?5, ?6)
    `,
      input.ruleId,
      input.trigger,
      completedAt,
      status,
      transactionCount,
      notes
    );

    const id = Number(result.lastInsertRowid);
    return this.getRun(id);
  }

  updateRun(input: UpdateRuleRunInput): TransactionRuleRun {
    run(
      this.db,
      `
      UPDATE transaction_rule_runs
      SET
        Status = COALESCE(?2, Status),
        CompletedAt = CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE CompletedAt END,
        Notes = COALESCE(?4, Notes),
        TransactionCount = COALESCE(?5, TransactionCount)
      WHERE ID = ?1
    `,
      input.runId,
      input.status ?? null,
      input.completedAt ?? null,
      input.notes ?? null,
      input.transactionCount ?? null
    );

    return this.getRun(input.runId);
  }

  logRunChange(input: LogRuleRunChangeInput): TransactionRuleRunChange {
    const result = run(
      this.db,
      `
      INSERT INTO transaction_rule_run_changes (
        RunID,
        RuleID,
        TransactionID,
        ActionType,
        Field,
        OldValue,
        NewValue,
        Metadata
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `,
      input.runId,
      input.ruleId,
      input.transactionId,
      input.actionType,
      input.field ?? null,
      input.oldValue === undefined ? null : toJSON(input.oldValue),
      input.newValue === undefined ? null : toJSON(input.newValue),
      input.metadata ? toJSON(input.metadata) : null
    );

    const id = Number(result.lastInsertRowid);
    return this.getRunChange(id);
  }

  async executeRule(
    ruleId: number,
    options: ExecuteRuleOptions = {}
  ): Promise<RuleExecutionResult> {
    const trigger = options.trigger ?? 'manual';
    const runStart = this.createRun({ ruleId, trigger, status: 'pending' });
    let runRecord = runStart;
    const changes: TransactionRuleRunChange[] = [];
    const errors: string[] = [];

    try {
      const rule = this.getRule(ruleId);
      const transactions = this.getCandidateTransactions(rule.budgetId, options.transactionIds);
      let matchedCount = 0;

      for (const tx of transactions) {
        if (!this.matchesRuleConditions(rule.conditions, tx)) {
          continue;
        }

        try {
          const appliedChanges = await this.applyRuleActions(rule, tx, runRecord.id);
          if (appliedChanges.length > 0) {
            changes.push(...appliedChanges);
            matchedCount += 1;
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : `Unknown error applying rule to transaction ${tx.ID}`;
          errors.push(`Transaction ${tx.ID}: ${message}`);
        }
      }

      const status: RuleRunStatus =
        errors.length === 0 ? 'completed' : matchedCount > 0 ? 'partial' : 'failed';

      runRecord = this.updateRun({
        runId: runRecord.id,
        status,
        completedAt: new Date().toISOString(),
        transactionCount: matchedCount,
        notes: errors.slice(0, 5).join('; ').slice(0, 500),
      });

      const timestamp = new Date().toISOString();
      this.updateRule(ruleId, {
        lastRunAt: timestamp,
        oneTimeConsumed: rule.mode === 'one_time' ? true : undefined,
      });

      return {
        run: runRecord,
        changes,
        evaluatedCount: transactions.length,
        matchedCount,
        errors,
      };
    } catch (error) {
      this.updateRun({
        runId: runRecord.id,
        status: 'failed',
        completedAt: new Date().toISOString(),
        notes: error instanceof Error ? error.message : 'Rule execution failed',
      });
      throw error;
    }
  }

  async undoRun(runId: number): Promise<RuleRunUndoResult> {
    const run = this.getRun(runId);
    if (!run.completedAt) {
      throw new ValidationError('Cannot undo a run that has not completed');
    }

    if (run.status !== 'completed' && run.status !== 'partial') {
      throw new ValidationError('Only completed runs can be undone');
    }

    const latestRow = getRow<{ ID: number | bigint }>(
      this.db,
      `SELECT ID FROM transaction_rule_runs WHERE RuleID = ? AND CompletedAt IS NOT NULL ORDER BY datetime(CompletedAt) DESC, ID DESC LIMIT 1`,
      run.ruleId
    );
    const latestId = latestRow ? Number(latestRow.ID) : null;
    if (latestId !== runId) {
      throw new ValidationError('Only the most recent completed run can be undone');
    }

    const changes = this.listRunChanges(runId);
    if (!changes.length) {
      const updated = this.updateRun({
        runId,
        status: 'undone',
        notes: this.appendNote(run.notes, 'Marked as undone (no changes recorded).'),
      });
      return {
        run: updated,
        restoredTransactions: 0,
      };
    }

    const rollbackMap = new Map<
      number,
      {
        memo?: string;
        categoryId?: number;
        accountId?: number;
        inflow?: number;
        outflow?: number;
        payee?: string;
      }
    >();

    for (const change of changes) {
      const metadata = (change.metadata ?? {}) as Record<string, unknown>;
      const entry = rollbackMap.get(change.transactionId) ?? {};

      switch (change.field) {
        case 'memo': {
          const oldMemo =
            typeof metadata.oldMemo === 'string'
              ? (metadata.oldMemo as string)
              : ((change.oldValue as string) ?? '');
          entry.memo = oldMemo ?? '';
          break;
        }
        case 'categoryId': {
          const oldCategory = Number(
            metadata.previousCategoryId ?? metadata.categoryId ?? change.oldValue
          );
          if (Number.isFinite(oldCategory)) {
            entry.categoryId = oldCategory;
          }
          break;
        }
        case 'accountId': {
          const oldAccount = Number(
            metadata.previousAccountId ?? metadata.accountId ?? change.oldValue
          );
          if (Number.isFinite(oldAccount)) {
            entry.accountId = oldAccount;
          }
          break;
        }
        case 'payee': {
          let oldPayee: string;
          if (typeof metadata.previousPayee === 'string') {
            oldPayee = metadata.previousPayee;
          } else if (typeof change.oldValue === 'string') {
            oldPayee = change.oldValue;
          } else {
            oldPayee = '';
          }
          entry.payee = oldPayee;
          break;
        }
        case 'amount': {
          const oldInflow = Number(metadata.oldInflow ?? change.oldValue);
          const oldOutflow = Number(metadata.oldOutflow ?? 0);
          if (Number.isFinite(oldInflow)) entry.inflow = oldInflow;
          if (Number.isFinite(oldOutflow)) entry.outflow = oldOutflow;
          break;
        }
        default:
          break;
      }

      rollbackMap.set(change.transactionId, entry);
    }

    let restoredTransactions = 0;

    for (const [transactionId, rollback] of rollbackMap.entries()) {
      try {
        const tx = this.transactions.getTransactionByID(transactionId);
        const nextInflow = asMilli(Number(rollback.inflow ?? tx.Inflow ?? 0));
        const nextOutflow = asMilli(Number(rollback.outflow ?? tx.Outflow ?? 0));
        const nextAccount = Number(rollback.accountId ?? tx.AccountID ?? 0);
        const nextCategory = Number(rollback.categoryId ?? tx.CategoryID ?? 0);
        const nextMemo = rollback.memo ?? tx.Memo ?? '';
        const nextPayee =
          rollback.payee !== undefined ? rollback.payee : (tx.Payee?.toString?.() ?? '');

        await this.transactions.updateTransaction(
          transactionId,
          nextInflow,
          nextOutflow,
          nextAccount,
          nextCategory,
          tx.Date,
          nextMemo,
          nextPayee
        );
        restoredTransactions += 1;
      } catch (error) {
        throw new Error(
          `Failed to restore transaction ${transactionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    const rule = this.getRule(run.ruleId);
    let previousCompletedAt: string | null = null;
    const prevRow = getRow<{ CompletedAt: string | null }>(
      this.db,
      `SELECT CompletedAt FROM transaction_rule_runs WHERE RuleID = ? AND ID <> ? AND CompletedAt IS NOT NULL ORDER BY datetime(CompletedAt) DESC, ID DESC LIMIT 1`,
      run.ruleId,
      runId
    );
    if (prevRow?.CompletedAt) {
      previousCompletedAt = String(prevRow.CompletedAt);
    }

    this.updateRule(rule.id, {
      lastRunAt: previousCompletedAt,
      oneTimeConsumed: rule.mode === 'one_time' ? false : undefined,
    });

    const updatedRun = this.updateRun({
      runId,
      status: 'undone',
      notes: this.appendNote(run.notes, 'Run undone and transactions restored.'),
      completedAt: run.completedAt,
      transactionCount: restoredTransactions,
    });

    return {
      run: updatedRun,
      restoredTransactions,
    };
  }

  private appendNote(existing: string | undefined, message: string): string {
    const prefix = existing?.trim() ? `${existing.trim()}\n` : '';
    return `${prefix}${message}`;
  }

  listRuns(ruleId: number, limit = 20, offset = 0): TransactionRuleRun[] {
    const rows = allRows<TransactionRuleRunRow>(
      this.db,
      `SELECT * FROM transaction_rule_runs WHERE RuleID = ? ORDER BY StartedAt DESC LIMIT ? OFFSET ?`,
      ruleId,
      limit,
      offset
    );
    return rows.map((row) => this.mapRun(row));
  }

  listRunChanges(runId: number): TransactionRuleRunChange[] {
    const rows = allRows<TransactionRuleRunChangeRow>(
      this.db,
      `SELECT * FROM transaction_rule_run_changes WHERE RunID = ? ORDER BY ID ASC`,
      runId
    );
    return rows.map((row) => this.mapRunChange(row));
  }

  private getCandidateTransactions(budgetId: number, transactionIds?: number[]): Transaction[] {
    let rows: Transaction[];
    if (transactionIds && transactionIds.length > 0) {
      const placeholders = transactionIds.map(() => '?').join(',');
      rows = allRows<Transaction>(
        this.db,
        `SELECT * FROM transactions WHERE BudgetID = ? AND ID IN (${placeholders}) ORDER BY Date ASC, ID ASC`,
        budgetId,
        ...transactionIds
      );
    } else {
      rows = allRows<Transaction>(
        this.db,
        `SELECT * FROM transactions WHERE BudgetID = ? ORDER BY Date ASC, ID ASC`,
        budgetId
      );
    }
    return rows;
  }

  private matchesRuleConditions(conditions: RuleCondition[], transaction: Transaction): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((condition) => this.matchesCondition(condition, transaction));
  }

  /**
   * Shared matcher for the text-valued condition fields (memo, payee).
   */
  private matchesTextCondition(text: string, condition: RuleCondition): boolean {
    const value = String(condition.value ?? '');
    const caseSensitive = Boolean(condition.options?.caseSensitive);
    const textForCompare = caseSensitive ? text : text.toLowerCase();
    const valueForCompare = caseSensitive ? value : value.toLowerCase();

    switch (condition.operator as MemoConditionOperator | PayeeConditionOperator) {
      case 'equals':
        return textForCompare === valueForCompare;
      case 'contains':
        return valueForCompare.length === 0 ? false : textForCompare.includes(valueForCompare);
      case 'regex':
        try {
          const flags = condition.options?.caseSensitive ? 'g' : 'gi';
          const regex = new RegExp(value, flags);
          return regex.test(text);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  private matchesCondition(condition: RuleCondition, transaction: Transaction): boolean {
    if (!condition) return false;

    switch (condition.field) {
      case 'memo':
        return this.matchesTextCondition((transaction.Memo ?? '').toString(), condition);
      case 'amount': {
        const amount = this.roundCurrency(
          Number(transaction.Inflow || 0) - Number(transaction.Outflow || 0)
        );
        const compareTo = Number(condition.value);
        if (!Number.isFinite(compareTo)) return false;

        switch (condition.operator as AmountConditionOperator) {
          case '=':
            return this.amountsEqual(amount, compareTo);
          case '!=':
            return !this.amountsEqual(amount, compareTo);
          case '>':
            return amount > compareTo;
          case '>=':
            return amount >= compareTo;
          case '<':
            return amount < compareTo;
          case '<=':
            return amount <= compareTo;
          default:
            return false;
        }
      }
      case 'account': {
        const accountId = Number(transaction.AccountID ?? 0);
        const targetId = Number(condition.value);
        if (!Number.isFinite(targetId)) return false;

        switch (condition.operator as AccountConditionOperator) {
          case 'is':
            return accountId === targetId;
          case 'is_not':
            return accountId !== targetId;
          default:
            return false;
        }
      }
      case 'payee':
        return this.matchesTextCondition((transaction.Payee ?? '').toString(), condition);
      default:
        return false;
    }
  }

  private async applyRuleActions(
    rule: TransactionRule,
    transaction: Transaction,
    runId: number
  ): Promise<TransactionRuleRunChange[]> {
    const original: TransactionWorkingState = {
      memo: (transaction.Memo ?? '').toString(),
      categoryId: Number(transaction.CategoryID ?? 0),
      accountId: Number(transaction.AccountID ?? 0),
      inflow: asMilli(Number(transaction.Inflow ?? 0)),
      outflow: asMilli(Number(transaction.Outflow ?? 0)),
      payee: transaction.Payee?.toString?.() ?? '',
    };
    const working: TransactionWorkingState = { ...original };
    const changeSources = new Map<string, RuleActionType | string>();
    const metadataByField = new Map<string, Record<string, unknown>>();

    // Shared tail for the three amount actions. The metadata key names must be
    // preserved exactly — undoRun restores from oldInflow/oldOutflow.
    const applyAmountChange = (
      actionType: RuleActionType,
      newAmount: number,
      extraMeta: Record<string, unknown>
    ): void => {
      const { inflow, outflow } = this.splitAmount(newAmount);
      if (!this.amountsEqual(this.calculateNetAmount(working), newAmount)) {
        working.inflow = inflow;
        working.outflow = outflow;
        changeSources.set('amount', actionType);
        metadataByField.set('amount', {
          action: actionType,
          ...extraMeta,
          oldAmount: this.roundCurrency(this.calculateNetAmount(original)),
          newAmount: this.roundCurrency(newAmount),
          oldInflow: original.inflow,
          oldOutflow: original.outflow,
          newInflow: inflow,
          newOutflow: outflow,
        });
      }
    };

    for (const action of rule.actions ?? []) {
      switch (action.type) {
        case 'memo.remove_regex': {
          const pattern = action.payload?.pattern;
          if (!pattern) {
            throw new ValidationError('memo.remove_regex action missing pattern payload');
          }
          let flags = action.payload.flags ?? 'gi';
          if (!flags.includes('g')) flags += 'g';
          try {
            const regex = new RegExp(pattern, flags);
            const cleaned = working.memo.replace(regex, ' ').replace(/\s+/g, ' ').trim();
            if (cleaned !== working.memo) {
              metadataByField.set('memo', {
                pattern,
                flags,
                oldMemo: original.memo,
                newMemo: cleaned,
              });
              working.memo = cleaned;
              changeSources.set('memo', action.type);
            }
          } catch (error) {
            throw new ValidationError(
              `Invalid memo regex pattern "${pattern}": ${error instanceof Error ? error.message : 'unknown error'}`
            );
          }
          break;
        }
        case 'category.set': {
          const categoryId = Number(action.payload?.categoryId);
          if (!Number.isFinite(categoryId)) {
            throw new ValidationError('category.set action requires a numeric categoryId');
          }
          if (categoryId !== working.categoryId) {
            metadataByField.set('categoryId', {
              previousCategoryId: original.categoryId,
              nextCategoryId: categoryId,
              action: action.type,
            });
            working.categoryId = categoryId;
            changeSources.set('categoryId', action.type);
          }
          break;
        }
        case 'payee.set': {
          const rawPayee = action.payload?.payee;
          if (typeof rawPayee !== 'string') {
            throw new Error('payee.set action requires a payee string');
          }
          const nextPayee = rawPayee.trim();
          if (nextPayee !== working.payee) {
            metadataByField.set('payee', {
              previousPayee: original.payee,
              nextPayee,
              action: action.type,
            });
            working.payee = nextPayee;
            changeSources.set('payee', action.type);
          }
          break;
        }
        case 'account.set': {
          const accountId = Number(action.payload?.accountId);
          if (!Number.isFinite(accountId)) {
            throw new Error('account.set action requires a numeric accountId');
          }
          if (accountId !== working.accountId) {
            metadataByField.set('accountId', {
              previousAccountId: original.accountId,
              nextAccountId: accountId,
              action: action.type,
            });
            working.accountId = accountId;
            changeSources.set('accountId', action.type);
          }
          break;
        }
        case 'amount.set': {
          const amount = Number(action.payload?.amount);
          if (!Number.isFinite(amount)) {
            throw new Error('amount.set action requires a numeric amount');
          }
          applyAmountChange(action.type, amount, {});
          break;
        }
        case 'amount.adjust_value': {
          const delta = Number(action.payload?.delta);
          if (!Number.isFinite(delta)) {
            throw new Error('amount.adjust_value action requires a numeric delta');
          }
          applyAmountChange(action.type, this.calculateNetAmount(working) + delta, { delta });
          break;
        }
        case 'amount.adjust_percent': {
          const percent = Number(action.payload?.percent);
          if (!Number.isFinite(percent)) {
            throw new Error('amount.adjust_percent action requires a numeric percent');
          }
          const base = this.calculateNetAmount(working);
          applyAmountChange(action.type, this.roundCurrency(base + base * (percent / 100)), {
            percent,
          });
          break;
        }
        default:
          break;
      }
    }

    const memoChanged = working.memo !== original.memo;
    const categoryChanged = working.categoryId !== original.categoryId;
    const accountChanged = working.accountId !== original.accountId;
    const payeeChanged = working.payee !== original.payee;
    const amountChanged = !this.amountsEqual(
      this.calculateNetAmount(original),
      this.calculateNetAmount(working)
    );

    if (!memoChanged && !categoryChanged && !accountChanged && !amountChanged && !payeeChanged) {
      return [];
    }

    await this.transactions.updateTransaction(
      Number(transaction.ID),
      working.inflow,
      working.outflow,
      working.accountId,
      working.categoryId,
      transaction.Date,
      working.memo,
      working.payee
    );

    const loggedChanges: TransactionRuleRunChange[] = [];

    const changeDescriptors: {
      changed: boolean;
      field: string;
      fallbackActionType: string;
      oldValue: unknown;
      newValue: unknown;
    }[] = [
      {
        changed: memoChanged,
        field: 'memo',
        fallbackActionType: 'memo',
        oldValue: original.memo,
        newValue: working.memo,
      },
      {
        changed: categoryChanged,
        field: 'categoryId',
        fallbackActionType: 'category',
        oldValue: original.categoryId,
        newValue: working.categoryId,
      },
      {
        changed: accountChanged,
        field: 'accountId',
        fallbackActionType: 'account',
        oldValue: original.accountId,
        newValue: working.accountId,
      },
      {
        changed: payeeChanged,
        field: 'payee',
        fallbackActionType: 'payee',
        oldValue: original.payee,
        newValue: working.payee,
      },
      {
        changed: amountChanged,
        field: 'amount',
        fallbackActionType: 'amount',
        oldValue: this.roundCurrency(this.calculateNetAmount(original)),
        newValue: this.roundCurrency(this.calculateNetAmount(working)),
      },
    ];

    for (const descriptor of changeDescriptors) {
      if (!descriptor.changed) continue;
      loggedChanges.push(
        this.logRunChange({
          runId,
          ruleId: rule.id,
          transactionId: Number(transaction.ID),
          actionType: changeSources.get(descriptor.field) ?? descriptor.fallbackActionType,
          field: descriptor.field,
          oldValue: descriptor.oldValue,
          newValue: descriptor.newValue,
          metadata: metadataByField.get(descriptor.field),
        })
      );
    }

    return loggedChanges;
  }

  private calculateNetAmount(state: TransactionWorkingState): MilliUnits {
    return asMilli(state.inflow - state.outflow);
  }

  private splitAmount(amount: number): { inflow: MilliUnits; outflow: MilliUnits } {
    const rounded = this.roundCurrency(amount);
    if (rounded === 0) {
      return { inflow: ZERO_MILLI, outflow: ZERO_MILLI };
    }
    if (rounded > 0) {
      return { inflow: rounded, outflow: ZERO_MILLI };
    }
    return { inflow: ZERO_MILLI, outflow: asMilli(Math.abs(rounded)) };
  }

  /** Rounds a possibly-float computed amount (percent adjustments) to integer milliunits. */
  private roundCurrency(value: number): MilliUnits {
    if (!Number.isFinite(value)) return ZERO_MILLI;
    const rounded = Math.round(value);
    return asMilli(Object.is(rounded, -0) ? 0 : rounded);
  }

  private amountsEqual(a: number, b: number): boolean {
    return this.roundCurrency(a) === this.roundCurrency(b);
  }

  getRun(runId: number): TransactionRuleRun {
    const row = getRow<TransactionRuleRunRow>(
      this.db,
      `SELECT * FROM transaction_rule_runs WHERE ID = ? LIMIT 1`,
      runId
    );
    if (!row) {
      throw new Error(`Rule run ${runId} not found`);
    }
    return this.mapRun(row);
  }

  getRunChange(id: number): TransactionRuleRunChange {
    const row = getRow<TransactionRuleRunChangeRow>(
      this.db,
      `SELECT * FROM transaction_rule_run_changes WHERE ID = ? LIMIT 1`,
      id
    );
    if (!row) {
      throw new Error(`Rule run change ${id} not found`);
    }
    return this.mapRunChange(row);
  }

  /**
   * Log autofill rule applications after a transaction is saved.
   * Groups changes by ruleId and creates a run record for each rule.
   */
  logAutofillApplication(input: LogAutofillApplicationInput): AutofillApplicationResult {
    const { transactionId, changes } = input;

    if (changes.length === 0) {
      return { runs: [], changes: [] };
    }

    const changesByRule = new Map<number, AutofillApplicationChange[]>();
    for (const change of changes) {
      const existing = changesByRule.get(change.ruleId) || [];
      existing.push(change);
      changesByRule.set(change.ruleId, existing);
    }

    const runs: TransactionRuleRun[] = [];
    const loggedChanges: TransactionRuleRunChange[] = [];

    for (const [ruleId, ruleChanges] of changesByRule.entries()) {
      const ruleRun = this.createRun({
        ruleId,
        trigger: 'autofill',
        status: 'completed',
        completedAt: new Date().toISOString(),
        transactionCount: 1,
        notes: `Autofill applied ${ruleChanges.length} field(s) during transaction entry`,
      });

      runs.push(ruleRun);

      for (const change of ruleChanges) {
        const loggedChange = this.logRunChange({
          runId: ruleRun.id,
          ruleId: change.ruleId,
          transactionId,
          actionType: change.actionType,
          field: change.field,
          oldValue: null, // Autofill only fills empty fields
          newValue: change.value,
          metadata: {
            ruleName: change.ruleName,
            trigger: 'autofill',
          },
        });
        loggedChanges.push(loggedChange);
      }

      run(
        this.db,
        `
        UPDATE transaction_rules
        SET LastRunAt = datetime('now'), UpdatedAt = datetime('now')
        WHERE ID = ?
      `,
        ruleId
      );
    }

    return { runs, changes: loggedChanges };
  }

  private mapRule(row: TransactionRuleRow): TransactionRule {
    return {
      id: Number(row.ID),
      budgetId: Number(row.BudgetID),
      name: row.Name,
      description: row.Description ?? '',
      conditions: safeParseJSON<RuleCondition[]>(row.ConditionsJSON, []),
      actions: safeParseJSON<RuleAction[]>(row.ActionsJSON, []),
      mode: (row.Mode as RuleMode) ?? 'continuous',
      enabled: Boolean(row.Enabled),
      oneTimeConsumed: Boolean(row.OneTimeConsumed),
      runOrder: Number(row.RunOrder ?? 0),
      lastRunAt: row.LastRunAt ?? null,
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt,
    };
  }

  private mapRun(row: TransactionRuleRunRow): TransactionRuleRun {
    return {
      id: Number(row.ID),
      ruleId: Number(row.RuleID),
      trigger: row.Trigger as RuleTrigger,
      startedAt: row.StartedAt,
      completedAt: row.CompletedAt ?? null,
      status: (row.Status as RuleRunStatus) ?? 'pending',
      transactionCount: Number(row.TransactionCount ?? 0),
      notes: row.Notes ?? '',
    };
  }

  private mapRunChange(row: TransactionRuleRunChangeRow): TransactionRuleRunChange {
    return {
      id: Number(row.ID),
      runId: Number(row.RunID),
      ruleId: Number(row.RuleID),
      transactionId: Number(row.TransactionID),
      actionType: row.ActionType,
      field: row.Field ?? null,
      oldValue: row.OldValue ? safeParseJSON(row.OldValue, null) : null,
      newValue: row.NewValue ? safeParseJSON(row.NewValue, null) : null,
      metadata: row.Metadata
        ? safeParseJSON<Record<string, unknown> | null>(row.Metadata, null)
        : null,
    };
  }

  private ensureSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transaction_rules (
          ID               INTEGER PRIMARY KEY AUTOINCREMENT,
          BudgetID         INTEGER NOT NULL,
          Name             TEXT NOT NULL,
          Description      TEXT NOT NULL DEFAULT '',
          ConditionsJSON   TEXT NOT NULL,
          ActionsJSON      TEXT NOT NULL,
          Mode             TEXT NOT NULL DEFAULT 'continuous',
          Enabled          BOOLEAN NOT NULL DEFAULT 1,
          OneTimeConsumed  BOOLEAN NOT NULL DEFAULT 0,
          RunOrder         INTEGER NOT NULL DEFAULT 0,
          LastRunAt        TEXT DEFAULT NULL,
          CreatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
          UpdatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE TABLE IF NOT EXISTS transaction_rule_runs (
          ID               INTEGER PRIMARY KEY AUTOINCREMENT,
          RuleID           INTEGER NOT NULL,
          Trigger          TEXT NOT NULL,
          StartedAt        TEXT NOT NULL DEFAULT (datetime('now')),
          CompletedAt      TEXT DEFAULT NULL,
          Status           TEXT NOT NULL DEFAULT 'pending',
          TransactionCount INTEGER NOT NULL DEFAULT 0,
          Notes            TEXT DEFAULT '',
          FOREIGN KEY (RuleID) REFERENCES transaction_rules(ID) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE TABLE IF NOT EXISTS transaction_rule_run_changes (
          ID              INTEGER PRIMARY KEY AUTOINCREMENT,
          RunID           INTEGER NOT NULL,
          RuleID          INTEGER NOT NULL,
          TransactionID   INTEGER NOT NULL,
          ActionType      TEXT NOT NULL,
          Field           TEXT DEFAULT NULL,
          OldValue        TEXT DEFAULT NULL,
          NewValue        TEXT DEFAULT NULL,
          Metadata        TEXT DEFAULT NULL,
          FOREIGN KEY (RunID) REFERENCES transaction_rule_runs(ID) ON DELETE CASCADE ON UPDATE CASCADE,
          FOREIGN KEY (RuleID) REFERENCES transaction_rules(ID) ON DELETE CASCADE ON UPDATE CASCADE,
          FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_transaction_rules_budget ON transaction_rules(BudgetID);
        CREATE INDEX IF NOT EXISTS idx_transaction_rules_enabled ON transaction_rules(BudgetID, Enabled);
        CREATE INDEX IF NOT EXISTS idx_transaction_rule_runs_rule ON transaction_rule_runs(RuleID);
        CREATE INDEX IF NOT EXISTS idx_transaction_rule_runs_started ON transaction_rule_runs(RuleID, StartedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_rule_run_changes_run ON transaction_rule_run_changes(RunID);
        CREATE INDEX IF NOT EXISTS idx_rule_run_changes_rule ON transaction_rule_run_changes(RuleID);
        CREATE INDEX IF NOT EXISTS idx_rule_run_changes_tx ON transaction_rule_run_changes(TransactionID);
      `);
      try {
        const rows = this.db.exec(
          `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'transaction_rule%' ORDER BY name`
        ) as { values?: unknown[][] }[] | undefined;
        const tables: string[] =
          Array.isArray(rows) && rows.length > 0 && rows[0]?.values
            ? rows[0].values.map((row: unknown[]) => String(row[0]))
            : [];
        debugLog('[RulesService] ensured schema; tables present:', tables);
      } catch (_e) {
        console.warn('[RulesService] ensure schema verification failed', _e);
      }
    } catch (error) {
      console.warn('[RulesService] Failed to ensure rules schema', error);
    }
  }
}

export * from './autofill.js';
