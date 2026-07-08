import { afterAll, beforeAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

// Polyfill globalThis.crypto for Node.js test environment
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

let restoreFns: (() => void)[] = [];

// Treat logs whose stack contains the source directory as service/app logs
function isServiceLog(): boolean {
  const stack = new Error().stack || '';
  return stack.includes('/src/') || stack.includes('\\src\\');
}

beforeAll(() => {
  const wrap = <K extends keyof Console>(method: K) => {
    const original = console[method] as (...args: unknown[]) => void;
    // Expose originals for opt-in logging inside tests
    const consoleWithOrig = console as Console & {
      __origLog?: typeof console.log;
      __origInfo?: typeof console.info;
      __origWarn?: typeof console.warn;
    };
    consoleWithOrig.__origLog = consoleWithOrig.__origLog || console.log.bind(console);
    consoleWithOrig.__origInfo = consoleWithOrig.__origInfo || console.info.bind(console);
    consoleWithOrig.__origWarn = consoleWithOrig.__origWarn || console.warn.bind(console);
    const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      if (!isServiceLog()) {
        // Allow logs originating from the test file itself
        original.apply(console, args);
      } else {
        // Silence logs coming from app/services during tests
      }
    });
    restoreFns.push(() => spy.mockRestore());
  };

  wrap('log');
  wrap('info');
  wrap('warn');
});

afterAll(() => {
  for (const restore of restoreFns) restore();
  restoreFns = [];
});
