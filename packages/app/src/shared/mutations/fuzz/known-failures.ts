/**
 * Allow-list of known integrity failures for the op-level fuzz.
 *
 * Every entry is a confirmed, shrunk counterexample of invariant 5 (undo
 * exactness) or 6 (multi-device replay determinism) on the current code,
 * mapped to its audit tracker ID (or NEW-n when the audit did not have it).
 * A violation that matches an entry is counted and skipped so the default
 * suite stays green; anything else fails the run with a shrunk sequence.
 *
 * When a fix lands, delete its entry and run the long mode
 * (`FUZZ_RUNS=5000 pnpm exec vitest run src/shared/mutations/fuzz`): the
 * property must pass without it. `FUZZ_STRICT=1` ignores this list entirely,
 * `FUZZ_ONLY=<substring of the signature>` limits failures to matching
 * violations (to shrink one class at a time), and `FUZZ_COLLECT=<file>` records
 * every unlisted violation (with its sequence) instead of failing.
 */

export type ViolationKind =
  /** A thrown op left part of its writes behind (not atomic). */
  | 'failed-op-partial'
  /** The op changed the DB but recorded no undo entry. */
  | 'no-undo-entry'
  /** Undo threw. */
  | 'undo-threw'
  /** After undo the DB differs from before the op. */
  | 'undo-mismatch'
  /** Redo threw. */
  | 'redo-threw'
  /** After redo the DB differs from after the op. */
  | 'redo-mismatch'
  /** A second undo (undo -> redo -> undo) differs from before the op. */
  | 'chain-undo-mismatch'
  /** A second redo differs from after the op. */
  | 'chain-redo-mismatch'
  /** A synced op threw on the receiving device. */
  | 'replay-threw'
  /** Both devices applied the same op stream (at the same "today") but their DBs differ. */
  | 'replay-diverged'
  /** As above, but "today" moved between the sender applying an op and the receiver applying it. */
  | 'replay-diverged-clock';

export interface Violation {
  invariant: 'undo' | 'replay';
  kind: ViolationKind;
  /** Op code(s) involved: the user op (inv 5) or the ops delivered since the last equal check (inv 6). */
  ops: string[];
  /** Tables that differ (empty for throws). */
  tables: string[];
  detail: string;
}

export interface KnownFailure {
  /** Tracker ID (U1-U12, A1-A21) or NEW-n. */
  id: string;
  invariant: 'undo' | 'replay';
  kinds: ViolationKind[];
  /** The violation matches if any of its ops is one of these ('*' = any op). */
  ops: string[];
  /** When set, every differing table must be one of these. */
  tables?: string[];
  /** When set, the violation detail must match. */
  detail?: RegExp;
  note: string;
}

const RULE_LOG = ['transaction_rule_runs', 'transaction_rule_run_changes', 'transaction_rules'];

/**
 * Order matters: the first matching entry wins, so narrow entries come
 * before broad ones. Shrunk counterexamples are in the F1 report.
 */
export const KNOWN_FAILURES: KnownFailure[] = [
  // ---------------------------------------------------------------- undo (invariant 5)
  {
    id: 'U1',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['categories.delete', 'categoryGroups.delete'],
    note: 'Undo of a category / group delete recreates only the category: its transactions, split lines, assignments (all months), goal, recurring and warranty links, balances and Position are not restored (also A6).',
  },
  {
    id: 'U1',
    invariant: 'undo',
    kinds: ['no-undo-entry'],
    ops: ['transactions.reassign', 'monthlyBudgets.reassignAssignment'],
    note: 'transactions.reassign and monthlyBudgets.reassignAssignment change data but record no undo.',
  },
  {
    id: 'U1',
    invariant: 'undo',
    kinds: ['undo-threw', 'redo-threw'],
    ops: ['transactions.upsertSplits', 'transactions.clearSplits'],
    detail: /Each split must have either CategoryID or TransferAccountID/,
    note: 'Follow-up of a category delete: split lines left with CategoryID NULL cannot be written back, so undo of a later split edit throws and the entry is dropped.',
  },
  {
    id: 'NEW-12',
    invariant: 'undo',
    kinds: ['no-undo-entry'],
    ops: ['accounts.update'],
    note: 'Account currency change records no undo (deliberate in accounts.ts: converting back would not be exact), so the edit, the rewritten amounts and rates cannot be undone.',
  },
  {
    id: 'U12',
    invariant: 'undo',
    kinds: ['no-undo-entry'],
    ops: ['importHistory.record', 'importHistory.undo'],
    note: 'importHistory.record (the import run of a CSV import) and, rarely, importHistory.undo record no undo (recurring.delete and accounts.delete got one in the integrity fixes).',
  },

  {
    id: 'U6',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['rules.execute', 'rules.delete'],
    tables: [...RULE_LOG, 'transactions'],
    note: "After the int-undo fix the rows themselves are restored; what remains: rules.execute undo keeps the run and its change rows (now Status 'undone', which is the intended audit trail), and undo of a rules.delete does not bring back the rule's run history.",
  },
  {
    id: 'NEW-1',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'redo-mismatch', 'chain-undo-mismatch', 'chain-redo-mismatch'],
    ops: [
      'accounts.create',
      'payees.add',
      'goals.create',
      'goals.delete',
      'transactions.upsertSplits',
      'transactions.clearSplits',
      'transactions.duplicate',
      'transactions.import',
      'transactions.saveSplits',
      'importHistory.match',
      'accounts.createLinked',
    ],
    tables: [
      'transactions',
      'payees',
      'goals',
      'transaction_splits',
      'accounts',
      'categories',
      'import_provenance',
      'bank_links',
    ],
    note: 'Undo / redo re-create rows under new IDs: the Initial Balance row and linked debt / CC payment category of a re-done account (Metadata then points at the new category), a re-added payee, a goal (by design per goals.ts, undo addresses it by category), and split lines of an upsert / clear / duplicate undo or redo; a re-done linked account also gets a new bank_links row.',
  },
  {
    id: 'NEW-7',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: [
      'transactions.add',
      'transactions.updateColumn',
      'transactions.import',
      'transactions.batchEdit',
    ],
    tables: ['payees', 'transactions'],
    detail:
      /^transactions\.(add|import)[ #]|"columnName":"Payee"|^transactions\.batchEdit .*"payee"/,
    note: "A new payee name typed on add / payee edit / batch payee edit is added to the payee directory and undo leaves the entry; undo of a payee edit on a row whose Payee was '' writes NULL.",
  },
  {
    id: 'NEW-2',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: [
      'transactions.add',
      'transactions.import',
      'transactions.addTransfer',
      'recurring.markReady',
    ],
    tables: [...RULE_LOG, 'payees', 'categories'],
    note: 'Undo of an add / import / transfer / posted bill leaves the continuous-rule run it triggered (run row, LastRunAt) pointing at a deleted row; a posted recurring transfer also leaves the Transfers category it auto-created.',
  },
  {
    id: 'NEW-3',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['currency.customRates.add', 'currency.customRates.update', 'currency.customRates.delete'],
    tables: ['account_revaluations', 'accounts', 'transactions'],
    note: 'Custom-rate add / edit / delete revalues foreign accounts (pinned-rate true-up, dated today); undo adds another revaluation instead of reverting, so BalanceConverted and the revaluation rows differ.',
  },
  {
    id: 'NEW-4',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['transactions.moveToNewAccount', 'transactions.updateColumn'],
    tables: ['accounts', 'transactions'],
    note: 'Moving a row between accounts of different currencies is not reversible: the native amount is re-derived from the converted one on each move (86.38 EUR -> 79.18 or 88.30 EUR after undo), and ConversionPending stays set after moving back.',
  },
  {
    id: 'NEW-5',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['accounts.update'],
    tables: ['accounts', 'categories', 'category_groups'],
    note: 'Undo of an account type change (e.g. savings -> credit) keeps the CC payment category it created and the cc_payment_category_id link in Metadata.',
  },
  {
    id: 'NEW-6',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: [
      'categories.moveToNewGroup',
      'categoryGroups.reorder',
      'categories.reorder',
      'accounts.reorder',
    ],
    tables: ['categories', 'category_groups', 'accounts'],
    note: 'Ordering not restored: undo of a group move puts the category at the end of its old group; undo of a group reorder writes explicit positions for system groups that had none (Income / Uncategorized / Transfers end up in another order); undo of a category / account reorder renumbers Position (same order, other values).',
  },
  {
    id: 'NEW-8',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['reports.update', 'reports.delete'],
    tables: ['saved_reports'],
    note: "Report undo does not keep Description as it was: update undo turns NULL into '', delete undo turns '' into NULL.",
  },
  {
    id: 'NEW-9',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['*'],
    tables: ['recurring_transaction_occurrences'],
    note: 'Occurrence materialization is not a pure function of the template: undo of a schedule edit regenerates from the old start date (past scheduled occurrences come back), and gaps left in a series are filled by a later write (an undo of an unrelated op then shows an extra scheduled occurrence).',
  },
  {
    id: 'NEW-10',
    invariant: 'undo',
    kinds: ['undo-threw'],
    ops: ['transactions.updateColumn'],
    detail: /Exchange rate must be a finite number/,
    note: 'ExchangeRate cell edit on a foreign row with no stored rate: undo re-applies the captured NULL and throws, so the entry is dropped and the edit cannot be undone.',
  },
  {
    id: 'NEW-14',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['recurring.update'],
    tables: ['recurring_transactions', 'categories', 'recurring_transaction_occurrences'],
    note: 'Undo of a category edit on a recurring transfer template writes the Transfers category (auto-created) instead of the NULL it had.',
  },
  {
    id: 'NEW-15',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['transactions.updateColumn'],
    tables: ['transaction_splits'],
    note: 'Editing a split parent amount re-proportions its lines (A19 fix); undo restores the parent amount but re-proportions again instead of restoring the original lines (50/40 becomes 90/0).',
  },
  {
    id: 'NEW-16',
    invariant: 'undo',
    kinds: ['undo-threw'],
    ops: ['rules.execute'],
    detail: /Only the most recent completed run can be undone/,
    note: 'Rule-run undo is now rules.undoRun, which only undoes the latest run: once a continuous rule has run again (e.g. after an add), Ctrl+Z on the manual run throws and the entry is dropped.',
  },
  {
    id: 'NEW-17',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['rules.execute'],
    tables: [...RULE_LOG, 'transactions', 'accounts'],
    detail: /amount\.(adjust_value|adjust_percent|set)/,
    note: 'Undo of an amount rule (amount.adjust_value) on a foreign-currency row does not restore the native amount: the EUR account balance ends 86.38 EUR lower than before the run.',
  },
  {
    id: 'NEW-13',
    invariant: 'undo',
    kinds: ['failed-op-partial'],
    ops: ['accounts.update'],
    note: 'Deleting the Liabilities group removes a loan\'s linked category; a later edit of that loan commits the name / on-budget change, then throws "Category with id N not found" (not atomic; the half-applied edit is never synced).',
  },
  // ---------------------------------------------------------------- replay (invariant 6)
  {
    id: 'NEW-16',
    invariant: 'replay',
    kinds: ['replay-threw'],
    ops: ['rules.undoRun'],
    detail: /Only the most recent completed run can be undone/,
    note: 'Same as the undo entry, across devices: an undo of a rule run replayed after the other device ran a continuous rule throws there.',
  },
  {
    id: 'NEW-13',
    invariant: 'replay',
    kinds: ['failed-op-partial'],
    ops: ['accounts.update'],
    note: 'Same as the undo entry: the failed edit stays on the device that made it and is never sent, so the devices diverge.',
  },
  {
    id: 'NEW-11',
    invariant: 'replay',
    kinds: ['replay-diverged-clock'],
    ops: ['*'],
    note: "Replay depends on the receiving device's \"today\": custom-rate ops revalue as of the receiver's today (other revaluation rows and BalanceConverted), ReconciledAt is stamped at apply time, FX rates of future-dated rows resolve against the receiver's today, and recurring series materialize from the receiver's backfill window.",
  },
];

const STRICT = process.env.FUZZ_STRICT === '1';
const ONLY = process.env.FUZZ_ONLY;

/** How often each allow-list entry was hit (printed in the run summary). */
export const knownHits = new Map<string, number>();

export function matchKnown(v: Violation): KnownFailure | undefined {
  if (ONLY && !signature(v).includes(ONLY)) {
    // Shrinking one class: everything else counts as known.
    return { id: 'FUZZ_ONLY', invariant: v.invariant, kinds: [v.kind], ops: v.ops, note: '' };
  }
  if (STRICT) return undefined;
  return KNOWN_FAILURES.find(
    (entry) =>
      entry.invariant === v.invariant &&
      entry.kinds.includes(v.kind) &&
      (entry.ops.includes('*') || v.ops.some((op) => entry.ops.includes(op))) &&
      (!entry.tables || v.tables.every((t) => entry.tables!.includes(t))) &&
      (!entry.detail || entry.detail.test(v.detail))
  );
}

/** `invariant/kind/op+op/table,table`: what FUZZ_ONLY matches (substring) and reports group by. */
export function signature(v: Violation): string {
  return `${v.invariant}/${v.kind}/${v.ops.join('+')}/${v.tables.join(',')}`;
}

export function recordKnown(entry: KnownFailure, v: Violation): void {
  const key = `${entry.id} ${v.invariant}/${v.kind} ${v.ops.join('+')} [${v.tables.join(',')}]`;
  knownHits.set(key, (knownHits.get(key) ?? 0) + 1);
}
