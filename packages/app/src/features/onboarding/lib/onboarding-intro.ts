const INTRO_STORAGE_PREFIX = 'budgero:onboarding:intro:v1';

function getIntroStorageKey(userId?: string | null) {
  // Fallback key lets us remember acknowledgement when profile isn't available (offline)
  if (!userId) return `${INTRO_STORAGE_PREFIX}:anon`;
  return `${INTRO_STORAGE_PREFIX}:${userId}`;
}

export function readIntroAcknowledged(userId?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  const primaryKey = getIntroStorageKey(userId);
  const fallbackKey = getIntroStorageKey(null);
  try {
    const keys = [primaryKey, fallbackKey];
    return keys.some((key) => window.localStorage.getItem(key) === 'true');
  } catch {
    return false;
  }
}

export function writeIntroAcknowledged(userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getIntroStorageKey(userId), 'true');
  } catch {
    /* no-op: intentionally ignored */
  }
}
