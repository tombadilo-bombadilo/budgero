import { describe, expect, it } from 'vitest';
import { buildExceptionProps, parseStackFrames } from './error-capture';
import { syncErrorCode, toErrorCode } from './error-codes';

const SECRET = 'Payee "Dr. Jane Smith" amount 1234.56 for account 9876';

function errorWithStack(): Error {
  const error = new TypeError(SECRET);
  error.stack = [
    `TypeError: ${SECRET}`,
    `    at renderPayee (${window.location.origin}/assets/index-abc123.js?v=1#frag:10:20)`,
    '    at chrome-extension://abcdef/content.js:3:4',
    `    at ${window.location.origin}/assets/vendor-9f.js:100:7`,
  ].join('\n');
  return error;
}

describe('error capture scrubbing', () => {
  it('never includes the message text, function names or full URLs', () => {
    const props = buildExceptionProps(errorWithStack(), { handled: false, source: 'onerror' });
    const json = JSON.stringify(props);
    expect(json).not.toContain('Jane');
    expect(json).not.toContain('1234');
    expect(json).not.toContain('9876');
    expect(json).not.toContain('renderPayee');
    expect(json).not.toContain('?v=1');
    expect(json).not.toContain('chrome-extension');
    const [exception] = props.$exception_list as {
      type: string;
      value: string;
      stacktrace: { frames: unknown[] };
    }[];
    expect(exception.type).toBe('TypeError');
    expect(exception.value).toBe('unknown');
    expect(props.error_code).toBe('unknown');
  });

  it('keeps stack frames as file:line:col only, crashing frame last', () => {
    const frames = parseStackFrames(errorWithStack().stack);
    expect(frames).toEqual([
      {
        platform: 'web:javascript',
        filename: '/assets/vendor-9f.js',
        lineno: 100,
        colno: 7,
        in_app: true,
      },
      { platform: 'web:javascript', filename: '<external>', lineno: 3, colno: 4, in_app: false },
      {
        platform: 'web:javascript',
        filename: '/assets/index-abc123.js',
        lineno: 10,
        colno: 20,
        in_app: true,
      },
    ]);
    for (const frame of frames) expect(Object.keys(frame)).not.toContain('function');
  });

  it('reports non-Error rejections without their content', () => {
    const props = buildExceptionProps(SECRET, { handled: false, source: 'onunhandledrejection' });
    expect(JSON.stringify(props)).not.toContain('Jane');
    expect((props.$exception_list as { type: string }[])[0].type).toBe('NonError');
  });

  it('does not trust a crafted error name', () => {
    const error = new Error('x');
    error.name = SECRET;
    const props = buildExceptionProps(error, { handled: true, source: 'manual' });
    expect(JSON.stringify(props)).not.toContain('Jane');
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
