import React from 'react';
import { Loader2, TrendingUp, AlertCircle } from 'lucide-react';
import { cn } from '@shared/lib/utils';

interface CurrencyConversionOverlayProps {
  isVisible: boolean;
  message?: string;
  progress?: {
    current: number;
    total: number;
  };
  error?: string;
}

export function CurrencyConversionOverlay({
  isVisible,
  message = 'Converting currencies...',
  progress,
  error,
}: CurrencyConversionOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4">
        <div
          className={cn('rounded-lg border bg-card p-6 shadow-lg', error && 'border-destructive')}
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              {error ? (
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                </div>
              ) : (
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="w-8 h-8 text-primary" />
                  </div>
                  <Loader2 className="w-16 h-16 absolute inset-0 animate-spin text-primary/30" />
                </div>
              )}
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">
                {error ? 'Conversion Failed' : 'Currency Conversion in Progress'}
              </h3>
              <p className="text-sm text-muted-foreground">{error || message}</p>
            </div>

            {!error && progress && (
              <div className="w-full space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Processing transactions</span>
                  <span>
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{
                      width: `${Math.round((progress.current / progress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {!error && (
              <div className="text-xs text-muted-foreground text-center space-y-1">
                <p>• Fetching exchange rates</p>
                <p>• Updating transaction amounts</p>
                <p>• Recalculating balances</p>
              </div>
            )}

            {error && (
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Reload Application
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
