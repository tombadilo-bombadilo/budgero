import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { isCryptoCurrency, type BankConnection } from '@budgero/core/browser';
import { useAccounts } from '@entities/account/api/useAccounts';
import { ACCOUNT_TYPES, AccountTypeEnum } from '@entities/account/model/accountTypes';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { getErrorMessage } from '@shared/lib/errors';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { DatePickerButton } from '@shared/ui/DatePickerButton';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useLinkBankAccounts } from '../api/useBankSync';
import { providerName, type RemoteBankAccount } from '../lib/provider';
import {
  daysAgo,
  defaultImportFrom,
  guessAccountType,
  isSupportedBankCurrency,
} from '../model/link-accounts';

interface LinkAccountDialogProps {
  budgetId: number;
  connection: BankConnection;
  remote: RemoteBankAccount | null;
  linkedAccountIds: Set<number>;
  onOpenChange: (open: boolean) => void;
}

export function LinkAccountDialog({
  budgetId,
  connection,
  remote,
  linkedAccountIds,
  onOpenChange,
}: LinkAccountDialogProps) {
  const { t, i18n } = useLingui();
  const { data: accounts = [] } = useAccounts(budgetId);
  const link = useLinkBankAccounts();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountTypeEnum>(AccountTypeEnum.CHECKING);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [importFrom, setImportFrom] = useState(daysAgo(30));

  const candidates = useMemo(
    () =>
      accounts.filter(
        (account) =>
          !account.Archived &&
          !linkedAccountIds.has(account.ID) &&
          !isCryptoCurrency(account.Currency) &&
          (!remote ||
            !isSupportedBankCurrency(remote.currency) ||
            account.Currency === remote.currency)
      ),
    [accounts, linkedAccountIds, remote]
  );
  const { data: latest } = useSpaceQuery<string | null>({
    key: ['bankSync', 'latestTransaction', accountId ?? 0],
    enabled: mode === 'existing' && accountId !== null,
    queryFn: (services) => services.bankSync.latestTransactionDate(accountId!),
  });

  useEffect(() => {
    if (!remote) return;
    setMode('new');
    setName(remote.name);
    setType(guessAccountType(remote));
    setAccountId(null);
    setImportFrom(daysAgo(30));
  }, [remote]);

  useEffect(() => {
    if (mode === 'existing' && accountId !== null) setImportFrom(defaultImportFrom(latest));
    if (mode === 'new') setImportFrom(daysAgo(30));
  }, [mode, accountId, latest]);

  if (!remote) return null;
  const provider = providerName(connection);
  const currencySupported = isSupportedBankCurrency(remote.currency);
  const canSubmit =
    !link.isPending &&
    Boolean(importFrom) &&
    importFrom <= daysAgo(0) &&
    (mode === 'existing' ? accountId !== null : currencySupported && name.trim().length > 0);

  const submit = () => {
    link.mutate(
      {
        connection,
        requests: [
          {
            remote,
            importFrom,
            target:
              mode === 'existing'
                ? { kind: 'existing', accountId: accountId! }
                : { kind: 'new', name: name.trim(), type },
          },
        ],
      },
      {
        onSuccess: (result) => {
          toast.success(t`Linked ${remote.name}`, {
            description: result.errors.length ? result.errors.join('\n') : undefined,
          });
          onOpenChange(false);
        },
        onError: (error) => toast.error(getErrorMessage(error, t`Couldn't link this account`)),
      }
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Link {remote.name}</Trans>
          </DialogTitle>
          <DialogDescription>
            {[remote.orgName, remote.currency].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as 'new' | 'existing')}
            className="grid grid-cols-2 gap-2"
          >
            <Label className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer">
              <RadioGroupItem value="new" />
              <Trans>New account</Trans>
            </Label>
            <Label className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer">
              <RadioGroupItem value="existing" disabled={!candidates.length} />
              <Trans>Existing account</Trans>
            </Label>
          </RadioGroup>

          {mode === 'new' ? (
            <>
              {!currencySupported && (
                <p className="text-xs text-destructive">
                  <Trans>
                    This account's currency isn't supported. Link it to an existing account instead.
                  </Trans>
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="bank-link-name">
                  <Trans>Name</Trans>
                </Label>
                <Input id="bank-link-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  <Trans>Type</Trans>
                </Label>
                <Select value={type} onValueChange={(value) => setType(value as AccountTypeEnum)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(AccountTypeEnum)
                      .filter((value) => value !== AccountTypeEnum.CRYPTO)
                      .map((value) => (
                        <SelectItem key={value} value={value}>
                          {i18n._(ACCOUNT_TYPES[value].name)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label>
                <Trans>Budgero account</Trans>
              </Label>
              <Select
                value={accountId === null ? '' : String(accountId)}
                onValueChange={(value) => setAccountId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t`Choose an account`} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((account) => (
                    <SelectItem key={account.ID} value={String(account.ID)}>
                      {account.Name} · {account.Currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              <Trans>Import transactions from</Trans>
            </Label>
            <DatePickerButton
              value={importFrom}
              onChange={(value) => value && setImportFrom(value)}
              disabled={{ after: new Date() }}
              endMonth={new Date()}
            />
            <p className="text-[0.6875rem] text-muted-foreground">
              {mode === 'existing' ? (
                <Trans>
                  Starts the day after your latest entry so nothing is imported twice. Entries close
                  to the bank's will be offered as matches.
                </Trans>
              ) : (
                <Trans>The opening balance is set so the account matches your bank today.</Trans>
              )}{' '}
              <Trans>Older dates only return what your bank shares with {provider}.</Trans>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {link.isPending ? <Trans>Linking…</Trans> : <Trans>Link and import</Trans>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
