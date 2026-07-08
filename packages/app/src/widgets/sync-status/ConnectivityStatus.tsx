/**
 * Real-time connectivity indicator showing online/offline and WebSocket sync status
 */

import { useState, useEffect, useMemo } from 'react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Badge } from '@shared/ui/badge';
import { cn } from '@shared/lib/utils';

interface ConnectivityStatusProps {
  className?: string;
}

/**
 * Compact version for header/toolbar
 */
export function ConnectivityStatus({ className }: ConnectivityStatusProps) {
  const [snapshot, setSnapshot] = useState(() => ({
    clerkToken: false,
    apiReachable: false,
    wsConnected: false,
    overall: false,
    lastChecked: 0,
    selfHostable: false,
  }));
  const runtime = useRuntime();

  useEffect(() => {
    const off = runtime.onConnectivityChange((state) => {
      setSnapshot(state);
    });

    void Promise.resolve().then(() => {
      setSnapshot(runtime.connectivityState());
    });
    return off;
  }, [runtime]);

  const statusColor = snapshot.overall
    ? 'bg-green-500'
    : snapshot.wsConnected
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const statusLabel = snapshot.overall
    ? 'Connected - Real-time sync active'
    : snapshot.wsConnected
      ? 'Limited - WebSocket connected but API/Auth may be degraded'
      : 'Offline - Changes will sync when connection is restored';

  const detailRows = useMemo(() => {
    const rows = [
      !snapshot.selfHostable && {
        label: 'Clerk token',
        value: snapshot.clerkToken ? 'ready' : 'missing',
      },
      { label: 'API health', value: snapshot.apiReachable ? 'reachable' : 'unreachable' },
      { label: 'WebSocket', value: snapshot.wsConnected ? 'connected' : 'disconnected' },
    ].filter(Boolean) as { label: string; value: string }[];
    return rows;
  }, [snapshot]);

  const lastChecked =
    snapshot.lastChecked > 0
      ? new Date(snapshot.lastChecked).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '—';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className
          )}
          aria-label="Connectivity status"
        >
          <div className={cn('w-1.5 h-1.5 rounded-full', statusColor)} />
          {snapshot.wsConnected && <span className="text-xs text-muted-foreground">⚡</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-56 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Connectivity</span>
          <Badge
            variant={
              snapshot.overall ? 'default' : snapshot.wsConnected ? 'secondary' : 'destructive'
            }
          >
            {snapshot.overall ? 'Online' : snapshot.wsConnected ? 'Partial' : 'Offline'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{statusLabel}</p>
        <div className="space-y-2">
          {detailRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium text-foreground capitalize">{row.value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Last checked</span>
            <span className="font-medium text-foreground">{lastChecked}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
