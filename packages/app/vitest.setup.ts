import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

// Polyfill crypto for Node.js/jsdom test environment
// The code accesses crypto.subtle directly, so we need to ensure it's available everywhere
const cryptoPolyfill = webcrypto as Crypto;

// Override crypto on globalThis (it may have a getter-only property in jsdom)
Object.defineProperty(globalThis, 'crypto', {
  value: cryptoPolyfill,
  writable: true,
  configurable: true,
});

// Set on window (jsdom)
Object.defineProperty(window, 'crypto', {
  value: cryptoPolyfill,
  writable: true,
  configurable: true,
});

// Also set the global crypto variable directly for code that uses bare `crypto`
Object.defineProperty(global, 'crypto', {
  value: cryptoPolyfill,
  writable: true,
  configurable: true,
});

// The installed jsdom does not implement Web Storage, so window.localStorage /
// sessionStorage are undefined. Provide a minimal in-memory polyfill.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(window, name, {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, name, {
    value: window[name],
    writable: true,
    configurable: true,
  });
}

// Mock window.matchMedia for jsdom environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {
      /* deprecated: mock */
    },
    removeListener: () => {
      /* deprecated: mock */
    },
    addEventListener: () => {
      /* mock */
    },
    removeEventListener: () => {
      /* mock */
    },
    dispatchEvent: () => false,
  }),
});
