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

type LegacyRule = (args: Args, checks: LegacyReplayService | null) => boolean;

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

const customRateChange = (args: Args, checks: LegacyReplayService | null) =>
  Boolean(
    checks &&
    id(args.budgetId) &&
    (checks.hasForeignSplitParents(Number(args.budgetId)) ||
      checks.budgetHasSplitLinesOutOfStep(Number(args.budgetId)))
  );

const services = () => {
  try {
    return getRuntime()?.services() ?? null;
  } catch {
    return null;
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
  'recurring.markReady': (args) => {
    const options = (args.options ?? {}) as Args;
    return occurrenceKeyed(options) || has(options, 'transferId', 'reuse');
  },
  'recurring.skip': (args) => occurrenceKeyed(args),
  'recurring.markNotified': (args) => occurrenceKeyed(args),
  'recurring.resetOccurrence': (args) => occurrenceKeyed(args),

  // Restores metadata-only changes without rewriting amounts, puts the rule's
  // run bookkeeping back from ruleState, and split parents follow amount edits.
  'rules.undoRun': () => true,

  // Amount / account actions on a split parent now move its lines and mirrors,
  // and a stored '' payee the rule leaves alone stays '' (v1.18 wrote NULL).
  'rules.execute': (args, checks) => {
    const rule = checks ? services()?.rules?.getRule(Number(args.ruleId)) : undefined;
    if (!checks || !rule) return false;
    const structural = (rule.actions ?? []).some(
      (action) => action.type.startsWith('amount.') || action.type === 'account.set'
    );
    const options = (args.options ?? {}) as { transactionIds?: number[] };
    return (
      (structural && checks.hasSplitParents(rule.budgetId, options.transactionIds)) ||
      checks.hasEmptyPayees(rule.budgetId, options.transactionIds)
    );
  },

  'transactions.updateColumn': (args, checks) => {
    const column =
      typeof args.columnName === 'string' ? args.columnName.toLowerCase().replace(/_/g, '') : '';
    const rowId = id(args.id);
    return Boolean(
      checks && rowId && SPLIT_FOLLOW_COLUMNS.has(column) && checks.isSplitParent(rowId)
    );
  },
  'transactions.moveToNewAccount': (args, checks) => {
    const rowId = id(args.transactionId ?? args.id);
    return Boolean(checks && rowId && checks.isSplitParent(rowId));
  },

  // Mirror rows deleted with balance fix-up and found by parent (A3), and the
  // mirror accounts recalculated in full (repairs balances older builds left off).
  'transactions.upsertSplits': (args, checks) => {
    const rowId = id(args.transactionId);
    return Boolean(
      checks &&
      rowId &&
      (checks.hasSplitMirrors(rowId) || checks.accountsOutOfBalance(transferTargets(args.splits)))
    );
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

  // Transfer rate edits now also re-sync split lines in both accounts.
  'transactions.updateTransferRate': (args, checks) => {
    if (!checks || typeof args.transferId !== 'string') return false;
    const legs = services()?.transactions?.getTransactionsByTransferID(args.transferId) ?? [];
    return checks.hasSplitLinesOutOfStep(legs.map((leg) => leg.AccountID));
  },

  // Custom rate changes re-convert rows, and now their split lines too (A20);
  // the transfers they re-rate also re-sync lines that were already out of
  // step in both legs' accounts (any currency).
  'currency.customRates.add': (args, checks) =>
    Boolean(
      checks &&
      id(args.budgetId) &&
      (checks.hasForeignSplitParents(Number(args.budgetId), [
        String(args.fromCurrency ?? ''),
        String(args.toCurrency ?? ''),
      ]) ||
        checks.budgetHasSplitLinesOutOfStep(Number(args.budgetId)))
    ),
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
    if (startsChanged) return true;
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

/**
 * `args` with REQUIRES_FORMAT_ARG set when v1.18 builds would apply this call
 * differently (and without it otherwise: a redo copies the first run's args,
 * so a stale marker is dropped and the call re-checked). A check that throws
 * leaves the call at the base format; the op itself then reports the error.
 */
export function withLegacyFormat(op: string, args: Args): Args {
  const { [REQUIRES_FORMAT_ARG]: _stale, ...rest } = args;
  const rule = LEGACY_FORMAT_RULES[op];
  if (!rule) return REQUIRES_FORMAT_ARG in args ? rest : args;
  let newer = false;
  try {
    newer = rule(rest, services()?.legacyReplay ?? null);
  } catch {
    newer = false;
  }
  const format = Math.min(NEWER_THAN_V1_18, MUTATION_FORMAT_VERSION);
  return newer && format > BASE_MUTATION_FORMAT_VERSION
    ? { ...rest, [REQUIRES_FORMAT_ARG]: format }
    : REQUIRES_FORMAT_ARG in args
      ? rest
      : args;
}
