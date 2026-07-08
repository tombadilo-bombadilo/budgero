// Storage helpers for the pending workspace-invite secret captured from
// /join#code=… URLs. Mirrored across sessionStorage (preferred — auto-clears
// on tab close) and localStorage (fallback — survives the Clerk email
// verification new-tab bounce). Lives in /lib so it's a non-component module
// (fast-refresh-friendly).

export const PENDING_SPACE_INVITE_KEY = 'pendingSpaceInviteSecret';

export function readPendingSpaceInvite(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const session = sessionStorage.getItem(PENDING_SPACE_INVITE_KEY);
    if (session && session.trim().length > 0) return session.trim();
  } catch {
    /* no-op */
  }
  try {
    const local = localStorage.getItem(PENDING_SPACE_INVITE_KEY);
    if (local && local.trim().length > 0) return local.trim();
  } catch {
    /* no-op */
  }
  return null;
}

export function writePendingSpaceInvite(value: string) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PENDING_SPACE_INVITE_KEY, value);
  } catch {
    /* no-op */
  }
  try {
    localStorage.setItem(PENDING_SPACE_INVITE_KEY, value);
  } catch {
    /* no-op */
  }
}

export function clearPendingSpaceInvite() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_SPACE_INVITE_KEY);
  } catch {
    /* no-op */
  }
  try {
    localStorage.removeItem(PENDING_SPACE_INVITE_KEY);
  } catch {
    /* no-op */
  }
}
