import { useEffect, useState } from 'react';

const ORIENTATION_LOCK_BREAKPOINT = 500;

type OrientationLockType =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary';

type OrientationController = {
  lock: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
};

function getOrientationController(): OrientationController | null {
  if (typeof window === 'undefined') return null;

  const screenAny = window.screen as Screen & {
    lockOrientation?: (orientation: OrientationLockType) => Promise<void> | boolean;
    mozLockOrientation?: (orientation: OrientationLockType) => Promise<void> | boolean;
    msLockOrientation?: (orientation: OrientationLockType) => Promise<void> | boolean;
    unlockOrientation?: () => void;
    mozUnlockOrientation?: () => void;
    msUnlockOrientation?: () => void;
  };

  const orientation = screenAny.orientation as
    | (ScreenOrientation & { lock?: (orientation: OrientationLockType) => Promise<void> })
    | undefined;
  if (orientation && typeof orientation.lock === 'function') {
    const lock = orientation.lock.bind(orientation) as (
      orientation: OrientationLockType
    ) => Promise<void>;
    return {
      lock: (value) => lock(value),
      unlock: typeof orientation.unlock === 'function' ? () => orientation.unlock() : undefined,
    };
  }

  const legacyLock =
    screenAny.lockOrientation || screenAny.mozLockOrientation || screenAny.msLockOrientation;
  if (typeof legacyLock === 'function') {
    const legacyUnlock =
      screenAny.unlockOrientation ||
      screenAny.mozUnlockOrientation ||
      screenAny.msUnlockOrientation;
    return {
      lock: async (value) => {
        const result = legacyLock.call(screenAny, value);
        if (typeof result === 'boolean') {
          if (!result) {
            throw new Error('Orientation lock rejected');
          }
          return;
        }
        await result;
      },
      unlock: legacyUnlock
        ? () => {
            legacyUnlock.call(screenAny);
          }
        : undefined,
    };
  }

  return null;
}

export function useOrientationLock() {
  const [isFallbackActive, setIsFallbackActive] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const orientationController = getOrientationController();
    if (!orientationController && import.meta.env.DEV) {
      console.info('[orientation] Screen Orientation API not supported');
    }

    let disposed = false;
    let currentMode: 'portrait' | 'unlocked' | null = null;

    const shouldLockPortrait = () => {
      const dimensions = [
        window.innerWidth,
        window.innerHeight,
        window.screen.width,
        window.screen.height,
      ].filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
      const minDimension = Math.min(...dimensions);
      return minDimension < ORIENTATION_LOCK_BREAKPOINT;
    };

    const isLandscape = () => {
      if (typeof window === 'undefined') return false;
      if (typeof window.matchMedia === 'function') {
        try {
          return window.matchMedia('(orientation: landscape)').matches;
        } catch {
          // ignore matchMedia failures and fall back to dimensions
        }
      }
      return window.innerWidth > window.innerHeight;
    };

    const updateFallback = (shouldLock: boolean) => {
      if (disposed) return;
      if (!shouldLock) {
        setIsFallbackActive(false);
        return;
      }
      setIsFallbackActive(isLandscape());
    };

    const applyLock = async () => {
      if (disposed) return;
      const lockToPortrait = shouldLockPortrait();

      if (!orientationController) {
        updateFallback(lockToPortrait);
        return;
      }

      if (lockToPortrait) {
        if (currentMode === 'portrait') {
          updateFallback(false);
          return;
        }
        currentMode = 'portrait';
        try {
          await orientationController.lock('portrait');
          updateFallback(false);
        } catch (error) {
          currentMode = null;
          if (import.meta.env.DEV) {
            console.warn('[orientation] Failed to lock portrait', error);
          }
          updateFallback(lockToPortrait);
        }
        return;
      }

      if (currentMode === 'unlocked') {
        updateFallback(false);
        return;
      }
      currentMode = 'unlocked';
      try {
        orientationController.unlock?.();
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[orientation] Failed to unlock orientation', error);
        }
      }
      updateFallback(false);
    };

    void applyLock();

    const handleSizeChange = () => {
      void applyLock();
    };

    window.addEventListener('resize', handleSizeChange);
    window.addEventListener('orientationchange', handleSizeChange);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleSizeChange);
      window.removeEventListener('orientationchange', handleSizeChange);
    };
  }, []);

  return isFallbackActive;
}
