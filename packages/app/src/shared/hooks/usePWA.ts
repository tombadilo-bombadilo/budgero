import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

type InstallSupport = 'native' | 'manual-ios' | 'manual-firefox' | 'unsupported';

const SUPPRESS_KEY = 'pwa_install_suppress_until';
const SUPPRESS_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function isSuppressed(): boolean {
  try {
    const raw = localStorage.getItem(SUPPRESS_KEY);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function suppressFor3Days() {
  try {
    localStorage.setItem(SUPPRESS_KEY, String(Date.now() + SUPPRESS_MS));
  } catch {
    /* no-op: intentionally ignored */
  }
}

function detectInstallSupport(): InstallSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'unsupported';
  const ua = navigator.userAgent.toLowerCase();

  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isMacSafari = /macintosh/.test(ua) && ua.includes('safari') && !ua.includes('chrome');
  if (isIOS || isMacSafari) return 'manual-ios';

  const isFirefox = ua.includes('firefox');
  if (isFirefox && !ua.includes('android')) return 'manual-firefox';

  if (ua.includes('firefox') && ua.includes('android')) return 'native'; // Firefox Android supports install menu

  const supportsBeforeInstall =
    'BeforeInstallPromptEvent' in window && 'onbeforeinstallprompt' in window;
  return supportsBeforeInstall ? 'native' : 'unsupported';
}

function getInstallInstructions(support: InstallSupport) {
  switch (support) {
    case 'manual-ios':
      return '1. Tap the Share icon (square with arrow)\n2. Choose "Add to Home Screen"\n3. Confirm the name and tap Add';
    case 'manual-firefox':
      return 'Firefox does not expose the “beforeinstallprompt” API on desktop. Use the browser menu → “Install” if available, or switch to Chrome/Edge for install support.';
    case 'unsupported':
      return 'This browser does not support the automatic install prompt.\nTry browser menu options like “Install app” or “Add to Home Screen”, or use Chrome/Edge for the best install flow.';
    default:
      return undefined;
  }
}

export function usePWA() {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installSupport = detectInstallSupport();
  const installInstructions = getInstallInstructions(installSupport);
  const promptSuppressed = isSuppressed();

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean(nav.standalone) ||
      document.referrer.includes('android-app://');

    // Defer the state update to avoid synchronous setState warning
    queueMicrotask(() => {
      setIsStandalone(standalone);

      if (window.deferredPrompt) {
        deferredPromptRef.current = window.deferredPrompt;
        setIsInstallable(true);
      }
    });

    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      // Store in both ref and window for persistence
      deferredPromptRef.current = e;
      window.deferredPrompt = e;
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstallable(false);
      deferredPromptRef.current = null;
      window.deferredPrompt = undefined;
      toast.success('Budgero has been installed successfully!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = async () => {
    // Try both ref and window stored prompt
    const deferredPrompt = deferredPromptRef.current || window.deferredPrompt;

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();

        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
          toast.success('Installing Budgero...');
        } else {
          toast.info('You can install Budgero anytime from your browser menu');
          // Suppress auto prompts for 3 days after rejection
          suppressFor3Days();
        }

        // Clear the deferred prompt since it can only be used once
        deferredPromptRef.current = null;
        window.deferredPrompt = undefined;
        setIsInstallable(false);
      } catch (error) {
        console.error('Error showing install prompt:', error);
        toast.error('Failed to show install prompt. Please try installing from your browser menu.');
      }
    } else {
      const userAgent = navigator.userAgent.toLowerCase();
      let instructions = '';

      if (userAgent.includes('chrome') || userAgent.includes('chromium')) {
        instructions =
          'To install Budgero:\n• Click the menu (⋮) → "Install Budgero"\n• Or click the install icon in the address bar';
      } else if (userAgent.includes('safari')) {
        instructions = 'To install Budgero:\n• Tap the Share button\n• Select "Add to Home Screen"';
      } else if (userAgent.includes('firefox')) {
        instructions =
          'To install Budgero:\n• Firefox on Android: Menu → "Install"\n• Firefox on desktop: Installation not yet supported';
      } else if (userAgent.includes('edge')) {
        instructions =
          'To install Budgero:\n• Click the menu (⋯) → "Apps" → "Install this site as an app"';
      } else {
        instructions =
          'To install Budgero, look for an install option in your browser menu or address bar';
      }

      toast.info(instructions, {
        duration: 8000,
      });
    }
  };

  const canInstall =
    installSupport === 'native' ? isInstallable && !isStandalone && !promptSuppressed : false;

  return {
    isInstallable,
    isStandalone,
    canInstall,
    installSupport,
    installInstructions,
    installApp,
  };
}
