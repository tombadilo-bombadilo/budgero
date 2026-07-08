/**
 * Internal base64 encode/decode helpers for binary crypto payloads.
 *
 * The binary string is built byte-by-byte; String.fromCharCode.apply(null, hugeArray)
 * overflows the call stack on large payloads (e.g. an attached image), throwing
 * "Maximum call stack size exceeded".
 */

export function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 1) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode bytes as URL-safe base64 without padding. */
export function toBase64Url(data: Uint8Array): string {
  return toBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode URL-safe base64 (padded or unpadded). */
export function fromBase64Url(value: string): Uint8Array {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  return fromBase64(normalized);
}
