/**
 * Per-call mutation formats for op codes that v1.18 builds already have.
 *
 * Some existing ops kept their name but changed what they do, or gained args
 * older builds ignore. A v1.18 device applying such a call runs its old code
 * and ends up with different data, so the originating device stamps the call
 * with mutation format 3 (REQUIRES_FORMAT_ARG): format-2 builds then stop with
 * "update required" and apply it after updating, instead of diverging.
 *
 * Each rule answers "would a v1.18 build apply THIS call differently?" from
 * the args and the database before the op runs, so plain old-style calls stay
 * format 2 and keep syncing to older devices. Ops not listed here apply the
 * same in both builds (see legacy-format.integration.spec.ts).
 *
 * Known limits (open decisions, not handled here):
 * - Concurrency: a rule sees the sender's database before the op. A
 *   concurrent op from another device that the server orders first can change
 *   the answer (e.g. a row added to a category this device deletes), so a
 *   v1.18 device may still get a format-2 call it applies differently.
 * - Old -> new: calls a v1.18 device sends are format 2 and this build
 *   applies them with its current behaviour (e.g. deleting a split mirror,
 *   rules.undoRun, transactions.upsertLiabilityStarts). The v1.18 device keeps
 *   its own result, also after updating. Old behaviour is not emulated.
 */
import {
  BASE_MUTATION_FORMAT_VERSION,
  MUTATION_FORMAT_VERSION,
  REQUIRES_FORMAT_ARG,
} from '@budgero/runtime';
import type { LegacyReplayService } from '@budgero/core/browser';
import { getRuntime } from '@shared/runtime/global';

type Args = Record<string, unknown>;

/** Format 3: the first format v1.18 builds reject. */
const NEWER_THAN_V1_18 = 3;

/** Format 4: the first format v1.19 builds reject (labels set by rules and batch edits). */
const NEWER_THAN_V1_19 = 4;

/** Format 5: the first format v1.20 builds reject (recurring split lines, markReady payee). */
const NEWER_THAN_V1_20 = 5;

/**
 * Format 6: the first format v1.21 builds reject. Amount edits unlock a
 * reconciled row whose bank amount changes, a cross-currency transfer leg
 * edit keeps the partner's amount, and custom rates skip reconciled transfers.
 */
const NEWER_THAN_V1_21 = 6;

/**
 * Format 7: the first format builds without transaction times (v1.21.x)
 * reject. Only calls that write a time of day need it (see TIME_FORMAT_RULES).
 */
const NEWER_THAN_V1_22 = 7;

/**
 * true: the call needs format 3 (v1.18 would apply it differently); a number:
 * the call needs that format; false: the base format will do.
 */
type LegacyRule = (args: Args, checks: LegacyReplayService | null) => boolean | number;

/** A rule call that sets or names labels (label.set actions): v1.19 builds can't run those. */
const mentionsLabelAction = (args: Args): boolean => JSON.stringify(args).includes('"label.set"');

const ruleHasLabelAction = (ruleId: unknown): boolean => {
  const ruleIdNum = id(ruleId);
  const rule = ruleIdNum ? services()?.rules?.getRule(ruleIdNum) : undefined;
  return Boolean(rule?.actions?.some((action) => action.type === 'label.set'));
};

/** A run whose logged changes include a label: v1.19 undo/redo would skip or misplace it. */
const runChangedLabels = (runId: unknown): boolean => {
  const runIdNum = id(runId);
  const changes = runIdNum ? services()?.rules?.listRunChanges(runIdNum) : undefined;
  return Boolean(changes?.some((change) => change.field === 'labelId'));
};

/** Split lines on a recurring template: v1.20 drops them and posts a plain row. */
const hasRecurringSplits = (template: unknown): boolean => {
  const splits = (template as Args | null | undefined)?.splits;
  return Array.isArray(splits) && splits.length > 0;
};

const has = (args: Args, ...keys: string[]) => keys.some((key) => args[key] !== undefined);

const id = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Columns whose edit on a split parent now also moves its lines and mirrors. */
const SPLIT_FOLLOW_COLUMNS = new Set([
  'inflowconverted',
  'outflowconverted',
  'inflownative',
  'outflownative',
  'inflow',
  'outflow',
  'infloworiginal',
  'outfloworiginal',
  'date',
  'accountid',
  'exchangerate',
]);

/** v1.18 resolves occurrences by their device-local ID only (A1). */
const occurrenceKeyed = (ref: unknown) => {
  const value = (ref ?? {}) as Args;
  return value.recurringTransactionId != null && Boolean(value.dueDate);
};

/** Transfer targets of split lines in op args (push or registry spelling). */
const transferTargets = (splits: unknown): number[] =>
  Array.isArray(splits)
    ? splits
        .map((line) => {
          const value = (line ?? {}) as Args;
          return id(
            value.transferAccountId ?? value.TransferAccountID ?? value.transfer_account_id
          );
        })
        .filter((target): target is number => target !== null)
    : [];

const parseArgsObject = (value: unknown): Args => {
  if (value && typeof value === 'object') return value as Args;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Args) : {};
  } catch {
    return {};
  }
};

const customRateChange = (args: Args, checks: LegacyReplayService | null): boolean | number => {
  if (!checks || !id(args.budgetId)) return false;
  if (checks.budgetHasReconciledTransfers(Number(args.budgetId))) return NEWER_THAN_V1_21;
  return (
    checks.hasForeignSplitParents(Number(args.budgetId)) ||
    checks.budgetHasSplitLinesOutOfStep(Number(args.budgetId))
  );
};

/** Columns whose edit can change a row's bank amount (or a transfer partner's). */
const AMOUNT_EDIT_COLUMNS = new Set([
  'inflowconverted',
  'outflowconverted',
  'inflownative',
  'outflownative',
  'inflow',
  'outflow',
  'infloworiginal',
  'outfloworiginal',
  'exchangerate',
]);

/** An amount edit of row `rowId` that v1.21 would apply differently (see amountEditDiffersFromLegacy). */
const amountEditDiffers = (checks: LegacyReplayService | null, rowId: number | null) =>
  Boolean(checks && rowId && checks.amountEditDiffersFromLegacy(rowId));

const services = () => {
  try {
    return getRuntime()?.services() ?? null;
  } catch {
    return null;
  }
};

const categoryExists = (categoryId: number): boolean => {
  try {
    return Boolean(services()?.categories?.getCategory(categoryId));
  } catch {
    return false;
  }
};

export const LEGACY_FORMAT_RULES: Readonly<Record<string, LegacyRule>> = {
  // Carried rates (A12): v1.18 ignores them and fetches its own, row by row.
  // A no-op (prepare marks it with fromCurrency === currency) is a no-op there too.
  'budgets.updateCurrency': (args) =>
    has(args, 'rates', 'asOf') ||
    (args.fromCurrency !== undefined && args.fromCurrency !== args.currency),

  // Only redo passes newPayeeId (re-create the entry under its first ID).
  'payees.rename': (args) => args.newPayeeId !== undefined,

  // Occurrence key (A1), carried TransferID (A14) and redo IDs (U5).
  // A carried payee (#127): v1.20 ignores it, posts without one and adds no
  // payee-list entry, so later payee IDs would differ between devices.
  'recurring.markReady': (args) => {
    const options = (args.options ?? {}) as Args;
    if (typeof options.payee === 'string' && options.payee.trim()) return NEWER_THAN_V1_20;
    // Mirror IDs for a split template's redo: only format-5 builds post splits.
    if (has((options.reuse ?? {}) as Args, 'mirrorTransactionIds')) return NEWER_THAN_V1_20;
    return occurrenceKeyed(options) || has(options, 'transferId', 'reuse');
  },
  'recurring.skip': (args) => occurrenceKeyed(args),
  'recurring.create': (args) => hasRecurringSplits(args.input) && NEWER_THAN_V1_20,
  'recurring.update': (args) => hasRecurringSplits(args.patch) && NEWER_THAN_V1_20,
  'recurring.markNotified': (args) => occurrenceKeyed(args),
  'recurring.resetOccurrence': (args) => occurrenceKeyed(args),

  // Restores metadata-only changes without rewriting amounts, puts the rule's
  // run bookkeeping back from ruleState, and split parents follow amount edits.
  'rules.undoRun': (args) => (runChangedLabels(args.runId) ? NEWER_THAN_V1_19 : true),
  'rules.redoRun': (args) => runChangedLabels(args.runId) && NEWER_THAN_V1_19,
  'rules.create': (args) => mentionsLabelAction(args) && NEWER_THAN_V1_19,
  'rules.update': (args) => mentionsLabelAction(args) && NEWER_THAN_V1_19,
  'rules.restore': (args) => mentionsLabelAction(args) && NEWER_THAN_V1_19,
  'rules.restoreDeleted': (args) => mentionsLabelAction(args) && NEWER_THAN_V1_19,

  // v1.19 builds ignore labelId and would apply the rest of the edit.
  'transactions.batchEdit': (args) =>
    Array.isArray(args.edits) &&
    (args.edits as Args[]).some((edit) => edit?.labelId !== undefined) &&
    NEWER_THAN_V1_19,

  // Amount / account actions on a split parent now move its lines and mirrors,
  // and a stored '' payee the rule leaves alone stays '' (v1.18 wrote NULL).
  'rules.execute': (args, checks) => {
    const rule = checks ? services()?.rules?.getRule(Number(args.ruleId)) : undefined;
    const options = (args.options ?? {}) as { transactionIds?: number[] };
    if (
      checks &&
      rule &&
      (rule.actions ?? []).some((action) => action.type.startsWith('amount.')) &&
      checks.hasReconciledOrTransferRows(rule.budgetId, options.transactionIds)
    ) {
      return NEWER_THAN_V1_21;
    }
    if (ruleHasLabelAction(args.ruleId)) return NEWER_THAN_V1_19;
    if (!checks || !rule) return false;
    const structural = (rule.actions ?? []).some(
      (action) => action.type.startsWith('amount.') || action.type === 'account.set'
    );
    return (
      (structural && checks.hasSplitParents(rule.budgetId, options.transactionIds)) ||
      checks.hasEmptyPayees(rule.budgetId, options.transactionIds)
    );
  },

  'transactions.updateColumn': (args, checks) => {
    const column =
      typeof args.columnName === 'string' ? args.columnName.toLowerCase().replace(/_/g, '') : '';
    const rowId = id(args.id);
    if (AMOUNT_EDIT_COLUMNS.has(column) && amountEditDiffers(checks, rowId)) {
      return NEWER_THAN_V1_21;
    }
    return Boolean(
      checks && rowId && SPLIT_FOLLOW_COLUMNS.has(column) && checks.isSplitParent(rowId)
    );
  },
  // The undo of an amount edit on a row with a manual rate: a cross-currency
  // transfer partner now keeps its amount.
  'transactions.restoreAmounts': (args, checks) =>
    amountEditDiffers(checks, id(args.id)) && NEWER_THAN_V1_21,
  // Push API amount edits unlock a reconciled row whose amount changes.
  'transactions.updateByRef': (args, checks) => {
    const fields = (args.fields ?? {}) as Args;
    if (!checks || !has(fields, 'inflow', 'outflow') || typeof args.messageId !== 'string') {
      return false;
    }
    const rowId = services()?.importHistory?.duplicates.findOperation(`push:${args.messageId}`);
    return amountEditDiffers(checks, rowId ?? null) && NEWER_THAN_V1_21;
  },
  'transactions.moveToNewAccount': (args, checks) => {
    const rowId = id(args.transactionId ?? args.id);
    return Boolean(checks && rowId && checks.isSplitParent(rowId));
  },

  // Mirror rows deleted with balance fix-up and found by parent (A3), and the
  // mirror accounts recalculated in full (repairs balances older builds left off).
  // Kept mirror rows are now updated in place (same ID and status); v1.20
  // re-inserts them under new IDs.
  'transactions.upsertSplits': (args, checks) => {
    const rowId = id(args.transactionId);
    if (!checks || !rowId) return false;
    if (amountEditDiffers(checks, rowId)) return NEWER_THAN_V1_21;
    if (checks.splitSaveKeepsMirrors(rowId, transferTargets(args.splits))) return NEWER_THAN_V1_20;
    return (
      checks.hasSplitMirrors(rowId) || checks.accountsOutOfBalance(transferTargets(args.splits))
    );
  },
  'transactions.saveSplits': (args, checks) => {
    const rowId = id(args.transactionId);
    if (amountEditDiffers(checks, rowId)) return NEWER_THAN_V1_21;
    const keeps = Boolean(
      checks && rowId && checks.splitSaveKeepsMirrors(rowId, transferTargets(args.splits))
    );
    return keeps && NEWER_THAN_V1_20;
  },
  'transactions.clearSplits': (args, checks) => {
    const rowId = id(args.transactionId);
    return Boolean(checks && rowId && checks.hasSplitMirrors(rowId));
  },

  // New split mirrors: their accounts are recalculated in full (see upsertSplits).
  'transactions.add': (args, checks) =>
    Boolean(checks && checks.accountsOutOfBalance(transferTargets(args.splits))),
  'transactions.duplicate': (args, checks) => {
    if (!checks || !Array.isArray(args.ids)) return false;
    return checks.accountsOutOfBalance(checks.splitTransferTargets(args.ids.map(Number)));
  },

  // Deleting a mirror deletes its whole split transaction (A21).
  'transactions.delete': (args, checks) => {
    const rowId = id(args.id);
    return Boolean(checks && rowId && checks.deleteDiffersFromLegacy([rowId]));
  },
  'transactions.deleteBatch': (args, checks) => {
    const ids = Array.isArray(args.ids) ? args.ids.map(Number) : [];
    return Boolean(checks && checks.deleteDiffersFromLegacy(ids));
  },
  'transactions.deleteByRef': (args, checks) => {
    if (!checks || typeof args.messageId !== 'string') return false;
    const rowId = services()?.importHistory?.duplicates.findOperation(`push:${args.messageId}`);
    return rowId !== undefined && checks.deleteDiffersFromLegacy([rowId]);
  },
  'transactions.deleteTransfer': (args, checks) => {
    if (!checks || typeof args.transferId !== 'string') return false;
    const [first] = services()?.transactions?.getTransactionsByTransferID(args.transferId) ?? [];
    return first !== undefined && checks.deleteDiffersFromLegacy([first.ID]);
  },

  // Transfer rate edits now also re-sync split lines in both accounts, and
  // unlock a reconciled leg whose amount changes.
  'transactions.updateTransferRate': (args, checks) => {
    if (!checks || typeof args.transferId !== 'string') return false;
    if (checks.transferHasReconciledLeg(args.transferId)) return NEWER_THAN_V1_21;
    const legs = services()?.transactions?.getTransactionsByTransferID(args.transferId) ?? [];
    return checks.hasSplitLinesOutOfStep(legs.map((leg) => leg.AccountID));
  },

  // Custom rate changes re-convert rows, and now their split lines too (A20);
  // the transfers they re-rate also re-sync lines that were already out of
  // step in both legs' accounts (any currency).
  // Custom rates now also skip transfers with a reconciled leg.
  'currency.customRates.add': (args, checks) => {
    if (!checks || !id(args.budgetId)) return false;
    if (checks.budgetHasReconciledTransfers(Number(args.budgetId))) return NEWER_THAN_V1_21;
    return (
      checks.hasForeignSplitParents(Number(args.budgetId), [
        String(args.fromCurrency ?? ''),
        String(args.toCurrency ?? ''),
      ]) || checks.budgetHasSplitLinesOutOfStep(Number(args.budgetId))
    );
  },
  'currency.customRates.update': (args, checks) => customRateChange(args, checks),
  'currency.customRates.delete': (args, checks) => customRateChange(args, checks),

  // A16: liability debt / prior-payment edits now sync the opening rows
  // (older builds relied on a separate op the app no longer sends); currency
  // changes now re-sync split lines.
  'accounts.update': (args, checks) => {
    const accountId = id(args.id);
    if (!accountId) return false;
    const account = services()?.accounts?.getAccount(accountId);
    if (!account) return false;
    let stored: Args = {};
    if (account.Metadata && typeof account.Metadata === 'object') {
      stored = account.Metadata;
    } else {
      try {
        stored = JSON.parse(account.Metadata || '{}') as Args;
      } catch {
        stored = {};
      }
    }
    const next = parseArgsObject(args.metadata);
    const startsChanged = (['debt_total', 'paid_so_far'] as const).some(
      (key) => typeof next[key] === 'number' && next[key] !== stored[key]
    );
    if (startsChanged && checks?.accountHasReconciledRows(accountId)) return NEWER_THAN_V1_21;
    if (startsChanged) return true;
    // A28: renaming a loan whose linked category is gone (a legacy group
    // delete removed it) now skips that category; v1.18 throws half-way.
    const linked = id(stored.linked_category_id);
    const renamed =
      typeof args.name === 'string' && args.name.trim() !== '' && args.name.trim() !== account.Name;
    if (renamed && linked && !categoryExists(linked)) return true;
    const currencyChanged = typeof args.currency === 'string' && args.currency !== account.Currency;
    return Boolean(currencyChanged && checks?.accountHasSplitParents(accountId));
  },

  // A7: rows other accounts hold in the deleted account's categories move to
  // Uncategorized instead of being cascade-deleted.
  'accounts.delete': (args, checks) => {
    const accountId = id(args.id);
    return Boolean(checks && accountId && checks.accountDeleteMovesOtherRows(accountId));
  },

  // A5: transfer partners / split mirrors of the deleted rows go too, and the
  // accounts are recalculated.
  'categories.delete': (args, checks) => {
    const categoryId = id(args.id);
    return Boolean(checks && categoryId && checks.categoriesHoldTransactions([categoryId]));
  },
  'categoryGroups.delete': (args, checks) => {
    const groupId = id(args.id);
    return Boolean(checks && groupId && checks.categoryGroupHoldsTransactions(groupId));
  },
};

const hasTime = (value: unknown) => typeof value === 'string' && value.trim() !== '';

const rowHasTime = (rowId: number | null): boolean => {
  if (!rowId) return false;
  try {
    return hasTime(services()?.transactions?.getTransactionByID(rowId)?.Time);
  } catch {
    return false;
  }
};

/** Restore snapshots: raw rows (Time) or legacy add-op snapshots (time). */
const snapshotRowsHaveTime = (rows: unknown): boolean =>
  Array.isArray(rows) &&
  rows.some((row) => hasTime((row as Args | null)?.Time) || hasTime((row as Args | null)?.time));

/**
 * Calls that carry a transaction time of day. Builds before format 7 have no
 * Time column: they would add the row without its time (or fail on a time
 * edit) and stay out of step, so these ask for format 7 and older devices
 * show "update required" instead. Calls without a time keep their format, so
 * ordinary edits still reach v1.21 devices.
 */
const TIME_FORMAT_RULES: Readonly<Record<string, (args: Args) => boolean>> = {
  'transactions.add': (args) => hasTime(args.time),
  'transactions.import': (args) => hasTime(args.time),
  'transactions.addTransfer': (args) =>
    hasTime(args.time) ||
    hasTime((args.source as Args | undefined)?.time) ||
    hasTime((args.destination as Args | undefined)?.time),
  'transactions.updateColumn': (args) =>
    typeof args.columnName === 'string' &&
    args.columnName.toLowerCase().replace(/_/g, '') === 'time',
  'transactions.updateByRef': (args) => ((args.fields ?? {}) as Args).time !== undefined,
  'transactions.restore': (args) =>
    snapshotRowsHaveTime((args.snapshot as { transactions?: unknown } | undefined)?.transactions),
  'transactions.restoreBatch': (args) => snapshotRowsHaveTime(args.snapshots),
  // Copies keep the source rows' time.
  'transactions.duplicate': (args) =>
    Array.isArray(args.ids) && args.ids.some((rowId) => rowHasTime(id(rowId))),
  // New split-transfer mirrors take the parent's time.
  'transactions.upsertSplits': (args) =>
    transferTargets(args.splits).length > 0 && rowHasTime(id(args.transactionId)),
  'transactions.saveSplits': (args) =>
    transferTargets(args.splits).length > 0 && rowHasTime(id(args.transactionId)),
  'transactions.reconcileCleared': (args) => hasTime((args.adjustment as Args | undefined)?.time),
};

/**
 * `args` with REQUIRES_FORMAT_ARG set when older builds would apply this call
 * differently (and without it otherwise: a redo copies the first run's args,
 * so a stale marker is dropped and the call re-checked). Calls nested in a
 * list-of-ops payload (`args.ops`: history.applyOps, history.redoWithIds) are
 * checked one by one, so mutationFormatVersion sees what each one needs. A
 * check that throws leaves the call at the base format; the op itself then
 * reports the error.
 */
export function withLegacyFormat(op: string, args: Args): Args {
  const { [REQUIRES_FORMAT_ARG]: _stale, ...rest } = args;
  if (Array.isArray(rest.ops)) {
    rest.ops = (rest.ops as unknown[]).map((call) => {
      const entry = call as { op?: unknown; args?: unknown } | null;
      if (!entry || typeof entry.op !== 'string' || !entry.args || typeof entry.args !== 'object') {
        return call;
      }
      return { ...entry, args: withLegacyFormat(entry.op, entry.args as Args) };
    });
  }
  const rule = LEGACY_FORMAT_RULES[op];
  const timeRule = TIME_FORMAT_RULES[op];
  if (!rule && !timeRule)
    return Array.isArray(rest.ops) || REQUIRES_FORMAT_ARG in args ? rest : args;
  let needed: boolean | number = false;
  try {
    needed = rule ? rule(rest, services()?.legacyReplay ?? null) : false;
  } catch {
    needed = false;
  }
  let wanted = needed === true ? NEWER_THAN_V1_18 : typeof needed === 'number' ? needed : 0;
  try {
    if (timeRule?.(rest)) wanted = Math.max(wanted, NEWER_THAN_V1_22);
  } catch {
    // Leave the call at the format its other rule chose.
  }
  const format = Math.min(wanted, MUTATION_FORMAT_VERSION);
  return format > BASE_MUTATION_FORMAT_VERSION
    ? { ...rest, [REQUIRES_FORMAT_ARG]: format }
    : Array.isArray(rest.ops) || REQUIRES_FORMAT_ARG in args
      ? rest
      : args;
}
