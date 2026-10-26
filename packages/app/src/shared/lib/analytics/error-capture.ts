/**
 * Scrubbed error reports (PostHog error tracking, `$exception`).
 *
 * What leaves the device: the error type/name, our error_code, the normalized
 * route (area) and stack frames (same-origin path, line, column, minified
 * function name, PostHog chunk id). Never the message text, locals, arguments,
 * breadcrumbs or full URLs. Frames from other origins become `<external>`.
 *
 * The event follows PostHog's `$exception_list` format so error tracking can
 * group issues (type + in-app frames) and resolve frames with the source maps
 * uploaded at release time (chunk_id + $release_id, injected by posthog-cli).
 */
import { toErrorCode } from './error-codes';
import { captureScrubbedException, normalizePagePath } from './track';

const MAX_FRAMES = 30;
const MAX_PER_MINUTE = 10;
const SAFE_NAME = /^[A-Za-z_$][\w$.]{0,63}$/;
const SAFE_ID = /^[\w.:-]{1,128}$/;

export interface ScrubbedFrame {
  platform: 'web:javascript';
  filename: string;
  lineno: number;
  colno: number;
  function?: string;
  in_app: boolean;
  chunk_id?: string;
}

interface RawFrame {
  url: string;
  lineno: number;
  colno: number;
  fn: string;
}

// V8: "    at fn (url:1:2)", "    at url:1:2", "    at async new X (url:1:2)"
const V8_FRAME = /^\s*at (?:(.+?) \()?([^\s()]+?):(\d+):(\d+)\)?\s*$/;
// SpiderMonkey / JSC: "fn@url:1:2", "@url:1:2", "global code@url:1:2"
const GECKO_FRAME = /^\s*(.*?)@([^\s@]+?):(\d+):(\d+)\s*$/;

function parseRawFrames(stack: string): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const line of stack.split('\n')) {
    const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!match) continue;
    frames.push({
      fn: match[1] ?? '',
      url: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** A code identifier (minified or not); anything that could carry data is dropped. */
function scrubFunction(raw: string): string | undefined {
  const name = raw
    .replace(/^(?:async |new )+/, '')
    .replace(/ \[as [^\]]*\]$/, '')
    .replace(/[/<*]+$/, '');
  return SAFE_NAME.test(name) ? name : undefined;
}

/** Keep only a same-origin asset path (no query/hash); anything else is opaque. */
function scrubFilename(raw: string): { filename: string; inApp: boolean } {
  // Only a real URL or an absolute path can be ours ('<anonymous>', 'eval' are not).
  if (!/^(?:[a-z][\w+.-]*:|\/)/i.test(raw)) return { filename: '<external>', inApp: false };
  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
    const sameOrigin = typeof window !== 'undefined' && url.origin === window.location.origin;
    if (sameOrigin && /^https?:$/.test(url.protocol)) {
      return { filename: url.pathname, inApp: true };
    }
  } catch {
    /* fall through */
  }
  return { filename: '<external>', inApp: false };
}

/**
 * posthog-cli `sourcemap inject` adds `_posthogChunkIds[new Error().stack] =
 * id` to each chunk. Map the chunk's script URL to its id, the way posthog-js
 * does, so PostHog resolves the frame against the uploaded source map.
 */
function chunkIdsByUrl(): Map<string, string> {
  const byUrl = new Map<string, string>();
  const ids = (globalThis as { _posthogChunkIds?: unknown })._posthogChunkIds;
  if (!ids || typeof ids !== 'object') return byUrl;
  for (const [stack, id] of Object.entries(ids as Record<string, unknown>)) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) continue;
    const top = parseRawFrames(stack)[0];
    if (top) byUrl.set(top.url, id);
  }
  return byUrl;
}

function releaseId(): string | undefined {
  const id = (globalThis as { _posthogReleaseId?: unknown })._posthogReleaseId;
  return typeof id === 'string' && SAFE_ID.test(id) ? id : undefined;
}

/** Parse V8 / SpiderMonkey / JSC stacks into scrubbed frames, crashing frame last. */
export function parseStackFrames(stack: string | undefined): ScrubbedFrame[] {
  if (!stack) return [];
  const chunkIds = chunkIdsByUrl();
  const frames = parseRawFrames(stack).map((raw): ScrubbedFrame => {
    const { filename, inApp } = scrubFilename(raw.url);
    const fn = inApp ? scrubFunction(raw.fn) : undefined;
    const chunkId = inApp ? chunkIds.get(raw.url) : undefined;
    return {
      platform: 'web:javascript',
      filename,
      lineno: raw.lineno,
      colno: raw.colno,
      ...(fn ? { function: fn } : {}),
      in_app: inApp,
      ...(chunkId ? { chunk_id: chunkId } : {}),
    };
  });
  // PostHog (like Sentry) expects the crashing frame last.
  return frames.reverse();
}

/**
 * The error's type: its `name` (TypeError, DOMException names like
 * NotFoundError, our own classes, which all set `name`). A bare 'Error' falls
 * back to the constructor name only when it reads like an error class: in the
 * minified bundle other constructor names are mangled ('zb') and group nothing.
 */
function errorType(error: unknown): string {
  if (error instanceof Error || (error && typeof error === 'object' && 'name' in error)) {
    const name = String((error as { name?: unknown }).name ?? '');
    const ctorName = (error as { constructor?: { name?: string } }).constructor?.name ?? '';
    const ctor = /^[A-Z][\w$]*(?:Error|Exception)$/.test(ctorName) ? ctorName : '';
    const pick = name && name !== 'Error' ? name : ctor || name;
    return SAFE_NAME.test(pick) ? pick : Error.name;
  }
  return 'NonError';
}

/** The stack minus V8's "Name: message" header, so message lines are never parsed as frames. */
function stackWithoutMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { stack, message } = error as { stack?: unknown; message?: unknown };
  if (typeof stack !== 'string') return undefined;
  if (typeof message === 'string' && message) {
    const at = stack.indexOf(message);
    if (at !== -1) return stack.slice(at + message.length);
  }
  return stack;
}

/** Build the `$exception` props for an error. Exported for tests. */
export function buildExceptionProps(
  error: unknown,
  options: { handled: boolean; source: string; synthetic?: boolean }
): Record<string, unknown> {
  const type = errorType(error);
  const code = toErrorCode(error, 'app');
  const stack = stackWithoutMessage(error);
  const area =
    typeof window !== 'undefined' ? normalizePagePath(window.location.pathname) : 'unknown';
  const release = releaseId();
  return {
    $exception_list: [
      {
        type,
        // Stable, text-free value: PostHog shows it as the issue description and
        // falls back to type + value for grouping when no frame is in-app.
        value: code === 'unknown' ? type : code,
        mechanism: {
          handled: options.handled,
          synthetic: options.synthetic ?? false,
          type: options.source,
        },
        stacktrace: { type: 'raw', frames: parseStackFrames(stack) },
      },
    ],
    $exception_level: 'error',
    ...(release ? { $release_id: release } : {}),
    error_code: code,
    area,
  };
}

let windowStart = 0;
let windowCount = 0;
const seen = new WeakSet();

/** Report one error (deduplicated, rate limited). */
export function captureAppError(
  error: unknown,
  source = 'manual',
  handled = true,
  synthetic = false
): void {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return;
    seen.add(error);
  }
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > MAX_PER_MINUTE) return;
  try {
    captureScrubbedException(buildExceptionProps(error, { handled, source, synthetic }));
  } catch {
    /* never let reporting throw */
  }
}

/**
 * A window `error` event without an Error object. The message is only matched
 * locally, never sent.
 *  - ResizeObserver loop notifications are benign browser warnings (most of
 *    what this handler saw in production): dropped.
 *  - "Script error." is a muted cross-origin script (extensions, injected
 *    scripts): reported as `ScriptError` from `<external>`.
 *  - Anything else (including a thrown non-Error value) keeps the event's own
 *    file:line:col as its one frame.
 * Returns null when the event should not be reported. Exported for tests.
 */
export function errorFromEvent(event: ErrorEvent): unknown {
  if (event.error && typeof event.error === 'object') return event.error;
  const message = typeof event.message === 'string' ? event.message : '';
  if (!message && event.error == null) return null; // resource load errors
  if (/^ResizeObserver loop /i.test(message)) return null;
  const muted = /^(?:Uncaught )?Script error\.?$/i.test(message) || !event.filename;
  // `throw 'text'` / `throw 42`: keep where it was thrown, never the value.
  const name = event.error != null ? 'NonError' : muted ? 'ScriptError' : 'Error';
  const location = event.filename
    ? `\n    at ${event.filename}:${event.lineno || 0}:${event.colno || 0}`
    : '';
  return { name, stack: `${name}${location}` };
}

let installed = false;

/** Window error + unhandledrejection handlers. Idempotent. */
export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event: ErrorEvent) => {
    const error = errorFromEvent(event);
    if (error == null) return;
    captureAppError(error, 'onerror', false, event.error == null);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    captureAppError(event.reason, 'onunhandledrejection', false);
  });
}
