import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import { convertScaled } from '@budgero/core/browser';
import {
  useTransferRateDetails,
  useUpdateTransferAmounts,
  useUpdateTransferRate,
} from '@entities/transaction/api/useTransactions';
import { formatNativeAmount } from '@entities/currency/lib/currency-utils';
import {
  formatExchangeRate,
  isUnusualExchangeRateChange,
  validateExchangeRateConversions,
} from '@entities/currency/lib/exchange-rate-format';
import { usePlainNumberFormatter } from '@shared/hooks/useNumberFormatter';
import { asMilli } from '@shared/lib/currency/milli';
import { useUiStore } from '@shared/store/useUiStore';
import { Button } from '@shared/ui/button';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Spinner } from '@shared/ui/spinner';
import { calculateImpliedTransferRate } from '../add-transaction/add-transaction.utils';
import { confirmReconciledEdit } from '../reconciled-edit/reconciled-edit-confirm';

interface TransferRateDialogProps {
  transferId: string;
  compact?: boolean;
}

/** Native amounts typed in the dialog (each in its account currency's scale). */
interface EditedAmounts {
  sent: number;
  received: number;
}

export function TransferRateDialog({ transferId, compact = false }: TransferRateDialogProps) {
  const { t } = useLingui();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const numberFormatter = usePlainNumberFormatter(globalLocalizer);

  const [open, setOpen] = React.useState(false);
  const [rateText, setRateText] = React.useState('');
  const [rateDirty, setRateDirty] = React.useState(false);
  // Set once the user types a sent or received amount: saving then stores
  // both amounts (updateTransferAmounts) instead of only the rate.
  const [amounts, setAmounts] = React.useState<EditedAmounts | null>(null);
  const initializedTransfer = React.useRef<string | null>(null);
  // A cancelled "reconciled" question keeps this dialog open with the edits.
  const keepOpen = React.useRef(false);
  const { data: details, isLoading } = useTransferRateDetails(open ? transferId : null);
  const updateRate = useUpdateTransferRate();
  const updateAmounts = useUpdateTransferAmounts();

  const dirty = rateDirty || amounts !== null;
  React.useEffect(() => {
    if (!open) {
      initializedTransfer.current = null;
      setRateText('');
      setRateDirty(false);
      setAmounts(null);
    } else if (details && (initializedTransfer.current !== details.transferId || !dirty)) {
      initializedTransfer.current = details.transferId;
      setRateText(String(details.rate));
    }
  }, [details, open, dirty]);

  const isCrossCurrency =
    Boolean(details) && details?.source.currency !== details?.destination.currency;
  const sentAmount = amounts?.sent ?? details?.source.amount ?? 0;
  const parsedRate = Number.parseFloat(rateText.replace(',', '.'));
  const rateUsable = Number.isFinite(parsedRate) && parsedRate > 0;
  // Received follows the rate once the rate is edited (the sent amount is the anchor).
  const receivedAmount =
    amounts?.received ??
    (rateDirty && rateUsable && details
      ? convertScaled(sentAmount, parsedRate, details.source.currency, details.destination.currency)
      : (details?.destination.amount ?? 0));

  const rateSafetyError =
    details && rateUsable
      ? validateExchangeRateConversions(parsedRate, [
          {
            amount: sentAmount,
            fromCurrency: details.source.currency,
            toCurrency: details.destination.currency,
          },
        ])
      : null;
  const amountsValid = sentAmount > 0 && receivedAmount > 0;
  const validRate = rateUsable && !rateSafetyError && amountsValid;
  const unusualRate =
    Boolean(details) && validRate && isUnusualExchangeRateChange(details?.rate ?? 0, parsedRate);

  /** A typed amount: the rate shown follows the two amounts. */
  const editAmount = (side: keyof EditedAmounts, value: number) => {
    if (!details || value <= 0) return;
    const next = { sent: sentAmount, received: receivedAmount, [side]: value };
    setAmounts(next);
    const implied = calculateImpliedTransferRate({
      sourceAmount: next.sent,
      receivedAmount: next.received,
      sourceCurrency: details.source.currency,
      destinationCurrency: details.destination.currency,
    });
    if (implied) setRateText(String(implied));
    setRateDirty(false);
  };

  /** A typed rate: the received amount follows it (sent stays). */
  const editRate = (text: string) => {
    setRateDirty(true);
    setRateText(text);
    const rate = Number.parseFloat(text.replace(',', '.'));
    if (amounts && details && Number.isFinite(rate) && rate > 0) {
      setAmounts({
        sent: amounts.sent,
        received: convertScaled(
          amounts.sent,
          rate,
          details.source.currency,
          details.destination.currency
        ),
      });
    }
  };

  const handleConfirm = async () => {
    if (!details || !validRate) return;
    // A reconciled side whose amount the save changes asks first (it becomes uncleared).
    const unlocks =
      (details.source.reconciled && sentAmount !== details.source.amount) ||
      (details.destination.reconciled && receivedAmount !== details.destination.amount);
    if (unlocks && !(await confirmReconciledEdit('transfer'))) {
      keepOpen.current = true;
      return;
    }
    if (amounts) {
      await updateAmounts.mutateAsync({
        transferId,
        sentAmount: amounts.sent,
        receivedAmount: amounts.received,
      });
      toast.success(t`Transfer amounts updated`, {
        description: `${formatNativeAmount(amounts.sent, details.source.currency)} ${details.source.currency} → ${formatNativeAmount(amounts.received, details.destination.currency)} ${details.destination.currency}`,
      });
      return;
    }
    await updateRate.mutateAsync({ transferId, rate: parsedRate });
    toast.success(t`Transfer rate updated`, {
      description: `1 ${details.source.currency} = ${formatExchangeRate(parsedRate)} ${details.destination.currency}`,
    });
  };

  const amountCell = (
    side: keyof EditedAmounts,
    amount: number,
    currency: string,
    testId: string
  ) =>
    isCrossCurrency ? (
      <CalculatorCell
        value={asMilli(amount)}
        currencyCode={currency}
        onCommit={(value) => editAmount(side, value)}
        formatter={numberFormatter.format}
        localizer={numberFormatter}
        inputAlign={side === 'sent' ? 'left' : 'right'}
        inputClassName={side === 'sent' ? 'h-8 font-mono' : 'h-8 font-mono text-right'}
        displayClassName={
          side === 'sent'
            ? 'rounded-md border bg-background px-2 py-1 text-left font-mono font-medium'
            : 'rounded-md border bg-background px-2 py-1 text-right font-mono font-medium'
        }
        data-testid={testId}
      />
    ) : (
      <p className="font-mono font-medium">
        {formatNativeAmount(amount, currency)} {currency}
      </p>
    );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={compact ? 'h-7 px-2 text-xs shrink-0' : 'h-8 px-2.5 text-xs'}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Trans>
          <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />
          Transfer rate
        </Trans>
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && keepOpen.current) {
            keepOpen.current = false;
            return;
          }
          setOpen(next);
        }}
        title={t`Transfer rate`}
        description={t`Inspect or edit the direct rate between the two accounts. Budget rates are shown separately below.`}
        confirmText={amounts ? t`Save amounts` : t`Save rate`}
        loadingText="Saving..."
        isLoading={updateRate.isPending || updateAmounts.isPending}
        confirmDisabled={!details || !isCrossCurrency || !validRate || isLoading}
        onConfirm={handleConfirm}
      >
        {isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : details ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border bg-muted/20 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">
                  <Trans>Sent from {details.source.accountName}</Trans>
                  {isCrossCurrency && ` (${details.source.currency})`}
                </p>
                {amountCell('sent', sentAmount, details.source.currency, 'transfer-sent-amount')}
              </div>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  <Trans>Received in {details.destination.accountName}</Trans>
                  {isCrossCurrency && ` (${details.destination.currency})`}
                </p>
                {amountCell(
                  'received',
                  receivedAmount,
                  details.destination.currency,
                  'transfer-received-amount'
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`transfer-rate-${transferId}`}>
                <Trans>1 {details.source.currency} equals</Trans>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`transfer-rate-${transferId}`}
                  type="text"
                  inputMode="decimal"
                  value={rateText}
                  onChange={(event) => editRate(event.target.value)}
                  className="font-mono"
                  aria-invalid={!validRate}
                  disabled={!isCrossCurrency}
                />
                <span className="text-sm font-medium">{details.destination.currency}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {isCrossCurrency
                  ? t`Enter the amounts from your bank statements and the rate follows, or change the rate to recalculate the received amount. Saving updates both accounts and their budget valuations together.`
                  : t`Both accounts use the same currency, so this transfer has no conversion rate.`}
              </p>
              {rateSafetyError && <p className="text-xs text-destructive">{rateSafetyError}</p>}
              {unusualRate && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <Trans>
                    This is over 1,000× different from the current rate. Check the decimal point
                    before confirming.
                  </Trans>
                </p>
              )}
            </div>

            <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">
                <Trans>Budget valuation</Trans>
              </p>
              <p>
                1 {details.source.currency} ={' '}
                {details.source.budgetRate == null
                  ? '1'
                  : formatExchangeRate(details.source.budgetRate)}{' '}
                {details.budgetCurrency}
              </p>
              <p>
                1 {details.destination.currency} ={' '}
                {details.destination.budgetRate == null
                  ? '1'
                  : formatExchangeRate(details.destination.budgetRate)}{' '}
                {details.budgetCurrency}
              </p>
              {details.transferRateOverride && (
                <p className="pt-1 text-primary">
                  <Trans>The direct transfer rate is manually overridden.</Trans>
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Trans>
              This transfer does not have exactly two linked legs, so its direct rate cannot be
              edited.
            </Trans>
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
