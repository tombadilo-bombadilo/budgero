/**
 * A random id for this page load, kept in memory only (never stored). The app
 * sends it with every API request (X-Client-Session) and the sync socket
 * (client_session query parameter), and attaches it to error reports, so a
 * report can be matched to the exact server log lines of the same visit.
 */
let sessionId: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getClientSessionId(): string {
  sessionId ??= randomId();
  return sessionId;
}
