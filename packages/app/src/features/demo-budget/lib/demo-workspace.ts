/**
 * The demo workspace from onboarding: how it is recognised, which currency
 * and number format it opens in, and how it is removed.
 */
import type { QueryClient } from '@tanstack/react-query';
import { spaceApi } from '@shared/api/api-client';
import { DEMO_ACCOUNT_METADATA_KEY, getDemoSpaceId, setDemoSpaceId } from '@shared/lib/demo-space';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import { syncBudgetStateFromRuntime } from '@shared/runtime/budget-gate';
import {
  getStoredDefaultSpaceId,
  setStoredDefaultSpaceId,
} from '@shared/runtime/workspace-preferences';
import { BUDGET_SPACES_QUERY_KEY } from '@features/budget-sharing/lib/workspaces/queries';

/** True when an account was created by the demo seed (the synced marker). */
export function isDemoAccount(account: { Metadata?: unknown }): boolean {
  const raw = account.Metadata;
  if (!raw) return false;
  try {
    const metadata = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Boolean(metadata && (metadata as Record<string, unknown>)[DEMO_ACCOUNT_METADATA_KEY]);
  } catch {
    return false;
  }
}

/** Euro-area regions (ISO 3166). */
// prettier-ignore
const EURO_REGIONS = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PT', 'SI', 'SK', 'AD', 'MC', 'SM', 'VA', 'ME', 'XK',
]);
/**
 * The demo's amounts are sized for a dollar-like currency, so only currencies
 * of that size are picked; anything else gets the US dollar.
 */
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  CH: 'CHF',
  LI: 'CHF',
};
/** Languages spoken mostly in the euro area, for a tag without a region. */
// prettier-ignore
const EURO_LANGUAGES = new Set([
  'de', 'fr', 'es', 'nl', 'it', 'pt', 'fi', 'el', 'sk', 'sl', 'et', 'lv', 'lt', 'ga', 'mt', 'ca',
  'eu', 'gl', 'lb', 'hr',
]);
/** Languages that write 1.096,56 (number-format.ts keys). */
// prettier-ignore
const COMMA_DECIMAL_LANGUAGES = new Set([
  'de', 'nl', 'es', 'it', 'pt', 'da', 'el', 'id', 'tr', 'ca', 'hr', 'sl', 'ro',
]);
// prettier-ignore
const SPACE_GROUPING_LANGUAGES = new Set([
  'fr', 'fi', 'sv', 'nb', 'no', 'cs', 'sk', 'pl', 'et', 'lv', 'lt', 'uk', 'ru', 'hu',
]);

export interface DemoLocale {
  currency: string;
  /** A key of shared/lib/number-format.ts. */
  numberFormat: string;
}

/** Currency and number format for the demo, from the browser's language. */
export function guessDemoLocale(languageTag?: string | null): DemoLocale {
  const tag =
    languageTag ??
    (typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language) : null) ??
    'en-US';
  let language = 'en';
  let region = '';
  try {
    const locale = new Intl.Locale(tag);
    language = locale.language.toLowerCase();
    region = (locale.region ?? '').toUpperCase();
  } catch {
    const [lang, reg] = tag.split(/[-_]/);
    language = (lang || 'en').toLowerCase();
    region = (reg || '').toUpperCase();
  }

  let currency = 'USD';
  if (region) {
    if (EURO_REGIONS.has(region)) currency = 'EUR';
    else if (REGION_CURRENCY[region]) currency = REGION_CURRENCY[region]!;
  } else if (EURO_LANGUAGES.has(language)) {
    currency = 'EUR';
  } else if (language === 'en') {
    currency = 'USD';
  }

  const numberFormat =
    language === 'en' && region === 'CA'
      ? '1,096.56 USD'
      : COMMA_DECIMAL_LANGUAGES.has(language)
        ? '1.096,56 $'
        : SPACE_GROUPING_LANGUAGES.has(language)
          ? '1 096,56 $US'
          : '$1,096.56';
  return { currency, numberFormat };
}

/**
 * Deletes the demo workspace with the same cleanup as Settings → Workspaces
 * (default workspace, cached members and invites). The caller has already
 * switched away from it if it was open.
 */
export async function removeDemoWorkspace(
  runtime: AppRuntime,
  queryClient: QueryClient,
  spaceId: string
): Promise<void> {
  await spaceApi.deleteSpace(spaceId);
  if (getDemoSpaceId() === spaceId) setDemoSpaceId(null);
  if (getStoredDefaultSpaceId() === spaceId) setStoredDefaultSpaceId(null);
  queryClient.removeQueries({ queryKey: ['space-members', spaceId] });
  queryClient.removeQueries({ queryKey: ['space-invites', spaceId] });
  if (runtime.isInitialized()) await runtime.refreshSpaces();
  if (runtime.getActiveSpaceId() === spaceId) {
    syncBudgetStateFromRuntime({
      runtime,
      queryClient,
      spaceId: null,
      candidateSelectedBudget: null,
    });
  }
  await queryClient.invalidateQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });
}

/**
 * A demo workspace left behind by an earlier attempt that never finished
 * (tab closed or seed failed mid-way): it is deleted before a new setup, so a
 * retry doesn't leave a second, half-filled demo. Only a workspace this user
 * owns is touched; errors leave it for Settings → Workspaces.
 */
export async function removeLeftoverDemoWorkspace(
  runtime: AppRuntime,
  queryClient: QueryClient
): Promise<void> {
  const leftover = getDemoSpaceId();
  if (!leftover) return;
  try {
    const spaces = await spaceApi.listSpaces();
    const mine = spaces.find((space) => space.space_id === leftover && space.role === 'owner');
    if (!mine) {
      // Gone already, or someone else's (a previous user on this device).
      setDemoSpaceId(null);
      return;
    }
    await removeDemoWorkspace(runtime, queryClient, leftover);
  } catch (err) {
    console.warn('[Demo] Could not remove a leftover demo workspace', err);
  }
}
