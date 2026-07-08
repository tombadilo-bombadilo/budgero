/**
 * localStorage-backed versioned-number helpers.
 *
 * Shared by mutation cursors, blob versions, and encryption key versions —
 * every persisted counter uses the same read/write/clear triple.
 */

export function readStoredVersion(key: string): number | undefined;
export function readStoredVersion(key: string, fallback: number): number;
export function readStoredVersion(key: string, fallback?: number): number | undefined {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const version = parseInt(raw, 10);
    return Number.isFinite(version) && version > 0 ? version : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredVersion(key: string, version: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, version.toString());
  } catch {
    /* no-op */
  }
}

export function clearStoredVersion(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}
