import React, { useEffect } from 'react';
import AppRouter from '@/app/router';
import { Toaster as SonnerToaster } from '@shared/ui/sonner';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { RuntimeProvider } from '@shared/runtime/runtime-provider';
import { ReconnectionOverlay } from '@app/system/ReconnectionOverlay';
import { useReconnectionOverlay } from '@shared/hooks/useReconnectionOverlay';
import { CurrencyConversionOverlay } from '@features/currencies/ui/CurrencyConversionOverlay';
import { useUiStore } from '@shared/store/useUiStore';
import { ClerkTokenSetup } from '@app/system/ClerkTokenSetup';
import { useUser } from '@clerk/clerk-react';
import { LoadingProvider } from '@shared/contexts/LoadingContext';
import { ClerkSignoutHandler } from '@features/auth/ui/ClerkSignoutHandler';
import { GlobalUndoHotkeys } from '@app/system/GlobalUndoHotkeys';
import { ThemePresetProvider } from '@shared/contexts/ThemePresetContext';
import { useRecurringNotifications } from '@features/recurring/api/useRecurringNotifications';
import { useOrientationLock } from '@shared/hooks/useOrientationLock';
import { ThemeColorController } from '@app/system/ThemeColorController';
import { ServiceWorkerUpdateProvider } from '@shared/pwa/ServiceWorkerUpdateProvider';
import { UpdateRequiredDialog } from '@shared/pwa/UpdateRequiredDialog';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';
import { setGlobalTokenGetter } from '@shared/lib/clerk-token-manager';
import { ChatBubble } from '@features/chat/ui/ChatBubble';
import { ChatPanel } from '@features/chat/ui/chat-panel';
import { TooltipProvider } from '@shared/ui/tooltip';
import { UserPreferencesSync } from '@app/system/UserPreferencesSync';
import { ActivityHeartbeat } from '@app/system/ActivityHeartbeat';
import { STARTUP_INTENT_KEY } from '@shared/lib/pwa-constants';

const PWA_SHORTCUT_CHANNEL = 'budgero-pwa-shortcut-intent-v1';
const PWA_SHORTCUT_HANDOFF_TIMEOUT_MS = 250;

type ShortcutIntentMessage =
  | { type: 'intent'; from: string; requestId: string; intent: string }
  | { type: 'intent-ack'; from: string; to: string; requestId: string };

function extractIntentFromUrl(rawUrl: string | URL): string | null {
  try {
    const parsed = new URL(
      typeof rawUrl === 'string' ? rawUrl : rawUrl.toString(),
      window.location.origin
    );
    return parsed.searchParams.get('intent');
  } catch {
    return null;
  }
}

function readIntentFromCurrentLocation(): string | null {
  try {
    return new URLSearchParams(window.location.search || '').get('intent');
  } catch {
    return null;
  }
}

function clearIntentFromCurrentLocation(): void {
  try {
    const params = new URLSearchParams(window.location.search || '');
    if (!params.has('intent')) return;
    params.delete('intent');
    const nextSearch = params.toString();
    const nextUrl =
      window.location.pathname + (nextSearch ? `?${nextSearch}` : '') + window.location.hash;
    window.history.replaceState(null, document.title, nextUrl);
  } catch {
    /* no-op */
  }
}

function dispatchStartupIntent(intent: string): void {
  if (!intent) return;
  try {
    window.localStorage.setItem(STARTUP_INTENT_KEY, intent);
  } catch {
    /* no-op */
  }
  window.dispatchEvent(
    new CustomEvent('budgero-startup-intent', {
      detail: { intent },
    })
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      networkMode: 'offlineFirst', // Offline-first
      refetchOnReconnect: true, // Refetch when connection is restored
    },
    mutations: {
      retry: 0,
      networkMode: 'always', // Support offline writes
    },
  },
});

// Suppress the automatic browser prompt so we can trigger it via our UI
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    const promptEvent = e as BeforeInstallPromptEvent;
    promptEvent.preventDefault();
    window.deferredPrompt = promptEvent;
  });
}

function App() {
  useOrientationLock();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const instanceId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const pendingHandoffs = new Map<string, number>();
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false);
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(PWA_SHORTCUT_CHANNEL) : null;

    const relayOrHandleIntent = (intent: string) => {
      if (!intent) return;
      if (!channel || !isStandalone) {
        dispatchStartupIntent(intent);
        return;
      }

      const requestId = `${instanceId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeoutId = window.setTimeout(() => {
        pendingHandoffs.delete(requestId);
        dispatchStartupIntent(intent);
      }, PWA_SHORTCUT_HANDOFF_TIMEOUT_MS);

      pendingHandoffs.set(requestId, timeoutId);
      channel.postMessage({
        type: 'intent',
        from: instanceId,
        requestId,
        intent,
      } satisfies ShortcutIntentMessage);
    };

    const closeIfPossible = () => {
      if (!isStandalone) return;
      try {
        window.close();
      } catch {
        /* no-op */
      }
    };

    if (channel) {
      channel.onmessage = (event: MessageEvent<ShortcutIntentMessage>) => {
        const { data } = event;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'intent') {
          if (data.from === instanceId) return;
          dispatchStartupIntent(data.intent);
          try {
            window.focus();
          } catch {
            /* no-op */
          }
          channel.postMessage({
            type: 'intent-ack',
            from: instanceId,
            to: data.from,
            requestId: data.requestId,
          } satisfies ShortcutIntentMessage);
          return;
        }

        if (data.type === 'intent-ack') {
          if (data.to !== instanceId) return;
          const timeoutId = pendingHandoffs.get(data.requestId);
          if (timeoutId === undefined) return;
          window.clearTimeout(timeoutId);
          pendingHandoffs.delete(data.requestId);
          closeIfPossible();
        }
      };
    }

    const startupIntent = readIntentFromCurrentLocation();
    if (startupIntent) {
      clearIntentFromCurrentLocation();
      relayOrHandleIntent(startupIntent);
    }

    const w = window as Window & {
      launchQueue?: {
        setConsumer?: (consumer: (params: { targetURL?: string | URL }) => void) => void;
      };
    };
    if (w.launchQueue?.setConsumer) {
      w.launchQueue.setConsumer((params) => {
        const targetURL = params?.targetURL;
        if (!targetURL) return;
        const intent = extractIntentFromUrl(targetURL);
        if (!intent) return;
        relayOrHandleIntent(intent);
      });
    }

    return () => {
      for (const timeoutId of pendingHandoffs.values()) {
        window.clearTimeout(timeoutId);
      }
      pendingHandoffs.clear();
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    };
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { __BUDGERO_APP_VERSION__: string }).__BUDGERO_APP_VERSION__ =
        __APP_VERSION__;
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ServiceWorkerUpdateProvider enabled>
        <UpdateRequiredDialog />
        {IS_SELF_HOSTABLE_BUILD ? (
          <CommonProviders>
            <AppContentSelfHost />
          </CommonProviders>
        ) : (
          <ClerkTokenSetup>
            <CommonProviders>
              <ClerkSignoutHandler />
              <AppContentAuthed />
            </CommonProviders>
          </ClerkTokenSetup>
        )}
      </ServiceWorkerUpdateProvider>
    </QueryClientProvider>
  );
}

/** Provider tree shared by the self-host and SaaS builds (which differ only in the Clerk wrapper). */
function CommonProviders({ children }: { children: React.ReactNode }) {
  return (
    <RuntimeProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemePresetProvider>
          <LoadingProvider>{children}</LoadingProvider>
        </ThemePresetProvider>
      </ThemeProvider>
    </RuntimeProvider>
  );
}

function AppContentBase({ topSlot }: { topSlot?: React.ReactNode }) {
  const { isVisible, phase, hideOverlay } = useReconnectionOverlay();
  const currencyConversion = useUiStore((state) => state.currencyConversion);

  return (
    <TooltipProvider>
      {topSlot}
      <UserPreferencesSync />
      <ThemeColorController />
      <SonnerToaster position="bottom-right" />
      {/* SW update prompts handled via ServiceWorkerUpdateProvider */}
      <GlobalUndoHotkeys />
      <AppRouter />
      <ChatBubble />
      <ChatPanel />
      <ReconnectionOverlay isVisible={isVisible} phase={phase} onComplete={hideOverlay} />
      <CurrencyConversionOverlay
        isVisible={currencyConversion.isActive}
        message={currencyConversion.message}
        progress={currencyConversion.progress}
        error={currencyConversion.error}
      />
    </TooltipProvider>
  );
}

function AppContentAuthed() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  useRecurringNotifications();

  // When Clerk's user profile changes, refresh profile
  useEffect(() => {
    if (!user) return;
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
  }, [user, queryClient]);

  return <AppContentBase topSlot={<ActivityHeartbeat />} />;
}

function AppContentSelfHost() {
  const token = useSelfHostAuth((state) => state.token);
  useEffect(() => {
    setGlobalTokenGetter(async () => token || null);
  }, [token]);
  useRecurringNotifications();

  return <AppContentBase />;
}

export default App;
