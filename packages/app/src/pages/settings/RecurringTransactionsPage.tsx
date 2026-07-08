import { RecurringTransactionsSection } from '@pages/settings/recurring/RecurringTransactionsSection';

export default function RecurringTransactionsPage() {
  return (
    <div className="space-y-6 px-4 pb-16 pt-4 sm:px-6 sm:pb-20 sm:pt-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Recurring Transactions</h1>
        <p className="text-muted-foreground">
          Set up recurring transactions to automatically create entries on a schedule.
        </p>
      </header>

      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <RecurringTransactionsSection />
      </div>
    </div>
  );
}
