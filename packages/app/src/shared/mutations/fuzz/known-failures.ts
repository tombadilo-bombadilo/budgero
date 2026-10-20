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
      'transactions.add',
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
    tables: [...RULE_LOG, 'payees', 'categories', 'category_groups'],
    note: 'Undo of an add / import / transfer / posted bill leaves the continuous-rule run it triggered (run row, LastRunAt) pointing at a deleted row; a transfer or posted recurring transfer also leaves the Transfers category (and group) it auto-created.',
  },
  {
    id: 'NEW-4',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch', 'redo-mismatch', 'chain-redo-mismatch'],
    ops: ['transactions.moveToNewAccount', 'transactions.updateColumn', 'transactions.batchEdit'],
    tables: ['accounts', 'transactions'],
    note: 'Moving a row between accounts of different currencies is not reversible: the native amount is re-derived from the converted one on each move (86.38 EUR -> 79.18 or 88.30 EUR after undo), and ConversionPending stays set after moving back.',
  },

  {
    id: 'NEW-14',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['recurring.update', 'recurring.create'],
    tables: ['recurring_transactions', 'categories', 'recurring_transaction_occurrences'],
    note: 'Recurring transfer templates: undo of any edit (memo, category, ...) writes the auto-created Transfers category instead of the NULL CategoryID it had; undo of creating one leaves the Transfers category it auto-created.',
  },
  {
    id: 'NEW-10',
    invariant: 'undo',
    kinds: ['undo-threw'],
    ops: ['transactions.updateColumn'],
    detail: /Exchange rate must be a finite number/,
    note: 'ExchangeRate cell edit on a foreign row with no stored rate: undo re-applies the captured NULL and throws, so the edit cannot be undone.',
  },
  {
    id: 'NEW-15',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['transactions.updateColumn'],
    tables: ['transaction_splits', 'transactions', 'accounts'],
    note: 'Editing a split parent amount re-proportions its lines (A19 fix); undo restores the parent amount but re-proportions again instead of restoring the original lines (50/40 becomes 90/0; the mirror row of a split-transfer line and the balance of the other account move with it).',
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
    id: 'NEW-18',
    invariant: 'undo',
    kinds: ['failed-op-partial'],
    ops: ['undo:rules.execute', 'redo:rules.execute'],
    detail: /Failed to restore transaction/,
    note: 'rules.undoRun is not atomic: when a restored category no longer exists (deleted since the run) it throws on a FOREIGN KEY error after restoring the earlier rows, and nothing is rolled back or synced.',
  },
  // ---------------------------------------------------------------- replay (invariant 6)
  {
    id: 'NEW-18',
    invariant: 'replay',
    kinds: ['failed-op-partial'],
    ops: ['undo', 'redo'],
    detail: /Failed to restore transaction/,
    note: 'Same as the undo entry: device B runs a rule, device A deletes a category the rule moved rows out of, B presses undo: rows before the failing one stay restored on B only.',
  },
  {
    id: 'NEW-16',
    invariant: 'replay',
    kinds: ['replay-threw'],
    ops: ['rules.undoRun'],
    detail: /Only the most recent completed run can be undone/,
    note: 'Same as the undo entry, across devices: an undo of a rule run replayed after the other device ran a continuous rule throws there.',
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
