/**
 * Trial-rewards behavior signals — fire-and-forget POSTs to the SaaS server.
 *
 * Privacy note: signals carry only an event-kind name (e.g. "reconciliation",
 * "daily_logging"). No financial data — no amounts, payees, account names,
 * category names. The strict allowlist in SignalKind is mirrored on the
 * server; anything else is rejected at the HTTP boundary.
 *
 * Gating:
 *  - Self-host builds NEVER fire (no SaaS server to talk to).
 *  - These are FUNCTIONAL signals: they compute a discount the user is
 *    actively earning, carry no PII, and are NOT advertising/analytics. So
 *    they are intentionally NOT gated by the analytics consent (which is
 *    opt-in and off by default) — declining analytics must not disable a
 *    reward someone is earning. The only honored opt-out is the explicit
 *    Settings → Privacy → "Trial Reward Tracking" toggle, which the SERVER
 *    enforces via the user's `is_trial_signals_disabled` flag in
 *    RecordSignal (a client can't bypass it).
 *
 * High-volume signals (daily_logging) are debounced to once per UTC day per
 * device via localStorage. Cross-device dedup is handled server-side by the
 * (user_id, kind, day) primary key on trial_signals.
 */

import { apiClient } from '@shared/api/api-client';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { formatDateUtcISO } from '@shared/lib/date-utils';

const DEBOUNCE_KEY_PREFIX = 'budgero:trial_signal:';

export type TrialSignalKind =
  | 'daily_logging'
  | 'reconciliation'
  | 'goal_funding'
  | 'assignment_in_month'
  | 'transaction_in_month';

function utcDayString(): string {
  return formatDateUtcISO(new Date());
}

function shouldDebounce(kind: TrialSignalKind): boolean {
  // Only daily_logging is debounced 1/day per device. The rest fire on every
  // user action — server-side aggregation handles their dedup.
  return kind === 'daily_logging';
}

function debounceKey(kind: TrialSignalKind): string {
  return `${DEBOUNCE_KEY_PREFIX}${kind}:${utcDayString()}`;
}

function alreadyFiredToday(kind: TrialSignalKind): boolean {
  try {
    return localStorage.getItem(debounceKey(kind)) === '1';
  } catch {
    return false;
  }
}

function markFiredToday(kind: TrialSignalKind): void {
  try {
    localStorage.setItem(debounceKey(kind), '1');
  } catch {
    /* no-op — quota errors etc. */
  }
}

/**
 * Reports a behavior signal to the server. Fire-and-forget — failures are
 * swallowed (network blips, opted-out users, self-host builds, server 4xx).
 * Callers should not rely on side effects from this function.
 *
 * For the *_in_month kinds, pass the YYYY-MM month being tracked. The server
 * uses (kind, month) as the dedup key, so the same month from multiple
 * devices collapses to one row.
 */
export function reportTrialSignal(kind: TrialSignalKind, month?: string): void {
  if (IS_SELF_HOSTABLE_BUILD) return;

  if (shouldDebounce(kind)) {
    if (alreadyFiredToday(kind)) return;
    markFiredToday(kind);
  }

  const body: { kind: TrialSignalKind; month?: string } = { kind };
  if (month) body.month = month;

  // Fire-and-forget. We don't await; we don't surface errors to the caller.
  apiClient.post('/trial/signal', body).catch(() => {
    // Network or auth failure — drop silently. Server-side tier evaluation
    // is best-effort by design; one missed signal is acceptable.
    if (shouldDebounce(kind)) {
      // Roll back the debounce mark so a later attempt has a chance.
      try {
        localStorage.removeItem(debounceKey(kind));
      } catch {
        /* no-op */
      }
    }
  });
}
