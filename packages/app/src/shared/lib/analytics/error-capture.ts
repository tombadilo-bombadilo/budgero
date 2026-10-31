/**
 * Scrubbed error reports (PostHog error tracking, `$exception`).
 *
 * What leaves the device: the error type/name, our error_code, the normalized
 * route (area), the component that caught it, stack frames (same-origin path,
 * line, column, minified function name, PostHog chunk id), the request id of
 * a failed API call, and breadcrumbs made of our own route/component names.
 * Never the message text, locals, arguments, user content or full URLs.
 * Frames from other origins become `<external>`.
 *
 * Capture paths (all end in captureAppError): window error +
 * unhandledrejection and failed chunk loads (installErrorCapture), React
 * error boundaries (AppErrorBoundary), TanStack query/mutation caches
 * (App.tsx), runtime warn/error logs with the original error object
 * (runtime-error-bridge.ts), app console.error/console.warn
 * (installConsoleCapture), error toasts (toastError), and space activations
 * that failed or fell back (app-runtime.ts).
 *
 * Every report also carries: the cause chain (types + frames of each wrapped
 * error), the app state at that moment as fixed values (setErrorContext
 * providers: runtime/sync state, queue size, storage type and range), and the
 * per-visit client session id the server logs with every request.
 *
 * The event follows PostHog's `$exception_list` format so error tracking can
 * group issues (type + in-app frames) and resolve frames with the source maps
 * uploaded at release time (chunk_id + $release_id, injected by posthog-cli).
 */
import { getClientSessionId } from '@budgero/runtime';
import { toErrorCode, type ErrorArea } from './error-codes';
import type { ErrorCode } from './events';
import { captureScrubbedException, normalizePagePath } from './track';

const MAX_FRAMES = 30;
const MAX_PER_MINUTE = 10;
/** One report per (type, code, component, event) per minute: retry loops count once. */
const REPEAT_WINDOW_MS = 60_000;
const MAX_BREADCRUMBS = 20;
const SAFE_NAME = /^[A-Za-z_$][\w$.]{0,63}$/;
const SAFE_ID = /^[\w.:-]{1,128}$/;
/** Our own identifiers only: route paths, component names, log literals turned into slugs. */
const SAFE_CRUMB = /^[\w/:.-]{1,80}$/;

export type CaptureSource =
  | 'onerror'
  | 'onunhandledrejection'
  | 'react'
  | 'query'
  | 'mutation'
  | 'runtime'
  | 'console'
  | 'toast'
  | 'chunk'
  | 'activation'
  | 'manual';

// ---------------------------------------------------------------------------
// App state at the moment of an error. Providers return fixed values only
// (enums, booleans, buckets); anything else is dropped.
// ---------------------------------------------------------------------------

type ContextValue = string | boolean | number;
type ContextProvider = () => Record<string, ContextValue | null | undefined>;

const contextProviders = new Map<string, ContextProvider>();
const SAFE_CONTEXT_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const SAFE_CONTEXT_VALUE = /^[\w.:<>+-]{0,40}$/;

/** Register (or replace) a named provider of state for error reports. */
export function setErrorContext(name: string, provider: ContextProvider | null): void {
  if (provider) contextProviders.set(name, provider);
  else contextProviders.delete(name);
}

function collectContext(): Record<string, ContextValue> {
  const out: Record<string, ContextValue> = {};
  for (const provider of contextProviders.values()) {
    let values: Record<string, ContextValue | null | undefined>;
    try {
      values = provider();
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      if (!SAFE_CONTEXT_KEY.test(key) || value == null) continue;
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        out[`ctx_${key}`] = value;
      } else if (typeof value === 'string' && SAFE_CONTEXT_VALUE.test(value)) {
        out[`ctx_${key}`] = value;
      }
    }
  }
  return out;
}

/** Browser storage facts, refreshed in the background (estimate() is async). */
let storageContext: Record<string, ContextValue> = {};

function mbBucket(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return 'unknown';
  const mb = bytes / 1_000_000;
  if (mb < 10) return '<10MB';
  if (mb < 100) return '10-100MB';
  if (mb < 1000) return '100MB-1GB';
  if (mb < 10_000) return '1-10GB';
  return '10GB+';
}

export async function refreshStorageContext(): Promise<void> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    const estimate = await storage?.estimate?.();
    const persisted = await storage?.persisted?.();
    storageContext = {
      opfs: typeof storage?.getDirectory === 'function',
      storage_persisted: persisted === undefined ? 'unknown' : persisted ? 'yes' : 'no',
      storage_usage: mbBucket(estimate?.usage),
      storage_quota: mbBucket(estimate?.quota),
      storage_used_pct:
        estimate?.usage !== undefined && estimate?.quota
          ? `${Math.min(100, Math.round((estimate.usage / estimate.quota) * 10) * 10)}`
          : 'unknown',
    };
  } catch {
    /* keep the last known values */
  }
}

const loadedAt = Date.now();
function uptimeBucket(): string {
  const s = (Date.now() - loadedAt) / 1000;
  if (s < 10) return '<10s';
  if (s < 60) return '10-60s';
  if (s < 600) return '1-10m';
  if (s < 3600) return '10-60m';
  return '1h+';
}

setErrorContext('storage', () => storageContext);
setErrorContext('page', () => ({
  visible: typeof document === 'undefined' ? null : document.visibilityState === 'visible',
  uptime: uptimeBucket(),
  isolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
}));

export interface CaptureOptions {
  /** How the error reached us (PostHog mechanism.type). */
  source?: CaptureSource;
  handled?: boolean;
  /** The error object was built by us (no original Error). */
  synthetic?: boolean;
  /** Error boundary name, mutation/query label or runtime component. */
  component?: string;
  /** Runtime log literal (slugified) that produced the report. */
  event?: string;
  /** Mapping area for toErrorCode; an explicit `code` wins. */
  area?: ErrorArea;
  code?: ErrorCode;
}

export interface ScrubbedFrame {
  platform: 'web:javascript';
  filename: string;
  lineno: number;
  colno: number;
  function: string;
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
      // PostHog's frame parser needs `function` on every frame: events with a
      // nameless frame were never turned into issues (9 of 10 on 2026-10-31).
      // '?' is what posthog-js itself sends for anonymous frames.
      function: fn ?? '?',
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

/** Component / event names are our own identifiers; anything else is dropped. */
function safeLabel(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const label = raw.length > 80 ? raw.slice(0, 80) : raw;
  return SAFE_CRUMB.test(label) ? label : undefined;
}

/** A log literal from our source ("Blob upload failed; retry armed") as a stable slug. */
export function slugifyEvent(literal: string): string {
  return literal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function requestIdOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const id = (error as { requestId?: unknown }).requestId;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : undefined;
}

// ---------------------------------------------------------------------------
// Breadcrumbs: the sequence of screens and internal events before an error.
// Names are our own route paths, component names and log literals; no values.
// ---------------------------------------------------------------------------

export type BreadcrumbKind = 'route' | 'runtime' | 'query' | 'mutation' | 'ui';

interface Breadcrumb {
  k: BreadcrumbKind;
  n: string;
  t: number;
}

let crumbs: Breadcrumb[] = [];

export function addBreadcrumb(kind: BreadcrumbKind, name: string): void {
  const safe = safeLabel(kind === 'route' ? normalizePagePath(name) : name);
  if (!safe) return;
  const last = crumbs[crumbs.length - 1];
  if (last && last.k === kind && last.n === safe) {
    last.t = Date.now();
    return;
  }
  crumbs.push({ k: kind, n: safe, t: Date.now() });
  if (crumbs.length > MAX_BREADCRUMBS) crumbs.shift();
}

/** Breadcrumbs as {k, n, ago_s}, oldest first. */
function breadcrumbsForReport(now: number): Record<string, unknown>[] {
  return crumbs.map((c) => ({
    k: c.k,
    n: c.n,
    ago_s: Math.max(0, Math.round((now - c.t) / 1000)),
  }));
}

const MAX_CAUSES = 4;

/**
 * The error and its `cause` chain, outermost first. Runtime code wraps
 * failures ("Decryption failed", "Failed to restore workspace snapshot") and
 * keeps the original as `cause`: the original is the one that says what
 * actually broke (QuotaExceededError, NotReadableError, a SQLite error, a
 * network TypeError), so it is reported too — type and frames, never text.
 */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [error];
  let current = error;
  while (chain.length <= MAX_CAUSES && current && typeof current === 'object') {
    const next = (current as { cause?: unknown }).cause;
    if (!next || typeof next !== 'object' || chain.includes(next)) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

/** Build the `$exception` props for an error. Exported for tests. */
export function buildExceptionProps(
  error: unknown,
  options: Omit<CaptureOptions, 'source'> & { handled: boolean; source: string }
): Record<string, unknown> {
  const type = errorType(error);
  const chain = causeChain(error);
  // The first specific code along the chain: a wrapper is usually 'unknown',
  // the cause it wraps is not.
  const code =
    options.code ??
    chain.map((e) => toErrorCode(e, options.area ?? 'app')).find((c) => c !== 'unknown') ??
    'unknown';
  const stack = stackWithoutMessage(error);
  const area =
    typeof window !== 'undefined' ? normalizePagePath(window.location.pathname) : 'unknown';
  const component = safeLabel(options.component);
  const event = safeLabel(options.event);
  const requestId = requestIdOf(error);
  const release = releaseId();
  const now = Date.now();
  return {
    $exception_list: [
      {
        type,
        // Readable, text-free issue title: PostHog shows `value` in the issue
        // list and uses type + value for grouping when no frame is in-app.
        value: [type, code, component ?? area].join(' · '),
        mechanism: {
          handled: options.handled,
          synthetic: options.synthetic ?? false,
          type: options.source,
        },
        stacktrace: { type: 'raw', frames: parseStackFrames(stack) },
      },
      // Causes: PostHog lists them under the issue, outermost first.
      ...chain.slice(1).map((cause) => ({
        type: errorType(cause),
        value: [errorType(cause), toErrorCode(cause, options.area ?? 'app')].join(' · '),
        mechanism: { handled: options.handled, synthetic: false, type: 'cause' },
        stacktrace: { type: 'raw', frames: parseStackFrames(stackWithoutMessage(cause)) },
      })),
    ],
    ...(chain.length > 1 ? { root_cause_type: errorType(chain[chain.length - 1]) } : {}),
    $exception_level: 'error',
    ...(release ? { $release_id: release } : {}),
    error_code: code,
    area,
    ...(component ? { component } : {}),
    ...(event ? { runtime_event: event } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    client_session: getClientSessionId(),
    online: typeof navigator === 'undefined' ? 'unknown' : navigator.onLine ? 'yes' : 'no',
    breadcrumbs: breadcrumbsForReport(now),
    ...collectContext(),
  };
}

let windowStart = 0;
let windowCount = 0;
const seen = new WeakSet();
const recent = new Map<string, number>();

function isRepeat(props: Record<string, unknown>, now: number): boolean {
  const key = [
    (props.$exception_list as { type: string }[])[0].type,
    props.error_code,
    props.component ?? '',
    props.runtime_event ?? '',
  ].join('|');
  const last = recent.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return true;
  if (recent.size > 200) recent.clear();
  recent.set(key, now);
  return false;
}

/** Report one error (deduplicated, rate limited). Never throws. */
export function captureAppError(error: unknown, options: CaptureOptions = {}): void {
  try {
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
    const props = buildExceptionProps(error, {
      ...options,
      handled: options.handled ?? true,
      source: options.source ?? 'manual',
    });
    if (isRepeat(props, now)) return;
    captureScrubbedException(props);
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

/** Window error + unhandledrejection + failed chunk loads. Idempotent. */
export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  void refreshStorageContext();
  window.setInterval(() => void refreshStorageContext(), 10 * 60_000);
  // Vite's lazy-chunk loader: a chunk that 404s after a deploy, or a network
  // failure mid-navigation. The page usually breaks without any other error.
  window.addEventListener('vite:preloadError', (event: Event) => {
    const { payload } = event as Event & { payload?: unknown };
    captureAppError(payload instanceof Error ? payload : { name: 'ChunkLoadError' }, {
      source: 'chunk',
      handled: false,
      synthetic: !(payload instanceof Error),
      code: 'chunk_load_failed',
    });
  });
  window.addEventListener('error', (event: ErrorEvent) => {
    const error = errorFromEvent(event);
    if (error == null) return;
    captureAppError(error, { source: 'onerror', handled: false, synthetic: event.error == null });
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    captureAppError(event.reason, { source: 'onunhandledrejection', handled: false });
  });
}

// ---------------------------------------------------------------------------
// console.error / console.warn. Production keeps these calls (vite.config.ts
// strips only log/info/debug) so every place that already logs a failure
// reports it: with the Error object when one is passed, otherwise as a
// synthetic ConsoleError whose frames point at the exact console call site.
// Arguments are never sent.
// ---------------------------------------------------------------------------

let consoleInstalled = false;
let inConsoleCapture = false;

function firstError(args: unknown[]): unknown {
  return args.find(
    (a) => a instanceof Error || (a && typeof a === 'object' && 'stack' in a && 'name' in a)
  );
}

/** A synthetic error whose stack starts at the console call site. */
function consoleCallSite(level: 'error' | 'warn'): { name: string; stack: string } {
  const lines = (new Error().stack ?? '').split('\n');
  // V8: [0] "Error", [1] consoleCallSite, [2] the console wrapper, [3+] the caller.
  // SpiderMonkey/JSC have no header line: [0] consoleCallSite, [1] wrapper.
  const skip = /^\s*at /.test(lines[1] ?? '') ? 3 : 2;
  return {
    name: level === 'error' ? 'ConsoleError' : 'ConsoleWarning',
    stack: lines.slice(skip).join('\n'),
  };
}

export function installConsoleCapture(): void {
  if (consoleInstalled || typeof console === 'undefined') return;
  consoleInstalled = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      if (inConsoleCapture) return;
      inConsoleCapture = true;
      try {
        const error = firstError(args);
        const site = consoleCallSite(level);
        // A call from another origin (extension, injected script) is not ours.
        const caller = parseStackFrames(site.stack).at(-1);
        if (!error && caller && !caller.in_app) return;
        captureAppError(error ?? site, {
          source: 'console',
          handled: true,
          synthetic: !error,
          component: `console.${level}`,
        });
      } catch {
        /* never let reporting break logging */
      } finally {
        inConsoleCapture = false;
      }
    };
  }
}

/** Test-only: reset module state. */
export function __resetErrorCaptureForTests(): void {
  windowStart = 0;
  windowCount = 0;
  recent.clear();
  crumbs = [];
}
