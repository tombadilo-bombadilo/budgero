/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from 'sonner';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';

type ServiceWorkerUpdateContextValue = {
  checkForUpdates: () => Promise<void>;
  isChecking: boolean;
  isUpdateReady: boolean;
  dismissUpdatePrompt: () => void;
  applyUpdate: () => void;
  isSupported: boolean;
  lastCheckMessage: string | null;
};

const noopAsync = async () => {
  /* noop */
};
const noop = () => {
  /* noop */
};

const ServiceWorkerUpdateContext = createContext<ServiceWorkerUpdateContextValue>({
  checkForUpdates: noopAsync,
  isChecking: false,
  isUpdateReady: false,
  dismissUpdatePrompt: noop,
  applyUpdate: noop,
  isSupported: false,
  lastCheckMessage: null,
});

type ProviderProps = {
  enabled: boolean;
  children: ReactNode;
};

export function ServiceWorkerUpdateProvider({ enabled, children }: ProviderProps) {
  // All hooks must be called before any early returns
  const [showPrompt, setShowPrompt] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckMessage, setLastCheckMessage] = useState<string | null>(null);

  const {
    updateServiceWorker,
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    immediate: enabled,
    onRegisterError(error) {
      if (enabled) {
        console.error('[PWA] Service worker registration failed', error);
        toast.error('Failed to enable offline updates.');
      }
    },
  });

  useEffect(() => {
    if (enabled && needRefresh) {
      setShowPrompt(true);
    }
  }, [enabled, needRefresh]);

  const applyUpdate = useCallback(() => {
    void updateServiceWorker(true);
    setShowPrompt(false);
  }, [updateServiceWorker]);

  const dismissUpdatePrompt = useCallback(() => {
    setShowPrompt(false);
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  const checkForUpdates = useCallback(async () => {
    if (!enabled) {
      toast.error('Updates are unavailable in this environment.');
      return;
    }

    if (!('serviceWorker' in navigator)) {
      toast.error('Service workers are not supported in this browser.');
      setLastCheckMessage('Service workers not supported in this browser.');
      return;
    }

    setIsChecking(true);
    let latestMessage: string | null = null;

    const finalize = (message: string) => {
      latestMessage = message;
      const timestamp = new Date().toLocaleTimeString();
      setLastCheckMessage(`${message} • ${timestamp}`);
    };

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        toast.error('No service worker registration found.');
        finalize('No service worker registration found');
        return;
      }

      await registration.update();

      if (registration.waiting || registration.installing) {
        finalize('Update available');
        setShowPrompt(true);
      } else {
        finalize('Already on the latest version');
      }
    } catch (error) {
      console.error('[PWA] Manual update check failed', error);
      const message = 'Failed to check for updates';
      toast.error(message);
      finalize(message);
    } finally {
      setIsChecking(false);
      if (!latestMessage) {
        const timestamp = new Date().toLocaleTimeString();
        setLastCheckMessage(`Checked • ${timestamp}`);
      }
    }
  }, [enabled]);

  const disabledValue = useMemo<ServiceWorkerUpdateContextValue>(
    () => ({
      checkForUpdates: async () => {
        toast.error('Updates are unavailable in this environment.');
      },
      isChecking: false,
      isUpdateReady: false,
      dismissUpdatePrompt: noop,
      applyUpdate: noop,
      isSupported: false,
      lastCheckMessage: null,
    }),
    []
  );

  const enabledValue = useMemo<ServiceWorkerUpdateContextValue>(
    () => ({
      checkForUpdates,
      isChecking,
      isUpdateReady: needRefresh || showPrompt,
      dismissUpdatePrompt,
      applyUpdate,
      isSupported: true,
      lastCheckMessage,
    }),
    [
      applyUpdate,
      checkForUpdates,
      dismissUpdatePrompt,
      isChecking,
      lastCheckMessage,
      needRefresh,
      showPrompt,
    ]
  );

  // Early return for disabled state after all hooks
  if (!enabled) {
    return (
      <ServiceWorkerUpdateContext.Provider value={disabledValue}>
        {children}
      </ServiceWorkerUpdateContext.Provider>
    );
  }

  return (
    <ServiceWorkerUpdateContext.Provider value={enabledValue}>
      {children}
      <PWAUpdatePrompt
        open={showPrompt}
        onUpdate={applyUpdate}
        onDismiss={dismissUpdatePrompt}
        currentVersion={__APP_VERSION__}
      />
    </ServiceWorkerUpdateContext.Provider>
  );
}

export function useServiceWorkerUpdate() {
  return useContext(ServiceWorkerUpdateContext);
}
