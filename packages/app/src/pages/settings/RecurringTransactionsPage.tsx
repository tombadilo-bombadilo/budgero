import { Trans } from '@lingui/react/macro';
import { RecurringTransactionsSection } from '@pages/settings/recurring/RecurringTransactionsSection';

export default function RecurringTransactionsPage() {
  return (
    <div className="space-y-6 px-4 pb-16 pt-4 sm:px-6 sm:pb-20 sm:pt-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          <Trans>Recurring Transactions</Trans>
        </h1>
        <p className="text-muted-foreground">
          <Trans>
            Set up transactions that repeat on a schedule. Nothing is posted until you mark it ready
            or post it.
          </Trans>
        </p>
      </header>

      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <RecurringTransactionsSection />
      </div>
    </div>
  );
}
