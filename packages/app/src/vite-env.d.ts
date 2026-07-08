/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_E2E_DISABLE_UPLOAD?: string;
  readonly VITE_E2E_SKIP_SERVER?: string;
  readonly VITE_SELF_HOSTABLE?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly MODE?: string;
  readonly DEV?: boolean;
  readonly PROD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface Window {
  process?: {
    type?: string;
  };
  deferredPrompt?: BeforeInstallPromptEvent;
}

declare const __APP_VERSION__: string;
declare const __APP_BUILD_SHA__: string;
