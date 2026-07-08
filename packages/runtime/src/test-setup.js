import { webcrypto } from 'node:crypto';

function hasUsableWebCrypto(value) {
  if (!value || typeof value !== 'object') return false;
  return (
    typeof value.getRandomValues === 'function' &&
    !!value.subtle &&
    typeof value.subtle.importKey === 'function'
  );
}

if (!hasUsableWebCrypto(globalThis.crypto)) {
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
      writable: true,
    });
  } catch {
    globalThis.crypto = webcrypto;
  }
}
