import React from 'react';
import { CheckCircle, Wifi } from 'lucide-react';

interface ReconnectionOverlayProps {
  isVisible: boolean;
  phase: 'syncing' | 'success' | 'hidden';
  onComplete?: () => void;
}

export const ReconnectionOverlay: React.FC<ReconnectionOverlayProps> = ({
  isVisible,
  phase,
  onComplete,
}) => {
  React.useEffect(() => {
    if (phase === 'success') {
      const timer = setTimeout(() => {
        onComplete?.();
      }, 1500); // Show success for 1.5 seconds

      return () => clearTimeout(timer);
    }
  }, [phase, onComplete]);

  if (!isVisible || phase === 'hidden') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

      {/* Glassmorphic card */}
      <div className="relative z-10 mx-4 max-w-sm w-full">
        <div className="rounded-2xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/20 shadow-2xl p-8 text-center">
          {phase === 'syncing' && (
            <>
              <div className="mb-6">
                <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                  <Wifi className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Getting you back online
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Syncing your data and replaying offline changes...
                </p>
              </div>

              {/* Animated dots */}
              <div className="flex justify-center space-x-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                    style={{
                      animationDelay: `${i * 0.2}s`,
                      animationDuration: '1s',
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {phase === 'success' && (
            <>
              <div className="mb-6">
                <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4 animate-pulse">
                  <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Welcome back online!
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  All your data is now synchronized
                </p>
              </div>

              {/* Success checkmark animation */}
              <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full animate-pulse" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
