/**
 * Klaro consent manager config — app (my.budgero.app).
 *
 * Mirrors the marketing-site config so consent travels across subdomains
 * via the apex `.budgero.app` cookie. Self-host builds skip Klaro entirely
 * (see KlaroProvider) — there's no third-party tracking to gate.
 */

export const klaroConfig: KlaroConfig = {
  version: 1,
  elementID: 'klaro',
  // storageMethod + cookieDomain are patched at runtime in setupKlaro so
  // localhost / preview deploys fall back to localStorage (browsers drop
  // cookies whose Domain attribute isn't an ancestor of the current host).
  storageMethod: 'localStorage',
  storageName: 'klaro',
  cookieExpiresAfterDays: 365,
  htmlTexts: true,
  embedded: false,
  groupByPurpose: true,
  default: false,
  mustConsent: false,
  acceptAll: true,
  hideDeclineAll: false,
  hideLearnMore: false,
  noticeAsModal: false,
  disablePoweredBy: true,
  lang: 'en',
  additionalClass: 'budgero-klaro',
  styling: { theme: ['light', 'bottom'] },

  translations: {
    en: {
      privacyPolicyUrl: 'https://budgero.app/privacy',
      consentNotice: {
        title: '',
        description:
          'We use a couple of cookies for product analytics and ad attribution. Your encrypted budget data is never tracked. Up to you whether to allow these.',
        learnMore: 'Choose what to allow',
      },
      consentModal: {
        title: 'Cookies on Budgero',
        description:
          'Pick which cookies are OK with you. Your encrypted budget data is never tracked either way. You can change this any time from Settings → Security.',
      },
      acceptAll: 'Accept all',
      acceptSelected: 'Save choices',
      decline: 'Reject all',
      ok: 'Accept all',
      close: 'Close',
      save: 'Save',
      poweredBy: '',
      purposes: {
        analytics: {
          title: 'Product analytics',
          description: 'Which features get used. No personal or financial data.',
        },
      },
      purposeItem: { service: 'service', services: 'services' },
      service: {
        purpose: 'Purpose',
        purposes: 'Purposes',
        required: { title: 'Always on', description: 'Required, no consent needed.' },
        optOut: { title: '(opt-out)', description: '' },
      },
    },
  },

  services: [
    {
      name: 'posthog',
      title: 'PostHog (EU)',
      description:
        'Self-hosted-friendly product analytics. Tracks event names and page views, never amounts or personal data.',
      purposes: ['analytics'],
      cookies: [
        [/^ph_/, '/', '.budgero.app'],
        [/^_posthog$/, '/', '.budgero.app'],
      ],
      required: false,
      optOut: false,
      onlyOnce: true,
    },
  ],
};

export interface KlaroManager {
  getConsent(name: string): boolean;
  updateConsent(name: string, value: boolean): boolean;
  saveAndApplyConsents(eventType?: string): void;
  applyConsents(): void;
  watch(watcher: KlaroWatcher): void;
  unwatch(watcher: KlaroWatcher): void;
  consents: Record<string, boolean>;
  confirmed: boolean;
}

export interface KlaroWatcher {
  update(manager: KlaroManager, name: string, data: unknown): void;
}

export interface KlaroApi {
  setup(config: KlaroConfig): void;
  getManager(): KlaroManager;
  show(config?: KlaroConfig | undefined, modal?: boolean): boolean;
  render(config?: KlaroConfig | undefined, show?: boolean): boolean;
}

/** Loose Klaro config type — Klaro itself ships no .d.ts. */
export interface KlaroConfig {
  version?: number;
  elementID?: string;
  storageMethod?: 'cookie' | 'localStorage';
  storageName?: string;
  cookieDomain?: string;
  cookieExpiresAfterDays?: number;
  htmlTexts?: boolean;
  embedded?: boolean;
  groupByPurpose?: boolean;
  default?: boolean;
  mustConsent?: boolean;
  acceptAll?: boolean;
  hideDeclineAll?: boolean;
  hideLearnMore?: boolean;
  noticeAsModal?: boolean;
  disablePoweredBy?: boolean;
  lang?: string;
  additionalClass?: string;
  styling?: { theme?: string[] };
  translations?: Record<string, unknown>;
  services?: unknown[];
}
