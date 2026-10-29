import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@shared/lib/errors';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { useBankLinks, useBankReviews, useRunBankSync } from '../api/useBankSync';
import { formatBankAmount, formatSyncedAgo } from '../lib/format';
import { BankReviewDialog } from './BankReviewDialog';

interface BankSyncButtonProps {
  budgetId: number;
  accountId: number;
  currency: string;
}

export function BankSyncButton({ budgetId, accountId, currency }: BankSyncButtonProps) {
  const { t } = useLingui();
  const [reviewOpen, setReviewOpen] = useState(false);
  const { data: links = [] } = useBankLinks(budgetId);
  const { data: reviews = [] } = useBankReviews(budgetId, accountId);
  const sync = useRunBankSync();
  const link = links.find((candidate) => candidate.AccountID === accountId);
  const reviewBadge = reviews.length > 0 && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs text-amber-600 border-amber-600/40"
      onClick={() => setReviewOpen(true)}
    >
      <Trans>{reviews.length} to review</Trans>
    </Button>
  );
  // Push API matches land in the same review list, also on accounts with no bank link.
  if (!link) {
    if (!reviewBadge) return null;
    return (
      <div className="flex items-center gap-1">
        {reviewBadge}
        <BankReviewDialog
          budgetId={budgetId}
          accountId={accountId}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
        />
      </div>
    );
  }

  const syncedAgo = formatSyncedAgo(link.LastSyncAt);
  const onSync = () =>
    sync.mutate(
      { budgetId, providers: [link.Provider] },
      {
        onSuccess: (result) => {
          if (result.errors.length) toast.warning(result.errors.join('\n'));
          else if (result.imported) {
            toast.success(
              plural(result.imported, {
                one: 'Imported # bank transaction',
                other: 'Imported # bank transactions',
              })
            );
          } else if (!result.reviews) toast.success(t`Up to date`);
          if (result.reviews) setReviewOpen(true);
        },
        onError: (error) => toast.error(getErrorMessage(error, t`Bank sync failed`)),
      }
    );

  return (
    <div className="flex items-center gap-1">
      {reviewBadge}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={sync.isPending}
            onClick={onSync}
            aria-label={t`Sync with bank`}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-0.5">
            <div>
              {syncedAgo ? <Trans>Bank synced {syncedAgo}</Trans> : <Trans>Not synced yet</Trans>}
            </div>
            {link.LastBalance !== null && (
              <div className="text-muted-foreground">
                <Trans>Bank balance {formatBankAmount(link.LastBalance, currency)}</Trans>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
      <BankReviewDialog
        budgetId={budgetId}
        accountId={accountId}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
      />
    </div>
  );
}
