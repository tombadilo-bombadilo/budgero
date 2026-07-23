import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { versionApi } from '@shared/api/api-client';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { isNewerVersion } from '@shared/lib/version';

const STALE_MS = 24 * 60 * 60 * 1000;

const dismissKeyFor = (version: string) => `budgero:update_available_dismissed:${version}`;

function readPersistedDismiss(version: string): boolean {
  try {
    return localStorage.getItem(dismissKeyFor(version)) === '1';
  } catch {
    return false;
  }
}

/**
 * Top-of-app banner shown on self-host builds when the server reports a newer
 * release than the one it's running. Dismissable per-version (re-keyed by the
 * latest version, so it comes back when the next release ships). SaaS builds
 * render nothing — updates arrive via the service-worker prompt there — but
 * the query still runs so the server can count active clients.
 */
export function UpdateAvailableBanner() {
  const [explicitlyDismissed, setExplicitlyDismissed] = useState(false);
  const { data } = useQuery({
    queryKey: ['version', 'latest'],
    queryFn: versionApi.getLatest,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const latest = data?.latest_version ?? '';
  const persistedDismissed = useMemo(
    () => (latest ? readPersistedDismiss(latest) : false),
    [latest]
  );

  if (!IS_SELF_HOSTABLE_BUILD) return null;
  if (!data) return null;
  if (!isNewerVersion(latest, data.build_version)) return null;
  if (explicitlyDismissed || persistedDismissed) return null;

  const handleDismiss = () => {
    setExplicitlyDismissed(true);
    try {
      localStorage.setItem(dismissKeyFor(latest), '1');
    } catch {
      /* no-op */
    }
  };

  return (
    <div className="bg-sky-600 text-white w-full">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 py-3">
          <p className="text-sm font-medium flex-1 min-w-0 truncate">
            Budgero {latest} is available — you&apos;re running {data.build_version}
          </p>
          <a
            href="https://budgero.app/changelog"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold underline whitespace-nowrap hover:opacity-90"
          >
            See what&apos;s new
          </a>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
