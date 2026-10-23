/**
 * Invariant 5 (tracker F1): undo restores the database exactly, redo
 * re-applies it exactly, for random sequences of real op-code-registry ops
 * run through AppRuntime -> MutationExecutor -> UndoStore on a real sql.js
 * database. See invariants.ts; known failures: known-failures.ts.
 *
 * Default: a short deterministic run. Long mode:
 *   FUZZ_RUNS=5000 [FUZZ_STEPS=10] [FUZZ_SEED=n] [FUZZ_STRICT=1] [FUZZ_REPORT=file]
 *   pnpm exec vitest run src/shared/mutations/fuzz/undo-exactness.fuzz.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { opCodeRegistry } from '@shared/mutations/op-code-registry';
import { installFxStub, resetClock } from './harness';
import { OP_KINDS, opCodeOf } from './ops';
import {
  LONG,
  fuzzParams,
  runUndoSequence,
  summary,
  templateBytes,
  undoStepArb,
} from './invariants';

vi.mock('@shared/runtime/global', async (importOriginal) => {
  const { runtimeHolder } = await import('./runtime-holder');
  return {
    ...(await importOriginal<object>()),
    getRuntime: () => runtimeHolder.current?.runtime ?? null,
  };
});

const { runs, steps, seed } = fuzzParams(5005, 40, 8);

describe('integrity fuzz: undo exactness (invariant 5)', () => {
  beforeAll(async () => {
    installFxStub();
    await templateBytes();
  });
  afterAll(() => {
    resetClock();
    vi.unstubAllGlobals();
    if (LONG)
      process.stdout.write(
        `${summary(`undo exactness: ${runs} runs x ${steps} steps, seed ${seed}`)}\n`
      );
  });

  it('generates every undoable op code', () => {
    const generated = new Set(OP_KINDS.map(opCodeOf));
    const undoable = Object.entries(opCodeRegistry)
      .filter(([, entry]) => 'undo' in entry && entry.undo)
      .map(([op]) => op);
    expect(undoable.filter((op) => !generated.has(op))).toEqual([]);
  });

  it(
    'undo and redo restore the exact database state',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(undoStepArb, { minLength: 1, maxLength: steps }), (s) =>
          runUndoSequence(s)
        ),
        { numRuns: runs, seed, endOnFailure: false }
      );
    },
    LONG ? 24 * 3600_000 : 120_000
  );
});
