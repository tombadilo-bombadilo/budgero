/**
 * Invariant 5 (undo exactness) and 6 (multi-device replay determinism) for
 * the op-level integrity fuzz. See harness.ts for how devices run ops, and
 * known-failures.ts for the allow-list.
 *
 * Invariant 5, per step on one device: run a random op as a user action;
 * if it throws, the DB must be unchanged; if it changed the DB, it must have
 * pushed an undo entry; undo must restore the DB exactly as before the op,
 * redo exactly as after; optionally undo -> redo again (chain). The clock can
 * move between the op and its undo (midnight / month / year rollover).
 *
 * Invariant 6: devices A and B start from the same bytes. Each step runs a
 * user action (or undo / redo) on one device; every op it sends is delivered
 * to the other device (immediately, or batched while "offline" until the
 * other device acts next, so both apply one total order). Whenever nothing is
 * in flight both DBs must be equal, IDs included.
 */
import fc from 'fast-check';
import { appendFileSync } from 'node:fs';
import {
  Device,
  diffDumps,
  formatDiffs,
  setToday,
  todayPoint,
  type DumpOptions,
  type OutboundMessage,
} from './harness';
import { intentArb, opCodeOf, realize, resetUniqueCounter, seedDataset, type Intent } from './ops';
import { knownHits, matchKnown, recordKnown, signature, type Violation } from './known-failures';

export const LONG = process.env.FUZZ_RUNS !== undefined;
const REPORT = process.env.FUZZ_REPORT;
const COLLECT = process.env.FUZZ_COLLECT;
/** The sequence being run (for FUZZ_COLLECT). */
let currentSequence: unknown = null;

let template: Uint8Array | undefined;

export async function templateBytes(): Promise<Uint8Array> {
  if (!template) {
    setToday(0);
    const seed = await Device.open('seed');
    await seedDataset(seed);
    template = seed.adapter.backup();
    seed.close();
  }
  return template;
}

class ViolationError extends Error {}

function violate(v: Violation): void {
  const known = matchKnown(v);
  if (known) {
    recordKnown(known, v);
    if (REPORT) appendFileSync(REPORT, `${JSON.stringify({ known: known.id, ...v })}\n`);
    throw new KnownViolation();
  }
  if (COLLECT) {
    appendFileSync(
      COLLECT,
      `${JSON.stringify({ signature: signature(v), detail: v.detail, sequence: currentSequence })}\n`
    );
    throw new KnownViolation();
  }
  throw new ViolationError(
    `[${v.invariant}] ${v.kind} on ${v.ops.join(' + ')}${
      v.tables.length ? ` (tables: ${v.tables.join(', ')})` : ''
    }\n${v.detail}`
  );
}

/** Thrown to stop the current step after a known (allow-listed) violation. */
class KnownViolation extends Error {}

/** Per op code: how many times each check ran clean (coverage summary). */
export const coverage = new Map<string, { ok: number; noop: number; threw: number }>();

function cover(op: string, field: 'ok' | 'noop' | 'threw') {
  const entry = coverage.get(op) ?? { ok: 0, noop: 0, threw: 0 };
  entry[field] += 1;
  coverage.set(op, entry);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ------------------------------------------------------------------ invariant 5

const UNDO_DUMP: DumpOptions = { sequences: false, crossDevice: false };

export const undoStepArb = fc.record({
  intent: intentArb,
  /** Move today before the op (null = keep). */
  tick: fc.option(fc.nat(5), { freq: 4 }),
  /** Move today between the op and its undo. */
  tickBeforeUndo: fc.option(fc.nat(5), { freq: 6 }),
  /** Extra undo -> redo rounds after the first undo/redo. */
  chain: fc.nat(1),
});
export type UndoStep = typeof undoStepArb extends fc.Arbitrary<infer T> ? T : never;

async function undoStep(device: Device, step: UndoStep): Promise<void> {
  if (step.tick !== null) setToday(step.tick);
  const call = realize(device, step.intent);
  if (!call) return;
  const label = `${step.intent.k} ${JSON.stringify(call.payload)}`;
  const base = { invariant: 'undo' as const, ops: [call.op] };
  const pre = device.dump(UNDO_DUMP);
  const depth = device.undoDepth();
  try {
    await device.local(call.op, call.payload);
  } catch (error) {
    cover(call.op, 'threw');
    const diffs = diffDumps(pre, device.dump(UNDO_DUMP));
    if (diffs.length)
      violate({
        ...base,
        kind: 'failed-op-partial',
        tables: diffs.map((d) => d.table),
        detail: `${label}\n  threw: ${errorText(error)}\n${formatDiffs(diffs, 'before', 'after throw')}`,
      });
    return;
  }
  const post = device.dump(UNDO_DUMP);
  const changes = diffDumps(pre, post);
  if (device.undoDepth() === depth) {
    if (changes.length)
      violate({
        ...base,
        kind: 'no-undo-entry',
        tables: changes.map((d) => d.table),
        detail: `${label}\n${formatDiffs(changes, 'before', 'after')}`,
      });
    cover(call.op, 'noop');
    return;
  }
  // Undo after the clock moved must still restore the state exactly; a redo
  // at another "today" may legitimately differ (rates, stamps), so it is only
  // checked when the clock did not move.
  const moved = step.tickBeforeUndo !== null;
  if (moved) setToday(step.tickBeforeUndo!);

  const check = async (
    action: 'undo' | 'redo',
    expected: typeof pre,
    threwKind: Violation['kind'],
    mismatchKind: Violation['kind']
  ) => {
    try {
      await (action === 'undo' ? device.undo() : device.redo());
    } catch (error) {
      violate({
        ...base,
        kind: threwKind,
        tables: [],
        detail: `${label}\n  ${action} threw: ${errorText(error)}`,
      });
    }
    const diffs = diffDumps(expected, device.dump(UNDO_DUMP));
    if (diffs.length)
      violate({
        ...base,
        kind: mismatchKind,
        tables: diffs.map((d) => d.table),
        detail: `${label}\n${formatDiffs(diffs, action === 'undo' ? 'before op' : 'after op', `after ${action}`)}`,
      });
  };
  await check('undo', pre, 'undo-threw', 'undo-mismatch');
  if (moved) {
    cover(call.op, 'ok');
    return;
  }
  await check('redo', post, 'redo-threw', 'redo-mismatch');
  for (let round = 0; round < step.chain; round += 1) {
    await check('undo', pre, 'undo-threw', 'chain-undo-mismatch');
    await check('redo', post, 'redo-threw', 'chain-redo-mismatch');
  }
  cover(call.op, 'ok');
}

export async function runUndoSequence(steps: UndoStep[]): Promise<void> {
  currentSequence = steps;
  resetUniqueCounter();
  setToday(0);
  const device = await Device.open('A', await templateBytes());
  try {
    for (const step of steps) {
      try {
        await undoStep(device, step);
      } catch (error) {
        if (!(error instanceof KnownViolation)) throw error;
      }
    }
  } finally {
    device.close();
  }
}

// ------------------------------------------------------------------ invariant 6

const REPLAY_DUMP: DumpOptions = { sequences: true, crossDevice: true };

export const replayStepArb = fc.record({
  intent: intentArb,
  onB: fc.boolean(),
  /** 0 = user op, 1 = undo, 2 = redo (on the acting device). */
  action: fc.oneof(
    { weight: 8, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.constant(1) },
    { weight: 1, arbitrary: fc.constant(2) }
  ),
  /** Hold this step's ops until the other device acts next. */
  offline: fc.boolean(),
  tick: fc.option(fc.nat(5), { freq: 5 }),
});
export type ReplayStep = typeof replayStepArb extends fc.Arbitrary<infer T> ? T : never;

export async function runReplaySequence(steps: ReplayStep[]): Promise<void> {
  currentSequence = steps;
  resetUniqueCounter();
  setToday(0);
  const bytes = await templateBytes();
  let a = await Device.open('A', bytes);
  let b = await Device.open('B', bytes);
  const inbox = new Map<Device, OutboundMessage[]>([
    [a, []],
    [b, []],
  ]);
  let undelivered: string[] = [];
  let sent: string[] = [];
  /** Clock point each in-flight message was sent at. */
  const sentAt = new Map<string, number>();
  /** "today" moved between a send and its delivery since the last equal state. */
  let skew = false;

  /**
   * After a known divergence, restart both devices from A's bytes so later
   * steps start equal (both reopen, so open-time cleanup applies to both;
   * undo stacks are dropped).
   */
  const resync = async () => {
    const bytes = a.adapter.backup();
    a.close();
    b.close();
    a = await Device.open('A', bytes);
    b = await Device.open('B', bytes);
    inbox.clear();
    inbox.set(a, []);
    inbox.set(b, []);
    undelivered = [];
    sent = [];
    skew = false;
  };

  const deliver = async (to: Device) => {
    const queue = inbox.get(to)!;
    while (queue.length) {
      const message = queue.shift()!;
      if (sentAt.get(message.id) !== todayPoint()) skew = true;
      try {
        await to.receive(message);
      } catch (error) {
        violate({
          invariant: 'replay',
          kind: 'replay-threw',
          ops: [message.op],
          tables: [],
          detail: `${message.op} ${JSON.stringify(message.args)}\n  threw on ${to.name}: ${errorText(error)}\n  sent so far: ${sent.join(', ')}`,
        });
      }
    }
  };

  const compare = () => {
    const diffs = diffDumps(a.dump(REPLAY_DUMP), b.dump(REPLAY_DUMP));
    if (diffs.length)
      violate({
        invariant: 'replay',
        kind: skew ? 'replay-diverged-clock' : 'replay-diverged',
        ops: [...new Set(undelivered)],
        tables: diffs.map((d) => d.table),
        detail: `ops since last equal state: ${undelivered.join(', ')}\n${formatDiffs(diffs, 'A', 'B')}`,
      });
    undelivered = [];
    skew = false;
  };

  try {
    for (const step of steps) {
      try {
        if (step.tick !== null) setToday(step.tick);
        const actor = step.onB ? b : a;
        const other = actor === a ? b : a;
        // One total order: the actor first applies everything sent to it.
        await deliver(actor);
        const call = step.action === 0 ? realize(actor, step.intent) : null;
        const before = call ? actor.dump(REPLAY_DUMP) : null;
        try {
          if (step.action === 1) await actor.undo();
          else if (step.action === 2) await actor.redo();
          else if (call) await actor.local(call.op, call.payload);
        } catch (error) {
          // A rejected user op sends nothing, so it must not have written anything.
          const diffs = before ? diffDumps(before, actor.dump(REPLAY_DUMP)) : [];
          if (call && diffs.length && !actor.outbox.length)
            violate({
              invariant: 'replay',
              kind: 'failed-op-partial',
              ops: [call.op],
              tables: diffs.map((d) => d.table),
              detail: `${step.intent.k} ${JSON.stringify(call.payload)} on ${actor.name}\n  threw: ${errorText(error)}\n${formatDiffs(diffs, 'before', 'after throw')}`,
            });
        }
        const messages = actor.outbox.splice(0);
        for (const m of messages) {
          sentAt.set(m.id, todayPoint());
          sent.push(`${actor.name}:${m.op}`);
          undelivered.push(m.op);
        }
        inbox.get(other)!.push(...messages);
        if (!step.offline) {
          await deliver(other);
          compare();
        }
      } catch (error) {
        if (!(error instanceof KnownViolation)) throw error;
        await resync();
      }
    }
    try {
      await deliver(a);
      await deliver(b);
      compare();
    } catch (error) {
      if (!(error instanceof KnownViolation)) throw error;
    }
  } finally {
    a.close();
    b.close();
  }
}

// ------------------------------------------------------------------ helpers

export function fuzzParams(seed: number, defaultRuns: number, defaultSteps: number) {
  return {
    runs: Number(process.env.FUZZ_RUNS ?? defaultRuns),
    steps: Number(process.env.FUZZ_STEPS ?? defaultSteps),
    seed: seed + Number(process.env.FUZZ_SEED ?? 0),
  };
}

export function summary(title: string): string {
  const lines = [title, '  known (allow-listed) violations:'];
  for (const [key, count] of [...knownHits].sort()) lines.push(`    ${count} x ${key}`);
  lines.push('  coverage (op: verified / no-op / rejected):');
  for (const [op, c] of [...coverage].sort())
    lines.push(`    ${op}: ${c.ok} / ${c.noop} / ${c.threw}`);
  return lines.join('\n');
}

export type { Intent };
export { opCodeOf };
