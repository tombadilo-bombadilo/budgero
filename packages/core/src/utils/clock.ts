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

/**
 * Active pins, newest last. Each runAtClock call removes its own entry when it
 * ends, so pins that overlap (async ops interleaving) can never leave the
 * clock stuck at an old instant.
 */
const pins: { at: number }[] = [];

/** The clock without any op pin: the real clock, or a test's setClock. */
function unpinnedNow(): number {
  return override ? override() : Date.now();
}

export const clock = {
  /** Milliseconds since the epoch, like `Date.now()`. */
  now(): number {
    const top = pins[pins.length - 1];
    return top ? top.at : unpinnedNow();
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
 * Runs `fn` with the clock fixed at `at` (epoch ms), then removes that pin;
 * for an async `fn`, once it settles. Used to replay an op at the instant it
 * originated, so every device computes the same "today". If two async pins
 * overlap, the newest one is read while both run, and the clock is unpinned
 * once both have ended, whatever order they end in.
 */
export function runAtClock<T>(at: number, fn: () => T): T {
  const pin = { at };
  pins.push(pin);
  const release = () => {
    const index = pins.lastIndexOf(pin);
    if (index !== -1) pins.splice(index, 1);
  };
  let settlesLater = false;
  try {
    const result = fn();
    if (result instanceof Promise) {
      settlesLater = true;
      return result.finally(release) as T;
    }
    return result;
  } finally {
    if (!settlesLater) release();
  }
}

/**
 * The clock as a service object (Services.clock), for callers that must read
 * or pin the same clock instance the services use.
 */
export const serviceClock = {
  now: (): number => clock.now(),
  /** Ignores op pins: for stamping a new local op with the time it was made. */
  unpinnedNow,
  runAt: runAtClock,
};
