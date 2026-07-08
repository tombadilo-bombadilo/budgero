import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Loader2, Download, Trash2 } from 'lucide-react';
import { Spinner } from '@shared/ui/spinner';
import type { PushApiState } from './usePushApiState';

interface QueueStatsPanelProps {
  state: PushApiState;
}

export function QueueStatsPanel({ state }: QueueStatsPanelProps) {
  const { queueStats, isLoadingStats, isProcessingQueue, handlePullMutations, clearQueueMutation } =
    state;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Queue Status</CardTitle>
        <CardDescription>
          Pending mutations waiting to be processed when you connect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingStats ? (
          <div className="flex items-center justify-center py-4">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="space-y-1">
                <p className="text-2xl font-bold text-yellow-600">{queueStats?.pending ?? 0}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-green-600">{queueStats?.processed ?? 0}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-red-600">{queueStats?.failed ?? 0}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold">{queueStats?.total ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
            {(queueStats?.pending ?? 0) > 0 && (
              <div className="flex justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePullMutations}
                  disabled={isProcessingQueue}
                >
                  {isProcessingQueue ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Pull Mutations
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearQueueMutation.mutate()}
                  disabled={clearQueueMutation.isPending}
                >
                  {clearQueueMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Clear Queue
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
