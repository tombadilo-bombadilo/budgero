import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  parseBankFeedSettings,
  type BankDateField,
  type BankFeedSettings,
  type BankLink,
  type BankMemoField,
  type BankPayeeField,
  type BankProvider,
} from '@budgero/core/browser';
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
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Switch } from '@shared/ui/switch';
import { useUpdateBankFeedSettings } from '../api/useBankSync';

interface BankFeedSettingsDialogProps {
  link: BankLink;
  provider: BankProvider;
  accountName: string;
  onOpenChange: (open: boolean) => void;
}

/** How one linked account's bank rows become transactions. */
export function BankFeedSettingsDialog({
  link,
  provider,
  accountName,
  onOpenChange,
}: BankFeedSettingsDialogProps) {
  const { t } = useLingui();
  const [settings, setSettings] = useState<BankFeedSettings>(() => parseBankFeedSettings(link));
  const save = useUpdateBankFeedSettings();
  const set = <K extends keyof BankFeedSettings>(key: K, value: BankFeedSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const submit = () =>
    save.mutate(
      { budgetId: link.BudgetID, accountId: link.AccountID, settings },
      {
        onSuccess: () => {
          toast.success(t`Bank feed settings saved`);
          onOpenChange(false);
        },
        onError: (error) => toast.error(getErrorMessage(error, t`Couldn't save the settings`)),
      }
    );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Bank feed settings</Trans>
          </DialogTitle>
          <DialogDescription>
            {accountName} · {link.ExternalName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="feed-pending">
                <Trans>Import pending transactions</Trans>
              </Label>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  They arrive uncleared and are updated once your bank books them. Pending
                  transactions your bank drops, like a released card hold, are removed.
                </Trans>
              </p>
            </div>
            <Switch
              id="feed-pending"
              checked={settings.importPending}
              onCheckedChange={(checked) => set('importPending', checked)}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="feed-tidy">
                <Trans>Tidy ALL-CAPS payee names</Trans>
              </Label>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  "K-MARKET KAMPPI" becomes "K-Market Kamppi". Names with lowercase letters stay as
                  they are.
                </Trans>
              </p>
            </div>
            <Switch
              id="feed-tidy"
              checked={settings.tidyPayees}
              onCheckedChange={(checked) => set('tidyPayees', checked)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              <Trans>Date</Trans>
            </Label>
            <Select
              value={settings.date}
              onValueChange={(value) => set('date', value as BankDateField)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <Trans>Automatic</Trans>
                </SelectItem>
                <SelectItem value="transaction">
                  <Trans>Purchase date (when you paid)</Trans>
                </SelectItem>
                <SelectItem value="booking">
                  <Trans>Booking date (when the bank recorded it)</Trans>
                </SelectItem>
                {provider === 'enablebanking' && (
                  <SelectItem value="value">
                    <Trans>Value date (when the money moved)</Trans>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              <Trans>Payee</Trans>
            </Label>
            <Select
              value={settings.payee}
              onValueChange={(value) => set('payee', value as BankPayeeField)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <Trans>Automatic</Trans>
                </SelectItem>
                <SelectItem value="counterparty">
                  <Trans>Merchant or counterparty name</Trans>
                </SelectItem>
                <SelectItem value="description">
                  <Trans>Description</Trans>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              <Trans>Memo</Trans>
            </Label>
            <Select
              value={settings.memo}
              onValueChange={(value) => set('memo', value as BankMemoField)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <Trans>Automatic</Trans>
                </SelectItem>
                <SelectItem value="description">
                  <Trans>Description</Trans>
                </SelectItem>
                <SelectItem value="counterparty">
                  <Trans>Merchant or counterparty name</Trans>
                </SelectItem>
                <SelectItem value="none">
                  <Trans>Leave empty</Trans>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-[0.6875rem] text-muted-foreground">
            <Trans>
              Changes apply to transactions imported from now on. If a field you pick is missing for
              a transaction, Budgero uses the automatic choice.
            </Trans>
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            <Trans>Save</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
