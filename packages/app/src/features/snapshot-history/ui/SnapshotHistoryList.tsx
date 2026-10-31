import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { SnapshotHistoryEntry } from '@shared/api/api-client';
import { formatDate, formatRelativeToNow } from '@shared/lib/date-format';
import { getErrorMessage } from '@shared/lib/errors';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { useRestoreSnapshot, useSnapshotHistory } from '../api/useSnapshotHistory';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotHistoryList() {
  const { t } = useLingui();
  const { data, isLoading, error } = useSnapshotHistory();
  const restore = useRestoreSnapshot();
  const [pending, setPending] = useState<SnapshotHistoryEntry | null>(null);

  const originLabel = (origin: SnapshotHistoryEntry['origin']) =>
    origin === 'out_of_band'
      ? t`Import or restore`
      : origin === 'restore'
        ? t`Restored copy`
        : t`Sync`;

  const confirmRestore = async () => {
    if (!pending) return;
    try {
      await restore.mutateAsync(pending.id);
      toast.success(t`Earlier version restored`, {
        description: t`Your other devices will reload it the next time they sync.`,
      });
      setPending(null);
    } catch (err) {
      toast.error(t`Couldn't restore this version`, { description: getErrorMessage(err) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" />
          <Trans>Earlier versions</Trans>
          <Badge variant="outline" className="text-[11px]">
            <Trans>Beta</Trans>
          </Badge>
        </CardTitle>
        <CardDescription>
          <Trans>
            The server keeps the last few copies of this workspace, and one a day for the past week.
            Restoring a copy replaces the workspace on all devices and then re-applies every change
            made after it, so no edits are lost. Use it when a workspace looks empty or broken after
            syncing.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Earlier versions are not available right now.</Trans>
          </p>
        ) : !data?.entries.length ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No earlier versions yet. One is kept each time this workspace syncs.</Trans>
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.current ? (
              <li className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <Trans>Current version</Trans>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(new Date(data.current.updated_at), 'PPp')} ·{' '}
                    {t`${data.current.mutation_version} changes`} ·{' '}
                    {formatSize(data.current.size_bytes)}
                  </p>
                </div>
              </li>
            ) : null}
            {data.entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    {formatDate(new Date(entry.became_current_at), 'PPp')}{' '}
                    <span className="text-muted-foreground">
                      ({formatRelativeToNow(new Date(entry.became_current_at), { addSuffix: true })}
                      )
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t`${entry.mutation_version} changes`} · {formatSize(entry.size_bytes)} ·{' '}
                    {originLabel(entry.origin)}
                    {entry.restorable ? '' : ` · ${t`made before the master password changed`}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!entry.restorable || restore.isPending}
                  onClick={() => setPending(entry)}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  <Trans>Restore</Trans>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => !open && setPending(null)}
          title={t`Restore this version?`}
          description={
            pending
              ? t`The workspace on all devices is replaced with the copy from ${formatDate(new Date(pending.became_current_at), 'PPp')}, then every change made after it is applied again. Download a backup first if you are unsure.`
              : ''
          }
          confirmText={t`Restore`}
          cancelText={t`Cancel`}
          loadingText={t`Restoring…`}
          isLoading={restore.isPending}
          onConfirm={confirmRestore}
        />
      </CardContent>
    </Card>
  );
}
