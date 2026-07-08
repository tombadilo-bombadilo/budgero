import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';

/** Shared loading/error/content guard for the five UserDetailsDialog tabs. */
export function TabSection({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {loading && (
        <Card>
          <CardContent className="grid gap-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      )}
      {!loading && error && (
        <Card className="border-amber-300/70">
          <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
              <div>
                <div className="font-medium text-amber-900">Unable to load user details</div>
                <div className="text-sm text-amber-800">{error}</div>
              </div>
            </div>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}
      {!loading && !error && children}
    </div>
  );
}
