import { Trans } from '@lingui/react/macro';
import { formatRelativeToNow } from '@shared/lib/date-format';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { usePendingMutations } from '../api/useSyncDiagnostics';

export function PendingChangesCard() {
  const { data: pending = [] } = usePendingMutations();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          <Trans>Waiting to send</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {pending.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            <Trans>The server has confirmed all changes from this device.</Trans>
          </p>
        ) : (
          <ul className="divide-y text-xs">
            {pending.map((mutation) => (
              <li key={mutation.id} className="flex items-center gap-2 px-4 py-1.5">
                <span className="font-mono truncate flex-1">{mutation.op}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatRelativeToNow(new Date(mutation.timestamp), { addSuffix: true })}
                </span>
                <Badge variant="outline" className="text-[0.625rem] px-1 py-0 h-4">
                  {mutation.sent ? <Trans>Sent</Trans> : <Trans>Queued</Trans>}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
