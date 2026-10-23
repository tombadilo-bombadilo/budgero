/**
 * Headless devices for the op-level integrity fuzz (tracker F1 invariants 5
 * and 6).
 *
 * A device is a real sql.js database with the real core services, driven the
 * way the app drives them: `AppRuntime.executeMutation` (continuous rules
 * post-hook included) -> runtime `MutationExecutor` (undo capture/build,
 * history) -> op-code registry -> core services. The coordinator is replaced
 * by `dispatch` below, which does what `MutationDispatchService` does for a
 * local op: execute, then queue `{ id, v, op, args }` for the server. Undo and
 * redo go through the real `useUndoStore` (one store, swapped per device).
 * A remote op is applied the way `RuntimeLifecycleService.applyRemoteMutation`
 * does after the transport decoded it: JSON round trip,
 * `normalizeMutationPayload`, `executor.execute({ mutationId })`.
 *
 * The specs must mock `@shared/runtime/global` to return
 * `runtimeHolder.current.runtime` (see runtime-holder.ts).
 */
import { resolve } from 'node:path';
import { vi } from 'vitest';
// The fuzz needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import {
  NodeSqlJsAdapter,
  ServiceManager,
  setClock,
  type DatabaseAdapter,
  type Services,
} from '@budgero/core';
import {
  MUTATION_FORMAT_VERSION,
  MutationExecutor,
  normalizeMutationPayload,
  type MutationSpec,
} from '@budgero/runtime';
import {
  executeMutationOp,
  getInvalidatesForOp,
  getUndoSpec,
} from '@shared/mutations/op-code-registry';
import { useUndoStore, type UndoItem } from '@shared/mutations/UndoStore';
import { AppRuntime } from '@shared/runtime/app-runtime';
import { runtimeHolder } from './runtime-holder';

export const SPACE_ID = 'space-fuzz';

// ------------------------------------------------------------------ clock

/** Local wall-clock instants the fuzz moves "today" between. */
export const CLOCK_POINTS = [
  [2026, 9, 16, 12, 0, 0], // 2026-10-16 noon (default)
  [2026, 9, 31, 23, 59, 59], // last second of October
  [2026, 10, 1, 0, 0, 1], // just after the November rollover
  [2026, 11, 31, 23, 59, 59], // last second of the year
  [2027, 0, 1, 0, 0, 1], // new year
  [2026, 9, 1, 0, 0, 0], // first instant of October
] as const;

let todayIndex = 0;

/** Index into CLOCK_POINTS of the current "today". */
export const todayPoint = () => todayIndex;

export function setToday(point: number): void {
  todayIndex = point % CLOCK_POINTS.length;
  const [y, m, d, h, mi, s] = CLOCK_POINTS[todayIndex]!;
  setClock(new Date(y, m, d, h, mi, s).getTime());
}

/** Back to the real clock. */
export const resetClock = () => setClock(null);

// ------------------------------------------------------------------ FX stub

/** Deterministic rate for a (base, symbol, date): both devices see the same. */
function stubRate(base: string, symbol: string, date: string): number {
  const day = Number(date.slice(8, 10)) + Number(date.slice(5, 7)) * 31;
  const eurUsd = 1 + (day % 9) / 40;
  if (base === 'EUR' && symbol === 'USD') return eurUsd;
  if (base === 'USD' && symbol === 'EUR') return 1 / eurUsd;
  return 1;
}

/** Replaces `fetch` with the offline FX provider (only /exchange-rates is used by core). */
export function installFxStub(): void {
  vi.stubGlobal('fetch', (url: string) => {
    const params = new URL(String(url), 'http://local').searchParams;
    const base = params.get('base') ?? 'USD';
    const date = params.get('date') ?? '2026-10-16';
    const quotes: Record<string, number> = {};
    for (const symbol of (params.get('symbols') ?? '').split(',').filter(Boolean)) {
      quotes[`${base}${symbol}`] = stubRate(base, symbol, date);
    }
    return Promise.resolve(
      new Response(JSON.stringify({ date, quotes }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  });
}

// ------------------------------------------------------------------ dumps

/**
 * Tables never compared:
 * - mutation_history: the device-local audit log (every op, undo and redo adds a row);
 * - schema_migrations, sqlite_stat1: schema / planner bookkeeping;
 * - currency_rates: the FX cache, filled on read and by the network stub.
 */
const EXCLUDED_TABLES = new Set([
  'mutation_history',
  'schema_migrations',
  'sqlite_stat1',
  'currency_rates',
]);

/**
 * Columns ignored everywhere: wall-clock timestamps written with SQL
 * `datetime('now')` (not covered by the clock seam) or the JS clock.
 */
const VOLATILE_ANY = new Set(['CreatedAt', 'UpdatedAt', 'applied_at']);
const VOLATILE_BY_TABLE: Record<string, string[]> = {
  // Device-local materialization: rows are keyed by (template, due date)
  // since A1, so their local ID is not compared; ReadyAt / NotifiedAt are
  // datetime('now').
  recurring_transaction_occurrences: ['ID', 'ReadyAt', 'NotifiedAt'],
  // The materialization cursor, advanced by reads.
  recurring_transactions: ['LastOccurrenceDate'],
  transaction_rule_runs: ['StartedAt', 'CompletedAt'],
};

/** Scheduled occurrences after this are not compared (materialization horizon). */
const OCCURRENCE_CUTOFF = '2027-03-31';

/**
 * Equivalences (same meaning, different rows), applied before comparing:
 * - an assignment row with Amount 0 is the same as no row (undo of a first
 *   assignment writes 0 instead of deleting the row).
 * - scheduled occurrences past OCCURRENCE_CUTOFF are dropped.
 */
function equivalent(table: string, row: Record<string, unknown>): boolean {
  if (table === 'assignments') return Number(row.Amount) !== 0;
  if (table === 'recurring_transaction_occurrences')
    return row.Status !== 'scheduled' || String(row.DueDate) <= OCCURRENCE_CUTOFF;
  return true;
}

export interface DumpOptions {
  /**
   * Invariant 5: sqlite_sequence is ignored (IDs burnt by an undone create are
   * not reused by design: redo re-creates under the original ID).
   * Invariant 6: compared, except the sequences of device-local tables.
   */
  sequences: boolean;
  /**
   * Invariant 6: transaction_rules.LastRunAt is SQL datetime('now') at the
   * time each device ran the rule.
   */
  crossDevice: boolean;
  /**
   * Invariant 5: a rule run marked 'undone' (and its change rows) counts as
   * no run. Undoing a run keeps its row as the run history's audit trail
   * ("Undo run" in Rules shows it as undone; redo flips the same row back),
   * so "undo restores the state before the op" holds for run bookkeeping
   * when an undone run equals no run. Everything else about the run (the
   * rule's LastRunAt / OneTimeConsumed, the restored transactions) is still
   * compared, and a redo must bring the run back exactly as it was.
   */
  hideUndoneRuns?: boolean;
}

export type Dump = Map<string, string[]>;

const LOCAL_SEQUENCES = new Set([
  'mutation_history',
  'recurring_transaction_occurrences',
  'currency_rates',
]);

function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return `blob:${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

export function dumpDb(adapter: DatabaseAdapter, options: DumpOptions): Dump {
  const tables = adapter
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  const out: Dump = new Map();
  const undoneRuns = new Set(
    options.hideUndoneRuns && tables.some((t) => t.name === 'transaction_rule_runs')
      ? (
          adapter.prepare("SELECT ID FROM transaction_rule_runs WHERE Status = 'undone'").all() as {
            ID: number;
          }[]
        ).map((row) => Number(row.ID))
      : []
  );
  const hidden = (name: string, row: Record<string, unknown>) =>
    undoneRuns.size > 0 &&
    ((name === 'transaction_rule_runs' && undoneRuns.has(Number(row.ID))) ||
      (name === 'transaction_rule_run_changes' && undoneRuns.has(Number(row.RunID))));
  for (const { name } of tables) {
    if (EXCLUDED_TABLES.has(name)) continue;
    if (name === 'sqlite_sequence' && !options.sequences) continue;
    const skip = new Set([...VOLATILE_ANY, ...(VOLATILE_BY_TABLE[name] ?? [])]);
    if (options.crossDevice && name === 'transaction_rules') skip.add('LastRunAt');
    const rows = adapter.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    const lines: string[] = [];
    for (const row of rows) {
      if (name === 'sqlite_sequence' && LOCAL_SEQUENCES.has(String(row.name))) continue;
      if (!equivalent(name, row) || hidden(name, row)) continue;
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) if (!skip.has(key)) kept[key] = encode(value);
      lines.push(JSON.stringify(kept));
    }
    lines.sort();
    out.set(name, lines);
  }
  return out;
}

export interface TableDiff {
  table: string;
  onlyLeft: string[];
  onlyRight: string[];
}

export function diffDumps(left: Dump, right: Dump): TableDiff[] {
  const diffs: TableDiff[] = [];
  for (const table of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(table) ?? [];
    const b = right.get(table) ?? [];
    if (a.length === b.length && a.every((line, i) => line === b[i])) continue;
    const setB = new Set(b);
    const setA = new Set(a);
    diffs.push({
      table,
      onlyLeft: a.filter((line) => !setB.has(line)),
      onlyRight: b.filter((line) => !setA.has(line)),
    });
  }
  return diffs;
}

export function formatDiffs(diffs: TableDiff[], left = 'expected', right = 'actual'): string {
  return diffs
    .map(
      (d) =>
        `  ${d.table}:\n${d.onlyLeft
          .slice(0, 4)
          .map((l) => `    - ${left}: ${l}`)
          .join('\n')}${d.onlyLeft.length > 4 ? `\n    ... ${d.onlyLeft.length - 4} more` : ''}${
          d.onlyLeft.length ? '\n' : ''
        }${d.onlyRight
          .slice(0, 4)
          .map((l) => `    + ${right}: ${l}`)
          .join('\n')}${d.onlyRight.length > 4 ? `\n    ... ${d.onlyRight.length - 4} more` : ''}`
    )
    .join('\n');
}

// ------------------------------------------------------------------ devices

export interface OutboundMessage {
  id: string;
  v: number;
  op: string;
  args: Record<string, unknown>;
}

const CORE_DIR = resolve(process.cwd(), '../core');

async function openServices(bytes?: Uint8Array) {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(CORE_DIR);
  try {
    const adapter = await NodeSqlJsAdapter.create(bytes);
    const manager = new ServiceManager();
    await manager.initialize(adapter as DatabaseAdapter);
    return { adapter, manager };
  } finally {
    cwd.mockRestore();
  }
}

export class Device {
  readonly outbox: OutboundMessage[] = [];

  readonly runtime: AppRuntime;

  readonly executor: MutationExecutor;

  private undoState: { past: UndoItem[]; future: UndoItem[] } = { past: [], future: [] };

  private constructor(
    readonly name: string,
    readonly adapter: NodeSqlJsAdapter,
    readonly manager: ServiceManager
  ) {
    const services = () => manager.getServices();
    this.executor = new MutationExecutor({
      executeOp: (op, payload, context) => executeMutationOp(op, payload, context),
      getUndoSpec,
      getInvalidatesForOp: (op) => getInvalidatesForOp(op),
      getInvalidatesForCall: (op, args) => getInvalidatesForOp(op, args),
      getQueryClient: () => undefined,
      pushUndo: (entry) =>
        useUndoStore.getState().push({
          id: entry.id,
          label: entry.label,
          undo: entry.undo,
          redo: entry.redo,
          ts: entry.ts,
        }),
      // Same as AppRuntime's late-bound recordHistory.
      recordHistory: (entry) => {
        try {
          services().mutationHistory.record({
            budgetId: entry.budgetId ?? 0,
            spaceId: entry.spaceId ?? '',
            mutationId: entry.mutationId,
            userId: entry.userId ?? null,
            op: entry.op,
            payload: entry.payload,
            origin: entry.origin,
            undoOps: entry.undoOps ?? null,
            redoOps: entry.redoOps ?? null,
          });
        } catch {
          /* no-op */
        }
      },
      getActiveSpaceId: () => SPACE_ID,
      getSpaceRole: () => 'owner',
    });
    this.runtime = new AppRuntime();
    const internals = this.runtime as unknown as {
      coordinator: unknown;
      serviceManager: ServiceManager;
    };
    internals.serviceManager = manager;
    internals.coordinator = {
      executeMutation: (spec: MutationSpec) => this.dispatch(spec),
      isMutationApplied: () => false,
      getActiveSpaceId: () => SPACE_ID,
    };
  }

  static async open(name: string, bytes?: Uint8Array): Promise<Device> {
    const { adapter, manager } = await openServices(bytes);
    return new Device(name, adapter, manager);
  }

  get services(): Services {
    return this.manager.getServices();
  }

  /** MutationDispatchService for a local op: execute, then queue what the server gets. */
  private async dispatch(spec: MutationSpec) {
    const { result, mutationId, isReceiver } = await this.executor.execute(spec);
    if (!isReceiver) {
      this.outbox.push(
        JSON.parse(
          JSON.stringify({
            id: mutationId,
            v: MUTATION_FORMAT_VERSION,
            op: spec.op,
            args: spec.payload,
          })
        ) as OutboundMessage
      );
    }
    return { result, synced: true, queued: false };
  }

  /** Make this device the active one for `getRuntime()` and the undo store. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    runtimeHolder.current = this;
    useUndoStore.setState({ ...this.undoState, isReplaying: false });
    try {
      return await fn();
    } finally {
      const { past, future } = useUndoStore.getState();
      this.undoState = { past, future };
    }
  }

  /** A user action on this device (what a hook's `mutationsRouter().execute` does). */
  local<T = unknown>(op: string, payload: Record<string, unknown>): Promise<T> {
    return this.run(async () => {
      const { result } = await this.runtime.mutationsRouter().execute<T>({
        op,
        payload,
        spaceId: SPACE_ID,
        meta: { label: 'fuzz' },
      });
      return result;
    });
  }

  async undo(): Promise<void> {
    await this.run(() => useUndoStore.getState().undo());
  }

  async redo(): Promise<void> {
    await this.run(() => useUndoStore.getState().redo());
  }

  undoDepth(): number {
    return this.undoState.past.length;
  }

  redoDepth(): number {
    return this.undoState.future.length;
  }

  clearUndo(): void {
    this.undoState = { past: [], future: [] };
  }

  /** Apply one message from another device (transport decode + lifecycle apply). */
  receive(message: OutboundMessage): Promise<void> {
    return this.run(async () => {
      const decoded = JSON.parse(JSON.stringify(message)) as OutboundMessage;
      const { op, args } = normalizeMutationPayload(decoded);
      await this.executor.execute({ op, payload: args, mutationId: decoded.id, spaceId: SPACE_ID });
    });
  }

  dump(options: DumpOptions): Dump {
    materializeOccurrences(this);
    return dumpDb(this.adapter, options);
  }

  close(): void {
    if (runtimeHolder.current === this) runtimeHolder.current = null;
    this.adapter.close();
  }
}

/**
 * Occurrences are materialized by reads up to a clock-relative horizon. Every
 * dump first materializes through OCCURRENCE_CUTOFF (until stable), so
 * read-side materialization never shows up as a difference.
 */
function materializeOccurrences(device: Device): void {
  const budgets = device.adapter.prepare('SELECT ID FROM budgets').all() as { ID: number }[];
  const count = () =>
    Number(
      (
        device.adapter
          .prepare('SELECT COUNT(*) AS n FROM recurring_transaction_occurrences')
          .get() as { n: number }
      ).n
    );
  for (let pass = 0, before = -1; pass < 10 && before !== count(); pass += 1) {
    before = count();
    for (const { ID } of budgets)
      device.services.recurring.ensureOccurrencesThrough(ID, OCCURRENCE_CUTOFF);
  }
}

/** Rows of a query on a device (for op argument realization). */
export function rows<T>(device: Device, sql: string, ...params: unknown[]): T[] {
  return device.adapter.prepare(sql).all(...params) as T[];
}

export function ids(device: Device, sql: string, ...params: unknown[]): number[] {
  return rows<{ ID: number }>(device, sql, ...params).map((r) => Number(r.ID));
}
