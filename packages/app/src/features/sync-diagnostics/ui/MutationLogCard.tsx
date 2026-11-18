import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { getErrorMessage } from '@shared/lib/errors';
import { formatRelativeToNow } from '@shared/lib/date-format';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  MUTATION_LOG_PAGE_SIZE,
  useLocalSyncState,
  useMutationLog,
  useSpaceMemberNames,
} from '../api/useSyncDiagnostics';
import type { DecodedLogEntry } from '../lib/decode-log-entry';

function LogRow({
  entry,
  author,
  applied,
}: {
  entry: DecodedLogEntry;
  author: string;
  applied: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className="w-12 shrink-0 font-mono tabular-nums text-muted-foreground">
          #{entry.version}
        </span>
        <span className={cn('flex-1 truncate font-mono', entry.error && 'text-destructive')}>
          {entry.error ? <Trans>Could not decrypt</Trans> : (entry.op ?? '—')}
        </span>
        <span className="hidden sm:block w-32 truncate text-muted-foreground">{author}</span>
        <span className="w-24 shrink-0 text-right text-muted-foreground">
          {formatRelativeToNow(new Date(entry.timestamp), { addSuffix: true })}
        </span>
        {!applied && (
          <Badge
            variant="outline"
            className="text-[0.625rem] px-1 py-0 h-4 text-amber-600 border-amber-600/40"
          >
            <Trans>Not applied</Trans>
          </Badge>
        )}
      </button>
      {open && (
        <div className="px-4 pb-2 pl-9 space-y-1">
          <div className="text-[0.6875rem] text-muted-foreground">
            <span className="sm:hidden">{author} · </span>
            {new Date(entry.timestamp).toLocaleString()} · {entry.id}
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[0.6875rem] leading-snug whitespace-pre-wrap break-all">
            {entry.error ?? JSON.stringify(entry.args ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

export function MutationLogCard() {
  const { t } = useLingui();
  const log = useMutationLog();
  const { data: local } = useLocalSyncState();
  const { data: names } = useSpaceMemberNames();
  const cursor = local?.diagnostics?.cursor ?? 0;
  const entries = log.data?.pages.flat() ?? [];

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            <Trans>Mutation log</Trans>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Latest changes stored on the server, decrypted on this device. Click a change to see
              its details.
            </Trans>
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={t`Reload log`}
          disabled={log.isFetching}
          onClick={() => void log.refetch()}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', log.isFetching && 'animate-spin')} />
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {log.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : log.error ? (
          <p className="px-4 pb-4 text-sm text-destructive">
            {getErrorMessage(log.error, t`Couldn't load the mutation log`)}
          </p>
        ) : entries.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            <Trans>No changes on the server yet.</Trans>
          </p>
        ) : (
          <>
            <ul className="divide-y">
              {entries.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  author={names?.get(entry.userId) ?? entry.userId}
                  applied={entry.version <= cursor}
                />
              ))}
            </ul>
            {log.hasNextPage && (
              <div className="flex justify-center p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={log.isFetchingNextPage}
                  onClick={() => void log.fetchNextPage()}
                >
                  {log.isFetchingNextPage ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trans>Load {MUTATION_LOG_PAGE_SIZE} older</Trans>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
