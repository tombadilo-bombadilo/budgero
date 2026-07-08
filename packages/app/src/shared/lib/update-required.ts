/**
 * App-update-required signal.
 *
 * Fired when this build is too old for the data it encounters: a sync payload
 * or space blob in a newer format (runtime FormatTooNewError), a server 426
 * Upgrade Required, or a local database whose schema version exceeds what
 * this build ships (core DatabaseNewerThanAppError). Continuing to write in
 * that state risks corrupting newer-format data, so the UI blocks and offers
 * the service-worker update.
 */

const UPDATE_REQUIRED_EVENT = 'budgero:update-required';

export interface UpdateRequiredDetail {
  reason: string;
}

export function notifyUpdateRequired(reason: string): void {
  window.dispatchEvent(
    new CustomEvent<UpdateRequiredDetail>(UPDATE_REQUIRED_EVENT, { detail: { reason } })
  );
}

export function subscribeUpdateRequired(
  callback: (detail: UpdateRequiredDetail) => void
): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<UpdateRequiredDetail>).detail);
  };
  window.addEventListener(UPDATE_REQUIRED_EVENT, handler);
  return () => window.removeEventListener(UPDATE_REQUIRED_EVENT, handler);
}
