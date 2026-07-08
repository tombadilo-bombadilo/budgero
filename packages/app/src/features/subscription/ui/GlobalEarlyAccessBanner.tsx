import { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { apiClient } from '@shared/api/api-client';

interface GlobalEarlyAccessBannerProps {
  dismissible?: boolean;
  variant?: 'top' | 'inline';
}

export default function GlobalEarlyAccessBanner({
  dismissible = true,
  variant = 'top',
}: GlobalEarlyAccessBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await apiClient.get<{
          early_access_mode: boolean;
          early_access_message: string;
        }>('/config');

        if (response.early_access_mode) {
          setIsVisible(true);
          setMessage(response.early_access_message);
        }
      } catch (error) {
        console.error('Failed to fetch app config:', error);
      } finally {
        setLoading(false);
      }
    };

    const dismissed = sessionStorage.getItem('early-access-banner-dismissed');
    if (!dismissed || !dismissible) {
      void fetchConfig();
    } else {
      setLoading(false);
    }
  }, [dismissible]);

  const handleDismiss = () => {
    setIsVisible(false);
    if (dismissible) {
      sessionStorage.setItem('early-access-banner-dismissed', 'true');
    }
  };

  if (loading || !isVisible) return null;

  if (variant === 'inline') {
    return (
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-4 rounded-lg shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Early Access</p>
              <p className="text-sm opacity-90">{message}</p>
            </div>
          </div>
          {dismissible && (
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white w-full">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center justify-center gap-2 flex-1">
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{message}</p>
          </div>
          {dismissible && (
            <button
              onClick={handleDismiss}
              className="ml-4 p-1 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
