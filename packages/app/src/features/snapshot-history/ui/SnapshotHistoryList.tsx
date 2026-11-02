import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { SnapshotHistoryEntry } from '@shared/api/api-client';
import { formatDate, formatRelativeToNow } from '@shared/lib/date-format';
import { parseDateKey } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import {
  useRestoreSnapshot,
  type RestoreMode,
  useSnapshotHistory,
  useSnapshotSummary,
} from '../api/useSnapshotHistory';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What a copy contains, decrypted and counted on this device. */
function SnapshotContents({ entry, enabled }: { entry: number | 'current'; enabled: boolean }) {
  const { t } = useLingui();
  const { data, isLoading, error } = useSnapshotSummary(entry, enabled);
  if (!enabled) return null;
  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>Checking contents…</Trans>
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>Contents can't be read on this device.</Trans>
      </p>
    );
  }
  const parts = [
    plural(data.transactions, { one: '# transaction', other: '# transactions' }),
    plural(data.accounts, { one: '# account', other: '# accounts' }),
    plural(data.categories, { one: '# category', other: '# categories' }),
    plural(data.budgets, { one: '# budget', other: '# budgets' }),
  ];
  const newest = data.lastTransactionDate ? parseDateKey(data.lastTransactionDate) : null;
  if (newest) {
    parts.push(t`newest transaction ${formatDate(newest, 'PP')}`);
  }
  return <p className="text-xs">{parts.join(' · ')}</p>;
}

export function SnapshotHistoryList() {
  const { t } = useLingui();
  const { data, isLoading, error } = useSnapshotHistory();
  const restore = useRestoreSnapshot();
  const [pending, setPending] = useState<SnapshotHistoryEntry | null>(null);
  // Default keeps every edit; going back is the deliberate choice.
  const [mode, setMode] = useState<RestoreMode>('replay');
  const laterChanges =
    pending && data?.current
      ? Math.max(0, data.current.mutation_version - pending.mutation_version)
      : 0;

  const originLabel = (origin: SnapshotHistoryEntry['origin']) =>
    origin === 'out_of_band'
      ? t`Import or restore`
      : origin === 'restore'
        ? t`Restored copy`
        : t`Sync`;

  const confirmRestore = async () => {
    if (!pending) return;
    try {
      await restore.mutateAsync({ entryId: pending.id, mode });
      toast.success(
        mode === 'reset' ? t`Workspace reset to the earlier version` : t`Earlier version restored`,
        {
          description: t`Your other devices will reload it the next time they sync.`,
        }
      );
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
            You can go back to a copy and discard everything changed after it, or restore it and
            re-apply the later changes. Use it when a workspace looks empty or broken after syncing,
            or to undo a batch of changes.
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
                    {t`up to change #${data.current.mutation_version}`} ·{' '}
                    {formatSize(data.current.size_bytes)}
                  </p>
                  <SnapshotContents entry="current" enabled />
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
                    {t`up to change #${entry.mutation_version}`} · {formatSize(entry.size_bytes)} ·{' '}
                    {originLabel(entry.origin)}
                    {entry.restorable ? '' : ` · ${t`made before the master password changed`}`}
                  </p>
                  <SnapshotContents entry={entry.id} enabled={entry.restorable} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!entry.restorable || restore.isPending}
                  onClick={() => {
                    setMode('replay');
                    setPending(entry);
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  <Trans>Restore</Trans>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                <Trans>Restore this version?</Trans>
              </DialogTitle>
              <DialogDescription>
                {pending
                  ? t`Copy from ${formatDate(new Date(pending.became_current_at), 'PPp')}. The workspace is replaced on all your devices.`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as RestoreMode)}
              className="gap-3"
            >
              <Label
                htmlFor="restore-mode-reset"
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal"
              >
                <RadioGroupItem value="reset" id="restore-mode-reset" className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    <Trans>Go back to this version</Trans>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {laterChanges > 0
                      ? plural(laterChanges, {
                          one: 'Discards the # change made after it, imports included.',
                          other: 'Discards the # changes made after it, imports included.',
                        })
                      : t`Discards any change made after it, imports included.`}
                  </span>
                </span>
              </Label>
              <Label
                htmlFor="restore-mode-replay"
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal"
              >
                <RadioGroupItem value="replay" id="restore-mode-replay" className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    <Trans>Restore and keep later changes</Trans>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <Trans>
                      Re-applies every change made after it, so no edits are lost. Use this when the
                      workspace looks empty or broken after syncing.
                    </Trans>
                  </span>
                </span>
              </Label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              <Trans>Download a backup first if you are unsure.</Trans>
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPending(null)}
                disabled={restore.isPending}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant={mode === 'reset' ? 'destructive' : 'default'}
                onClick={confirmRestore}
                disabled={restore.isPending}
                data-testid="confirm-restore"
              >
                {restore.isPending ? (
                  <Trans>Restoring…</Trans>
                ) : mode === 'reset' ? (
                  <Trans>Go back</Trans>
                ) : (
                  <Trans>Restore</Trans>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
