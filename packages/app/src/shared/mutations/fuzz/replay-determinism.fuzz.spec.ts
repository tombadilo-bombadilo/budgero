/**
 * Invariant 6 (tracker F1): two devices that apply the same synced op stream
 * end with identical databases (user tables, IDs included). Ops originate on
 * either device, go through AppRuntime -> MutationExecutor like the app, and
 * are replayed on the other device through the remote path. See
 * invariants.ts; known failures: known-failures.ts.
 *
 * Default: a short deterministic run. Long mode:
 *   FUZZ_RUNS=5000 [FUZZ_STEPS=12] [FUZZ_SEED=n] [FUZZ_STRICT=1] [FUZZ_REPORT=file]
 *   pnpm exec vitest run src/shared/mutations/fuzz/replay-determinism.fuzz.spec.ts
 */
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import fc from 'fast-check';
import { installFxStub, resetClock } from './harness';
import {
  LONG,
  fuzzParams,
  replayStepArb,
  runReplaySequence,
  summary,
  templateBytes,
} from './invariants';

vi.mock('@shared/runtime/global', async (importOriginal) => {
  const { runtimeHolder } = await import('./runtime-holder');
  return {
    ...(await importOriginal<object>()),
    getRuntime: () => runtimeHolder.current?.runtime ?? null,
  };
});

const { runs, steps, seed } = fuzzParams(6006, 30, 10);

describe('integrity fuzz: multi-device replay (invariant 6)', () => {
  beforeAll(async () => {
    installFxStub();
    await templateBytes();
  });
  afterAll(() => {
    resetClock();
    vi.unstubAllGlobals();
    if (LONG)
      process.stdout.write(
        `${summary(`replay determinism: ${runs} runs x ${steps} steps, seed ${seed}`)}\n`
      );
  });

  it(
    'both devices end with identical databases',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(replayStepArb, { minLength: 1, maxLength: steps }), (s) =>
          runReplaySequence(s)
        ),
        { numRuns: runs, seed, endOnFailure: false }
      );
    },
    LONG ? 24 * 3600_000 : 120_000
  );
});
