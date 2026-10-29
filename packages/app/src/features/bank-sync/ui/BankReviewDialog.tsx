import { Trans, useLingui } from '@lingui/react/macro';
import { toast } from 'sonner';
import type { Account, BankReview } from '@budgero/core/browser';
import { useAccounts } from '@entities/account/api/useAccounts';
import { getErrorMessage } from '@shared/lib/errors';
import { formatShortDate, parseDateKey } from '@shared/lib/date-utils';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { useBankReviews, useResolveBankReview, type ReviewAction } from '../api/useBankSync';
import { formatSignedIdentity } from '../lib/format';

interface BankReviewDialogProps {
  budgetId: number;
  accountId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Row({
  label,
  date,
  payee,
  amount,
}: {
  label: string;
  date: string;
  payee: string;
  amount: string;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_5.5rem_1fr_auto] items-baseline gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        {formatShortDate(parseDateKey(date) ?? new Date(date), { hideCurrentYear: true })}
      </span>
      <span className="truncate">{payee || '—'}</span>
      <span className="tabular-nums font-medium">{amount}</span>
    </div>
  );
}

function ReviewItem({ review, account }: { review: BankReview; account: Account | undefined }) {
  const { t } = useLingui();
  const resolve = useResolveBankReview();
  const currency = account?.Currency ?? review.identity.currency;
  const act = (action: ReviewAction) =>
    resolve.mutate(
      { review, action },
      { onError: (error) => toast.error(getErrorMessage(error, t`Couldn't resolve this match`)) }
    );
  return (
    <div className="rounded-md border p-2.5 space-y-1.5">
      {account && (
        <div className="text-[11px] font-medium text-muted-foreground">{account.Name}</div>
      )}
      <Row
        label={review.identity.sourceKey === 'push-api' ? t`Push API` : t`Bank`}
        date={review.identity.date}
        payee={review.identity.payee}
        amount={formatSignedIdentity(review.identity, currency)}
      />
      {review.candidate && (
        <Row
          label={t`Budgero`}
          date={review.candidate.date}
          payee={review.candidate.payee}
          amount={formatSignedIdentity(review.candidate, currency)}
        />
      )}
      <div className="flex justify-end gap-1.5 pt-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={resolve.isPending}
          onClick={() => act('dismiss')}
        >
          <Trans>Skip</Trans>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={resolve.isPending}
          onClick={() => act('import')}
        >
          <Trans>Add as new</Trans>
        </Button>
        {review.candidate && (
          <Button size="sm" disabled={resolve.isPending} onClick={() => act('match')}>
            <Trans>Match</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}

export function BankReviewDialog({
  budgetId,
  accountId,
  open,
  onOpenChange,
}: BankReviewDialogProps) {
  const { data: reviews = [] } = useBankReviews(budgetId, accountId);
  const { data: accounts = [] } = useAccounts(budgetId);
  const byId = new Map(accounts.map((account) => [account.ID, account]));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Review possible matches</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              These incoming transactions look like ones you already entered. Match them to mark
              your entry as cleared, or add them as new transactions.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              <Trans>Nothing left to review.</Trans>
            </p>
          ) : (
            reviews.map((review) => (
              <ReviewItem key={review.ID} review={review} account={byId.get(review.AccountID)} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
