import { Trans, useLingui } from '@lingui/react/macro';
import { track } from '@shared/lib/analytics/track';
import { toErrorCode } from '@shared/lib/analytics/error-codes';
import { useState } from 'react';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@shared/lib/errors';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { useConnectBank } from '../api/useBankSync';
import { SIMPLEFIN_BRIDGE_URL } from '../lib/simplefin-client';

export function ConnectSimpleFINCard({ budgetId }: { budgetId: number }) {
  const { t } = useLingui();
  const [token, setToken] = useState('');
  const connect = useConnectBank();

  const submit = () => {
    track('bank_connect_started', { provider: 'simplefin' });
    connect.mutate(
      { budgetId, setupToken: token },
      {
        onSuccess: () => {
          track('bank_connect_finished', {
            provider: 'simplefin',
            outcome: 'ok',
            error_code: 'none',
          });
          setToken('');
          toast.success(t`Connected to SimpleFIN`);
        },
        onError: (error) => {
          track('bank_connect_finished', {
            provider: 'simplefin',
            outcome: 'error',
            error_code: toErrorCode(error, 'bank'),
          });
          toast.error(getErrorMessage(error, t`Couldn't connect to SimpleFIN`));
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Trans>Connect SimpleFIN Bridge</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Bank sync uses your own SimpleFIN Bridge subscription. Budgero talks to SimpleFIN
            directly from this device; our servers never see your bank data.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          <li>
            <Trans>
              Sign up at{' '}
              <a
                href={SIMPLEFIN_BRIDGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                SimpleFIN Bridge
                <ExternalLink className="h-3 w-3" />
              </a>{' '}
              and connect your banks there.
            </Trans>
          </li>
          <li>
            <Trans>Create a new app connection and copy its setup token.</Trans>
          </li>
          <li>
            <Trans>Paste the token below.</Trans>
          </li>
        </ol>
        <div className="flex gap-2">
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t`Setup token`}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <Button onClick={submit} disabled={!token.trim() || connect.isPending}>
            {connect.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            <Trans>Connect</Trans>
          </Button>
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px" />
          <Trans>
            The access key is stored encrypted inside this budget and syncs to your devices. Anyone
            you share this budget with can sync it too.
          </Trans>
        </p>
      </CardContent>
    </Card>
  );
}
