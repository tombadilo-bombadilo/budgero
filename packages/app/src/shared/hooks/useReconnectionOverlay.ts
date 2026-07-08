import { useState, useCallback, useEffect } from 'react';
import { useRuntime } from '@shared/runtime/runtime-provider';

type OverlayPhase = 'hidden' | 'syncing' | 'success';

interface UseReconnectionOverlayReturn {
  isVisible: boolean;
  phase: OverlayPhase;
  hideOverlay: () => void;
}

export const useReconnectionOverlay = (): UseReconnectionOverlayReturn => {
  const [phase, setPhase] = useState<OverlayPhase>('hidden');
  const isVisible = phase !== 'hidden';
  const runtime = useRuntime();

  const hideOverlay = useCallback(() => {
    setPhase('hidden');
  }, []);

  // Listen for overlay phase changes from the service manager
  useEffect(() => {
    const overlayListener = (newPhase: OverlayPhase) => {
      setPhase(newPhase);
    };

    const removeListener = runtime.onOverlayChange(overlayListener);

    return () => {
      removeListener();
    };
  }, [runtime]);

  return {
    isVisible,
    phase,
    hideOverlay,
  };
};
