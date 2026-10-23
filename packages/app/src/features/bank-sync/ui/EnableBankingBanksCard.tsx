import { Trans, useLingui } from '@lingui/react/macro';
import { track } from '@shared/lib/analytics/track';
import { toErrorCode } from '@shared/lib/analytics/error-codes';
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Landmark, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  parseEnableBankingConfig,
  type BankConnection,
  type EnableBankingSession,
} from '@budgero/core/browser';
import { getLocaleTag } from '@shared/i18n';
import { formatRelativeToNow } from '@shared/lib/date-format';
import { getErrorMessage } from '@shared/lib/errors';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Label } from '@shared/ui/label';
import { useAspsps, useRemoveBankSession, useStartBankAuthorization } from '../api/useBankSync';
import type { Aspsp } from '../lib/enable-banking/client';
import { isSessionExpired, sessionExpiresSoon } from '../lib/provider';
import { AuthorizationCancelled, openBankLoginPopup } from '../model/bank-auth-popup';
import { ENABLE_BANKING_CONTROL_PANEL_URL } from '../lib/enable-banking/client';
import { BankLogo, CountryFlag, SearchPicker, type SearchPickerOption } from './SearchPicker';

/** Countries Enable Banking covers (EEA and the UK). */
const COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
];

function guessCountry(): string {
  const region = getLocaleTag().split('-')[1]?.toUpperCase();
  return region && COUNTRIES.includes(region) ? region : 'FI';
}

function countryName(code: string, locale = getLocaleTag()): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const englishCountryName = (code: string) => countryName(code, 'en');

/** Bank login in a popup, falling back to a full redirect when popups can't open. */
function useBankLogin(onConnected?: () => void) {
  const { t } = useLingui();
  const start = useStartBankAuthorization();
  const abort = useRef<AbortController | null>(null);
  const login = (connection: BankConnection, aspsp: Aspsp) => {
    // Opened right here in the click handler, or the browser blocks it.
    const popup = openBankLoginPopup();
    abort.current = new AbortController();
    track('bank_connect_started', { provider: 'enablebanking' });
    start.mutate(
      { connection, aspsp, popup, signal: abort.current.signal },
      {
        onSuccess: (session) => {
          // No session: the login continues as a full-page redirect.
          if (!session) return;
          track('bank_connect_finished', {
            provider: 'enablebanking',
            outcome: 'ok',
            error_code: 'none',
          });
          toast.success(t`${session.aspsp.name} connected`, {
            description: session.accounts.length
              ? t`Link its accounts to start importing.`
              : t`The bank returned no accounts. Link them to your app in the Enable Banking control panel, then reconnect.`,
          });
          onConnected?.();
        },
        onError: (error) => {
          const cancelled = error instanceof AuthorizationCancelled;
          track('bank_connect_finished', {
            provider: 'enablebanking',
            outcome: cancelled ? 'cancelled' : 'error',
            error_code: cancelled ? 'cancelled' : toErrorCode(error, 'bank'),
          });
          if (cancelled) return;
          toast.error(getErrorMessage(error, t`Couldn't finish connecting the bank`));
        },
      }
    );
  };
  return { login, cancel: () => abort.current?.abort(), isPending: start.isPending };
}

function AddBankForm({
  connection,
  onConnected,
}: {
  connection: BankConnection;
  onConnected?: () => void;
}) {
  const { t } = useLingui();
  const [country, setCountry] = useState(guessCountry);
  const [bankName, setBankName] = useState('');
  const aspsps = useAspsps(connection, country);
  const bankLogin = useBankLogin(onConnected);
  const countryOptions = useMemo<SearchPickerOption[]>(
    () =>
      COUNTRIES.map((code) => ({
        value: code,
        label: countryName(code),
        // Match the English name and the code too, whatever the UI language.
        keywords: [code, englishCountryName(code)],
        icon: <CountryFlag code={code} />,
      })).sort((a, b) => a.label.localeCompare(b.label)),
    []
  );
  const bankOptions = useMemo<SearchPickerOption[]>(
    () =>
      (aspsps.data ?? []).map((aspsp) => ({
        value: aspsp.name,
        label: aspsp.name,
        icon: <BankLogo src={aspsp.logo} />,
        hint: aspsp.beta ? (
          <Badge variant="outline" className="ml-auto text-[10px]">
            <Trans>Beta</Trans>
          </Badge>
        ) : undefined,
      })),
    [aspsps.data]
  );
  const bank = aspsps.data?.find((aspsp) => aspsp.name === bankName);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label>
            <Trans>Country</Trans>
          </Label>
          <SearchPicker
            ariaLabel={t`Country`}
            options={countryOptions}
            value={country}
            onChange={(value) => {
              setCountry(value);
              setBankName('');
            }}
            placeholder={t`Choose your country`}
            searchPlaceholder={t`Search countries…`}
            emptyText={t`No country found.`}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <Trans>Bank</Trans>
          </Label>
          <SearchPicker
            ariaLabel={t`Bank`}
            options={bankOptions}
            value={bankName}
            onChange={setBankName}
            disabled={!aspsps.data?.length}
            loading={aspsps.isLoading}
            placeholder={aspsps.isLoading ? t`Loading banks…` : t`Choose your bank`}
            searchPlaceholder={t`Search banks…`}
            emptyText={t`No bank found.`}
          />
        </div>
      </div>
      {aspsps.error && (
        <p className="text-xs text-destructive">
          {getErrorMessage(aspsps.error, t`Couldn't load banks from Enable Banking`)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!bank || bankLogin.isPending}
          onClick={() => bank && bankLogin.login(connection, bank)}
        >
          {bankLogin.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Landmark className="h-3.5 w-3.5 mr-1.5" />
          )}
          {bankLogin.isPending ? (
            <Trans>Waiting for your bank…</Trans>
          ) : (
            <Trans>Continue to bank login</Trans>
          )}
        </Button>
        {bankLogin.isPending && (
          <Button size="sm" variant="ghost" onClick={bankLogin.cancel}>
            <Trans>Cancel</Trans>
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        <Trans>
          You'll log in at your bank and come back here. Banks grant access for up to 180 days, and
          Budgero reminds you a week before that access expires.
        </Trans>
      </p>
    </div>
  );
}

export function EnableBankingBanksCard({ connection }: { connection: BankConnection }) {
  const { t } = useLingui();
  const config = parseEnableBankingConfig(connection);
  const bankLogin = useBankLogin();
  const remove = useRemoveBankSession();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EnableBankingSession | null>(null);
  const sessions = config?.sessions ?? [];
  const showForm = adding || sessions.length === 0;

  const reconnect = (session: EnableBankingSession) =>
    bankLogin.login(connection, {
      name: session.aspsp.name,
      country: session.aspsp.country,
      logo: session.aspsp.logo,
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">
          <Trans>Banks</Trans>
        </CardTitle>
        {sessions.length > 0 && !adding && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            <Trans>Add bank</Trans>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.length > 0 && (
          <ul className="divide-y rounded-md border">
            {sessions.map((session) => {
              const expired = isSessionExpired(session.validUntil);
              const soon = !expired && sessionExpiresSoon(session);
              const until = formatRelativeToNow(new Date(session.validUntil), { addSuffix: true });
              return (
                <li key={session.sessionId} className="flex items-center gap-3 px-3 py-2.5">
                  <BankLogo src={session.aspsp.logo} className="h-7 w-7" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{session.aspsp.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {session.aspsp.country}
                      </span>
                      {expired && (
                        <Badge variant="destructive" className="text-[10px]">
                          <Trans>Expired</Trans>
                        </Badge>
                      )}
                    </div>
                    <div
                      className={
                        expired || soon ? 'text-xs text-amber-600' : 'text-xs text-muted-foreground'
                      }
                    >
                      {expired ? (
                        <Trans>Access ended {until}. Reconnect to keep syncing.</Trans>
                      ) : (
                        <Trans>Access expires {until}</Trans>
                      )}
                      {' · '}
                      <Trans>{session.accounts.length} accounts</Trans>
                    </div>
                  </div>
                  {(expired || soon) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={bankLogin.isPending}
                      onClick={() => reconnect(session)}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      <Trans>Reconnect</Trans>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={t`Remove ${session.aspsp.name}`}
                    onClick={() => setRemoving(session)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {sessions.some((s) => s.accounts.length === 0) && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              <Trans>
                A bank returned no accounts. In the{' '}
                <a
                  href={ENABLE_BANKING_CONTROL_PANEL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  control panel
                </a>
                , link those accounts to your app, then reconnect the bank.
              </Trans>
            </span>
          </p>
        )}

        {showForm && <AddBankForm connection={connection} onConnected={() => setAdding(false)} />}
        {adding && sessions.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            <Trans>Cancel</Trans>
          </Button>
        )}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t`Remove ${removing?.aspsp.name ?? ''}?`}
        description={t`Budgero stops syncing this bank and revokes its access at Enable Banking. Links stay, so reconnecting the bank later picks up where it left off. Imported transactions stay.`}
        confirmText={t`Remove`}
        variant="destructive"
        isLoading={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync({ connection, sessionId: removing.sessionId });
          setRemoving(null);
        }}
      />
    </Card>
  );
}
