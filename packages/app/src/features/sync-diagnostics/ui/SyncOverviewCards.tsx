import { Trans, useLingui } from '@lingui/react/macro';
import { MUTATION_FORMAT_VERSION } from '@budgero/runtime';
import { formatRelativeToNow } from '@shared/lib/date-format';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  useLastSyncError,
  useLocalSyncState,
  useServerSyncState,
  useServerVersion,
} from '../api/useSyncDiagnostics';
import { describeSyncPosition } from '../lib/sync-position';

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.6875rem] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums truncate">{value}</div>
      {hint && <div className="text-[0.6875rem] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

const formatBytes = (bytes: number | undefined) =>
  bytes ? `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB` : '—';

export function SyncPositionCard() {
  const { t } = useLingui();
  const { data: local } = useLocalSyncState();
  const { data: server, error: serverError } = useServerSyncState();
  const lastError = useLastSyncError();
  const diagnostics = local?.diagnostics;
  const head = server?.mutation_version;
  const snapshot = server?.snapshot_mutation_version || undefined;
  const position = describeSyncPosition(diagnostics?.cursor, head, snapshot);

  const statusBadge = {
    synced: { label: t`Up to date`, className: 'text-emerald-600 border-emerald-600/40' },
    behind: {
      label: t`${position.behind} behind`,
      className: 'text-amber-600 border-amber-600/40',
    },
    ahead: { label: t`Ahead of server`, className: 'text-destructive border-destructive/40' },
    unknown: { label: t`Unknown`, className: '' },
  }[position.status];

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          <Trans>Sync position</Trans>
        </CardTitle>
        <Badge variant="outline" className={cn('text-[0.6875rem]', statusBadge.className)}>
          {statusBadge.label}
        </Badge>
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <Stat label={t`This device`} value={diagnostics?.cursor ?? '—'} />
        <Stat
          label={t`Server`}
          value={head ?? '—'}
          hint={serverError ? t`Server unreachable` : undefined}
        />
        <Stat
          label={t`Server snapshot`}
          value={snapshot ?? '—'}
          hint={
            position.snapshotTail !== null
              ? t`+${position.snapshotTail} changes after it`
              : t`Position unknown (older upload)`
          }
        />
        <Stat
          label={t`Snapshot updated`}
          value={
            server?.snapshot_updated_at
              ? formatRelativeToNow(new Date(server.snapshot_updated_at), { addSuffix: true })
              : '—'
          }
          hint={formatBytes(server?.snapshot_size_bytes)}
        />
        <Stat
          label={t`Connection`}
          value={diagnostics?.connected ? t`Connected` : t`Offline`}
          hint={local?.runtimeState}
        />
        <Stat
          label={t`Catch-up`}
          value={
            diagnostics?.catchUpInProgress
              ? t`Running`
              : diagnostics?.initialCatchUpSettled
                ? t`Done`
                : t`Waiting`
          }
        />
        <Stat label={t`Waiting to send`} value={diagnostics?.pendingCount ?? '—'} />
        <Stat
          label={t`Last sync error`}
          value={lastError ? <span className="text-destructive">{lastError}</span> : t`None`}
        />
      </CardContent>
    </Card>
  );
}

export function VersionsCard() {
  const { t } = useLingui();
  const { data: local } = useLocalSyncState();
  const { data: version } = useServerVersion();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          <Trans>Versions</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <Stat label={t`This app`} value={__APP_VERSION__} hint={__APP_BUILD_SHA__ || undefined} />
        <Stat
          label={t`Server`}
          value={version?.build_version ?? '—'}
          hint={version?.latest_version ? t`Latest release ${version.latest_version}` : undefined}
        />
        <Stat
          label={t`Database schema`}
          value={local?.schemaVersion ?? '—'}
          hint={local ? t`Supports up to ${local.supportedSchemaVersion}` : undefined}
        />
        <Stat label={t`Sync data format`} value={`v${MUTATION_FORMAT_VERSION}`} />
      </CardContent>
    </Card>
  );
}
