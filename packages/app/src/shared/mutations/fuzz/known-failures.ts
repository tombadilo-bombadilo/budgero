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

/**
 * Order matters: the first matching entry wins, so narrow entries come
 * before broad ones. Shrunk counterexamples are in the F1 report.
 */
export const KNOWN_FAILURES: KnownFailure[] = [
  // ---------------------------------------------------------------- undo (invariant 5)
  {
    id: 'A23-payee',
    invariant: 'undo',
    kinds: ['undo-mismatch', 'chain-undo-mismatch'],
    ops: ['accounts.createLinked'],
    tables: ['payees'],
    note: "Undo of a linked account create keeps the system payee 'Budgero' its opening row added to the directory (only when it was missing, e.g. renamed away). accounts.create removes it; the createLinked undo is pinned to the delete alone by accounts.delete-undo.integration.spec.",
  },
  // ---------------------------------------------------------------- replay (invariant 6)
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
