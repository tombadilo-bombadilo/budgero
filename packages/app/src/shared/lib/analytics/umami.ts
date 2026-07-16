/**
 * Cookieless funnel event → self-hosted Umami (stats.budgero.app).
 *
 * Separate from the PostHog facade on purpose: PostHog is consent-gated
 * (opt-in), while this sends a single anonymous, name-only event with NO
 * device storage, NO user id, and NO properties — the same no-consent
 * rationale as the marketing site's Umami layer. Umami sessions visitors by
 * (website, ip, user-agent, rotating salt), so a trial fired minutes after
 * the landing-page visit joins that visit's session and inherits its
 * UTM/referrer attribution.
 *
 * Self-host: the `import.meta.env.VITE_SELF_HOSTABLE` comparison below is
 * statically replaced at build time (selfhost.Dockerfile builds with
 * VITE_SELF_HOSTABLE=true), so the whole body — endpoint and website id
 * included — is dead-code-eliminated from self-hostable bundles. The
 * IS_SELF_HOSTABLE_BUILD check additionally covers flavors that flag
 * self-host at runtime (`window.budgero.selfHostable`).
 */

import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

const UMAMI_ENDPOINT = 'https://stats.budgero.app/api/send';
const UMAMI_WEBSITE_ID = '76a1a09b-2dbc-4291-9c0b-d3f4e9eb2caa';

/** Fire-and-forget `Trial Started` to Umami. Never throws, never blocks. */
export function sendTrialStartedToUmami(): void {
  if (import.meta.env.VITE_SELF_HOSTABLE === 'true') return;
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (typeof window === 'undefined') return;
  // Production only — keeps localhost/preview traffic out of the stats.
  if (!window.location.hostname.endsWith('budgero.app')) return;

  try {
    void fetch(UMAMI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: UMAMI_WEBSITE_ID,
          hostname: window.location.hostname,
          url: '/trial-started',
          name: 'Trial Started',
          language: navigator.language,
          screen: `${window.screen.width}x${window.screen.height}`,
        },
      }),
    }).catch(() => {
      /* analytics must never surface errors */
    });
  } catch {
    /* fetch unavailable — ignore */
  }
}
