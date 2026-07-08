export function triggerHapticFeedback(duration = 10): void {
  if (typeof window === 'undefined') return;
  if (!('navigator' in window) || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(duration);
  } catch {
    // ignore unsupported environments
  }
}
