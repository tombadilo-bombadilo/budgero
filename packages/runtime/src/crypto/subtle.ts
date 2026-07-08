/**
 * WebCrypto access helpers shared by the crypto modules.
 * Centralizes the secure-context guard and the Safari `webkitSubtle` fallback.
 */

export const WEBCRYPTO_UNAVAILABLE_MESSAGE =
  'WebCryptoUnavailable: Budgero requires a secure context (https:// or http://localhost) so the browser can unlock your data. Please serve Budgero over HTTPS or use a trusted certificate.';

interface CryptoWithWebkitSubtle extends Crypto {
  webkitSubtle?: SubtleCrypto;
}

export function getGlobalCrypto(): CryptoWithWebkitSubtle {
  const cryptoObj = globalThis.crypto as CryptoWithWebkitSubtle | undefined;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error(WEBCRYPTO_UNAVAILABLE_MESSAGE);
  }
  return cryptoObj;
}

export function getSubtleCrypto(): SubtleCrypto {
  const cryptoObj = getGlobalCrypto();
  const subtle = cryptoObj.subtle || cryptoObj.webkitSubtle;
  if (!subtle || typeof subtle.importKey !== 'function') {
    throw new Error(WEBCRYPTO_UNAVAILABLE_MESSAGE);
  }
  return subtle;
}
