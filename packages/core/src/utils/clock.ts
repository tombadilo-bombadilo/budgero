/**
 * Wall-clock seam for core services.
 *
 * Every "what is today / now" read in the services goes through `clock`, so
 * tests can move today (midnight rollover, month or year boundaries) without
 * faking timers. The default reads the real clock at call time, so behaviour
 * (and `vi.useFakeTimers` / `vi.setSystemTime`) is unchanged.
 *
 * Not routed: real-time intervals (FX request throttling, import progress
 * throttling) and SQL `datetime('now')` / `date('now')`.
 */
let override: (() => number) | null = null;

export const clock = {
  /** Milliseconds since the epoch, like `Date.now()`. */
  now(): number {
    return override ? override() : Date.now();
  },
  /** A fresh `Date` for the current instant, like `new Date()`. */
  date(): Date {
    return new Date(clock.now());
  },
};

/**
 * Replace the clock (tests). Pass a fixed epoch-ms value, a function, or null
 * to restore the real clock.
 */
export function setClock(next: number | Date | (() => number) | null): void {
  if (next === null) {
    override = null;
  } else if (typeof next === 'function') {
    override = next;
  } else {
    const fixed = typeof next === 'number' ? next : next.getTime();
    override = () => fixed;
  }
}

/**
 * Runs `fn` with the clock fixed at `at` (epoch ms), then puts the previous
 * clock back; for an async `fn`, once it settles. Used to replay an op at the
 * instant it originated, so every device computes the same "today". Pins
 * don't interleave: ops run one at a time.
 */
export function runAtClock<T>(at: number, fn: () => T): T {
  const previous = override;
  override = () => at;
  let settlesLater = false;
  try {
    const result = fn();
    if (result instanceof Promise) {
      settlesLater = true;
      return result.finally(() => {
        override = previous;
      }) as T;
    }
    return result;
  } finally {
    if (!settlesLater) override = previous;
  }
}

/**
 * The clock as a service object (Services.clock), for callers that must read
 * or pin the same clock instance the services use.
 */
export const serviceClock = {
  now: (): number => clock.now(),
  runAt: runAtClock,
};
