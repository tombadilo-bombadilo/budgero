/**
 * Whether imports and bank sync on this device keep the source's times of
 * day: only when the user shows transaction times (Settings → Appearance).
 * Decided once, where the rows are captured; the resulting ops carry a time
 * or not, and replays never re-decide. Without times the ops keep their old
 * format, so devices on builds without times keep syncing.
 */
export function capturesTransactionTimes(services: unknown): boolean {
  try {
    const userMeta = (services as { userMeta?: { getShowTransactionTime?: () => boolean } })
      ?.userMeta;
    return userMeta?.getShowTransactionTime?.() === true;
  } catch {
    return false;
  }
}
