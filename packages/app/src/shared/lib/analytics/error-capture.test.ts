import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExceptionProps, errorFromEvent, parseStackFrames } from './error-capture';
import { syncErrorCode, toErrorCode } from './error-codes';

const posthog = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() };
vi.mock('posthog-js', () => ({ default: posthog }));

const envState = { selfHost: false };
vi.mock('@shared/lib/env', () => ({
  get IS_SELF_HOSTABLE_BUILD() {
    return envState.selfHost;
  },
}));

const SECRET = 'Payee "Dr. Jane Smith" amount 1234.56 for account 9876';
const ORIGIN = window.location.origin;

function expectNoSecret(value: unknown): void {
  const json = JSON.stringify(value);
  for (const part of ['Jane', 'Smith', '1234', '9876', 'Payee']) expect(json).not.toContain(part);
}

type ExceptionEntry = {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: boolean; type: string };
  stacktrace: { type: string; frames: Record<string, unknown>[] };
};

const exceptionOf = (props: Record<string, unknown>) =>
  (props.$exception_list as ExceptionEntry[])[0];

/** What Chrome prints for a TypeError thrown from the minified production bundle. */
function minifiedChromeTypeError(): TypeError {
  const error = new TypeError(SECRET);
  error.stack = [
    `TypeError: ${SECRET}`,
    `    at Ab (${ORIGIN}/assets/index-IgKWHLwQ.js:4563:382488)`,
    `    at HTMLButtonElement.zq [as onClick] (${ORIGIN}/assets/index-IgKWHLwQ.js:12:9041)`,
    `    at async Object.<anonymous> (${ORIGIN}/assets/AccountPage-Dk3.js:1:2207)`,
    `    at ${ORIGIN}/assets/index-IgKWHLwQ.js?v=1#frag:25:28846`,
    '    at chrome-extension://abcdef/content.js:3:4',
    '    at async Promise.all (index 0)',
  ].join('\n');
  return error;
}

afterEach(() => {
  delete (globalThis as { _posthogChunkIds?: unknown })._posthogChunkIds;
  delete (globalThis as { _posthogReleaseId?: unknown })._posthogReleaseId;
});

describe('error capture scrubbing', () => {
  it('keeps the TypeError type and frames of a minified stack, drops the message', () => {
    const props = buildExceptionProps(minifiedChromeTypeError(), {
      handled: false,
      source: 'onerror',
    });
    expectNoSecret(props);
    const exception = exceptionOf(props);
    expect(exception.type).toBe('TypeError');
    expect(exception.value).toBe('TypeError');
    expect(props.error_code).toBe('unknown');
    expect(exception.stacktrace.frames).toEqual([
      { platform: 'web:javascript', filename: '<external>', lineno: 3, colno: 4, in_app: false },
      {
        platform: 'web:javascript',
        filename: '/assets/index-IgKWHLwQ.js',
        lineno: 25,
        colno: 28846,
        in_app: true,
      },
      {
        platform: 'web:javascript',
        filename: '/assets/AccountPage-Dk3.js',
        lineno: 1,
        colno: 2207,
        in_app: true,
      },
      {
        platform: 'web:javascript',
        filename: '/assets/index-IgKWHLwQ.js',
        lineno: 12,
        colno: 9041,
        function: 'HTMLButtonElement.zq',
        in_app: true,
      },
      {
        platform: 'web:javascript',
        filename: '/assets/index-IgKWHLwQ.js',
        lineno: 4563,
        colno: 382488,
        function: 'Ab',
        in_app: true,
      },
    ]);
  });

  it('parses Firefox and Safari stacks', () => {
    const frames = parseStackFrames(
      [
        `zq/<@${ORIGIN}/assets/index-a.js:12:9041`,
        `@${ORIGIN}/assets/index-a.js:1:5`,
        `global code@${ORIGIN}/assets/index-a.js:2:6`,
      ].join('\n')
    );
    expect(frames.map((f) => [f.function, f.lineno, f.colno])).toEqual([
      [undefined, 2, 6],
      [undefined, 1, 5],
      ['zq', 12, 9041],
    ]);
  });

  it('turns frames from other origins into <external> without function names', () => {
    const frames = parseStackFrames(
      [
        '    at stealPayee (https://cdn.example.com/lib.js?user=9876:1:2)',
        'leak@moz-extension://abc/x.js:5:6',
        `    at ok (${ORIGIN}/assets/index-a.js:7:8)`,
      ].join('\n')
    );
    expect(frames).toEqual([
      {
        platform: 'web:javascript',
        filename: '/assets/index-a.js',
        lineno: 7,
        colno: 8,
        function: 'ok',
        in_app: true,
      },
      { platform: 'web:javascript', filename: '<external>', lineno: 5, colno: 6, in_app: false },
      { platform: 'web:javascript', filename: '<external>', lineno: 1, colno: 2, in_app: false },
    ]);
    const json = JSON.stringify(frames);
    for (const bit of ['example.com', '9876', 'stealPayee', 'leak', 'moz-extension']) {
      expect(json).not.toContain(bit);
    }
  });

  it('never parses message lines as frames', () => {
    const message = `${SECRET}\n    at Jane (${ORIGIN}/assets/index-a.js:1:2)`;
    const error = new TypeError(message);
    error.stack = `TypeError: ${message}\n    at ok (${ORIGIN}/assets/index-a.js:7:8)`;
    const props = buildExceptionProps(error, { handled: true, source: 'manual' });
    expectNoSecret(props);
    expect(exceptionOf(props).stacktrace.frames).toHaveLength(1);
  });

  it('keeps unparseable script locations as <external>', () => {
    const frames = parseStackFrames(
      '    at <anonymous>:3:9\n    at x (pptr:evaluateOnNewDocument;abc:5:6)'
    );
    expect(frames.map((f) => f.filename)).toEqual(['<external>', '<external>']);
  });

  it('drops function names that are not plain identifiers', () => {
    const [frame] = parseStackFrames(`    at ${SECRET} (${ORIGIN}/assets/index-a.js:1:2)`);
    expect(frame.function).toBeUndefined();
    expectNoSecret(frame);
  });

  it('attaches posthog-cli chunk ids and the release id', () => {
    (globalThis as Record<string, unknown>)._posthogChunkIds = {
      [`Error\n    at ${ORIGIN}/assets/index-IgKWHLwQ.js:1:10`]: 'chunk-index-0001',
      [`Error\n    at https://evil.example/x.js:1:1`]: 'chunk-evil',
    };
    (globalThis as Record<string, unknown>)._posthogReleaseId = 'rel-42';
    const props = buildExceptionProps(minifiedChromeTypeError(), { handled: true, source: 'x' });
    const frames = exceptionOf(props).stacktrace.frames;
    expect(frames.filter((f) => f.chunk_id === 'chunk-index-0001')).toHaveLength(2);
    expect(JSON.stringify(props)).not.toContain('chunk-evil');
    expect(props.$release_id).toBe('rel-42');
  });

  it('matches the PostHog $exception_list format', () => {
    const props = buildExceptionProps(minifiedChromeTypeError(), {
      handled: false,
      source: 'onerror',
    });
    expect(Object.keys(props).sort()).toEqual(
      ['$exception_level', '$exception_list', 'area', 'error_code'].sort()
    );
    expect(props.$exception_level).toBe('error');
    const list = props.$exception_list as ExceptionEntry[];
    expect(list).toHaveLength(1);
    const [exception] = list;
    expect(Object.keys(exception).sort()).toEqual(['mechanism', 'stacktrace', 'type', 'value']);
    expect(exception.mechanism).toEqual({ handled: false, synthetic: false, type: 'onerror' });
    expect(exception.stacktrace.type).toBe('raw');
    for (const frame of exception.stacktrace.frames) {
      expect(frame.platform).toBe('web:javascript');
      expect(typeof frame.filename).toBe('string');
      expect(Number.isInteger(frame.lineno)).toBe(true);
      expect(Number.isInteger(frame.colno)).toBe(true);
      expect(typeof frame.in_app).toBe('boolean');
      for (const key of Object.keys(frame)) {
        expect([
          'platform',
          'filename',
          'lineno',
          'colno',
          'function',
          'in_app',
          'chunk_id',
        ]).toContain(key);
      }
    }
  });

  it('uses our error code as the value when known', () => {
    const error = Object.assign(new Error(SECRET), { name: 'ApiError', status: 429 });
    const exception = exceptionOf(buildExceptionProps(error, { handled: true, source: 'manual' }));
    expect(exception.type).toBe('ApiError');
    expect(exception.value).toBe('rate_limited');
  });

  it('keeps DOMException names', () => {
    const error = new DOMException(SECRET, 'NotFoundError');
    const props = buildExceptionProps(error, { handled: false, source: 'onerror' });
    expect(exceptionOf(props).type).toBe('NotFoundError');
    expectNoSecret(props);
  });

  it('does not report mangled constructor names of minified classes', () => {
    // What esbuild's minifier turns `class OfflineFailure extends Error {}` into.
    const Mangled = { zb: class extends Error {} }.zb;
    expect(Mangled.name).toBe('zb');
    expect(
      exceptionOf(buildExceptionProps(new Mangled('x'), { handled: true, source: 'm' })).type
    ).toBe('Error');
    class RateLimitError extends Error {}
    expect(
      exceptionOf(buildExceptionProps(new RateLimitError('x'), { handled: true, source: 'm' })).type
    ).toBe('RateLimitError');
  });

  it('reports non-Error rejections without their content', () => {
    for (const value of [SECRET, 9876, { message: SECRET }, null, undefined]) {
      const props = buildExceptionProps(value, { handled: false, source: 'onunhandledrejection' });
      expectNoSecret(props);
      expect(exceptionOf(props).type).toMatch(/^(NonError|Error)$/);
      expect(exceptionOf(props).stacktrace.frames).toEqual([]);
    }
  });

  it('does not trust a crafted error name', () => {
    const error = new Error('x');
    error.name = SECRET;
    const props = buildExceptionProps(error, { handled: true, source: 'manual' });
    expectNoSecret(props);
    expect(exceptionOf(props).type).toBe('Error');
  });
});

describe('window error events without an Error object', () => {
  const event = (init: ErrorEventInit) => new ErrorEvent('error', init);

  it('drops ResizeObserver loop notifications and resource errors', () => {
    expect(
      errorFromEvent(
        event({ message: 'ResizeObserver loop completed with undelivered notifications.' })
      )
    ).toBeNull();
    expect(errorFromEvent(event({ message: 'ResizeObserver loop limit exceeded' }))).toBeNull();
    expect(errorFromEvent(event({}))).toBeNull();
  });

  it('reports a muted cross-origin script as ScriptError from <external>', () => {
    const error = errorFromEvent(
      event({
        message: 'Script error.',
        filename: 'https://ext.example/inject.js',
        lineno: 1,
        colno: 2,
      })
    );
    const exception = exceptionOf(
      buildExceptionProps(error, { handled: false, source: 'onerror' })
    );
    expect(exception.type).toBe('ScriptError');
    expect(exception.stacktrace.frames).toEqual([
      { platform: 'web:javascript', filename: '<external>', lineno: 1, colno: 2, in_app: false },
    ]);
  });

  it('keeps where a thrown non-Error value came from, never the value', () => {
    const error = errorFromEvent(
      event({
        message: `Uncaught ${SECRET}`,
        error: SECRET,
        filename: `${ORIGIN}/assets/index-a.js`,
        lineno: 3,
        colno: 4,
      })
    );
    const props = buildExceptionProps(error, { handled: false, source: 'onerror' });
    expectNoSecret(props);
    const exception = exceptionOf(props);
    expect(exception.type).toBe('NonError');
    expect(exception.stacktrace.frames).toEqual([
      {
        platform: 'web:javascript',
        filename: '/assets/index-a.js',
        lineno: 3,
        colno: 4,
        in_app: true,
      },
    ]);
  });

  it('passes real Error objects through', () => {
    const error = new TypeError(SECRET);
    expect(errorFromEvent(event({ message: SECRET, error }))).toBe(error);
  });
});

describe('error capture end to end', () => {
  beforeEach(() => {
    envState.selfHost = false;
    for (const fn of Object.values(posthog)) fn.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function load() {
    vi.resetModules();
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const track = await import('./track');
    const capture = await import('./error-capture');
    return { track, capture };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** The event as it would go on the wire: posthog.capture args through before_send. */
  function sent(track: typeof import('./track')) {
    return posthog.capture.mock.calls
      .filter(([name]) => name === '$exception')
      .map(([event, properties]) => track.scrubOutgoing({ event, properties } as never));
  }

  it('sends type and frames but never the message', async () => {
    const { track, capture } = await load();
    track.setAnalyticsSubject({ kind: 'user', id: 'u1', optedOut: false });
    capture.captureAppError(minifiedChromeTypeError(), 'onerror', false);
    await settle();
    const events = sent(track);
    expect(events).toHaveLength(1);
    expectNoSecret(events);
    const exception = exceptionOf(events[0]!.properties as Record<string, unknown>);
    expect(exception.type).toBe('TypeError');
    expect(exception.stacktrace.frames.length).toBe(5);
  });

  it('sends nothing when opted out', async () => {
    const { track, capture } = await load();
    track.setAnalyticsSubject({ kind: 'user', id: 'u1', optedOut: true });
    capture.captureAppError(minifiedChromeTypeError(), 'onerror', false);
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('sends nothing on self-host', async () => {
    envState.selfHost = true;
    const { track, capture } = await load();
    track.setAnalyticsSubject({ kind: 'anonymous' });
    capture.captureAppError(minifiedChromeTypeError(), 'onerror', false);
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe('error codes', () => {
  it('maps known errors to codes', () => {
    expect(toErrorCode(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('cancelled');
    expect(toErrorCode(new TypeError('Failed to fetch'))).toBe('network');
    expect(toErrorCode(Object.assign(new Error('x'), { status: 429 }))).toBe('rate_limited');
    expect(
      toErrorCode(
        Object.assign(new Error('x'), { name: 'EnableBankingError', status: 401 }),
        'bank'
      )
    ).toBe('consent_expired');
    expect(toErrorCode(new Error(SECRET))).toBe('unknown');
  });

  it('maps sync messages to codes', () => {
    expect(syncErrorCode('This device needs an app update to apply newer changes.')).toBe(
      'version_mismatch'
    );
    expect(syncErrorCode(SECRET)).toBe('unknown');
  });
});
