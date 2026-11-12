import { Trans, useLingui } from '@lingui/react/macro';
import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  Flag,
  Landmark,
  Repeat,
  Tag,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { PageGuideId } from '../model/page-guides';
import {
  AccountRouteVisual,
  FileTypesVisual,
  BudgetAccountsVisual,
  DateRangeVisual,
  GoalKind,
  ImportHistoryVisual,
  ImportStatusVisual,
  OccurrenceActionsVisual,
  RecurringRowVisual,
  ReportTile,
  RuleRunVisual,
  RuleTriggersVisual,
  RuleVisual,
  SearchVisual,
} from './guide-visuals';

export interface GuideCard {
  key: string;
  title: string;
  body: ReactNode;
  /** A small picture built from the app's own pieces. */
  visual?: ReactNode;
  /** budgero.app/docs page for more. */
  docs?: string;
}

/** The cards of one guide, in PAGE_GUIDE_CARDS order (a test keeps them equal). */
export function usePageGuideCards(id: PageGuideId): GuideCard[] {
  const { t, i18n } = useLingui();
  const n = (value: number) => i18n.number(value, { minimumFractionDigits: 0 });

  const cards: Record<PageGuideId, GuideCard[]> = {
    budget: [
      {
        key: 'assign',
        title: t`Give every coin a job`,
        body: (
          <Trans>
            Ready to Assign is money you have that has no job yet. Assign it to categories until
            Ready to Assign shows 0, and only budget money you already have.
          </Trans>
        ),
        visual: (
          <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
            <span className="text-xs text-muted-foreground">
              <Trans>Ready to Assign</Trans>
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-emerald-600">
              <CircleCheck className="h-4 w-4" aria-hidden />
              {n(0)}
            </span>
          </div>
        ),
        docs: 'ready-to-assign',
      },
      {
        key: 'columns',
        title: t`Assigned, Activity, Available`,
        body: (
          <Trans>
            Assigned is what you put in a category this month, and Activity is what was spent from
            it. Available is what is left, and it carries over to next month; the arrows by the
            month move between months.
          </Trans>
        ),
        visual: (
          <div className="rounded-md border bg-card px-3 py-2 text-xs tabular-nums">
            <div className="mb-1 truncate font-medium">
              <Trans>Groceries</Trans>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-right">
              <span className="text-muted-foreground">
                <Trans>Assigned</Trans>
              </span>
              <span className="text-muted-foreground">
                <Trans>Activity</Trans>
              </span>
              <span className="text-muted-foreground">
                <Trans>Available</Trans>
              </span>
              <span>{n(300)}</span>
              <span>{n(-120)}</span>
              <span className="font-semibold text-emerald-600">{n(180)}</span>
            </div>
          </div>
        ),
        docs: 'assign-money',
      },
      {
        key: 'goals',
        title: t`Goals`,
        body: (
          <Trans>
            A goal tells a category what it needs. Choose Create Goal under a category (open it with
            the arrow by its name if it is closed): the bar then shows how far along you are, and
            the goal says how much to assign this month.
          </Trans>
        ),
        visual: (
          <div className="grid grid-cols-2 gap-1.5">
            <GoalKind icon={Wallet} label={t`An amount each month`} />
            <GoalKind icon={CalendarClock} label={t`A total by a date`} />
            <GoalKind icon={Repeat} label={t`Every few months`} />
            <GoalKind icon={Flag} label={t`Build up a balance`} />
          </div>
        ),
        docs: 'goals',
      },
      {
        key: 'overspending',
        title: t`Spent too much? Move money`,
        body: (
          <Trans>
            A red Available means a category spent more than it had. Select the red amount to cover
            it from Ready to Assign or from a category that can spare it; select a positive amount
            to move money the other way.
          </Trans>
        ),
        visual: (
          <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs">
            <span className="font-medium">
              <Trans>Dining out</Trans>
            </span>
            <span className="font-semibold tabular-nums text-red-600 underline decoration-dotted underline-offset-2 dark:text-red-300">
              {n(-25)}
            </span>
          </div>
        ),
        docs: 'assign-money',
      },
    ],
    accounts: [
      {
        key: 'add',
        title: t`Add an account`,
        body: (
          <Trans>
            Choose New Account, pick its type and enter its starting balance. Budgero records that
            balance as the account’s first transaction.
          </Trans>
        ),
        docs: 'accounts',
      },
      {
        key: 'budget',
        title: t`On budget or tracked`,
        body: (
          <Trans>
            On-budget accounts, like checking, savings and credit cards, feed Ready to Assign and
            your categories. Off-budget ones, like a mortgage or investments, only count toward net
            worth.
          </Trans>
        ),
        visual: <BudgetAccountsVisual />,
        docs: 'accounts',
      },
      {
        key: 'balances',
        title: t`Balances and net worth`,
        body: (
          <Trans>
            This page groups your accounts by type with their balances, and Net Worth is what you
            own minus what you owe. Open an account to see and add its transactions.
          </Trans>
        ),
      },
      {
        key: 'reconcile',
        title: t`Reconcile now and then`,
        body: (
          <Trans>
            Open an account, choose Reconcile and enter the balance your bank shows. Budgero
            compares it with your cleared balance, can add an adjustment for any difference, and
            locks the cleared transactions.
          </Trans>
        ),
        docs: 'accounts',
      },
    ],
    transactions: [
      {
        key: 'add',
        title: t`Add a transaction`,
        body: (
          <Trans>
            Use Add Transaction (the + on a phone) and choose Expense, Income or Transfer. Give each
            expense a category; use Transfer when money moves between your own accounts, because
            that is not spending.
          </Trans>
        ),
        visual: (
          <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-1 text-center text-xs">
            <span className="rounded px-1 py-1 text-muted-foreground">
              <Trans>Income</Trans>
            </span>
            <span className="rounded bg-background px-1 py-1 font-medium shadow-sm">
              <Trans>Expense</Trans>
            </span>
            <span className="rounded px-1 py-1 text-muted-foreground">
              <Trans>Transfer</Trans>
            </span>
          </div>
        ),
      },
      {
        key: 'dates',
        title: t`Pick the dates`,
        body: (
          <Trans>
            The list only shows the date range at the top, the last 180 days to start with. Future
            dated transactions, and an account’s upcoming recurring ones, appear once the range
            reaches their date: pick Next 30 days or Next 3 months to see them.
          </Trans>
        ),
        visual: <DateRangeVisual />,
      },
      {
        key: 'search',
        title: t`Search in plain words`,
        body: (
          <Trans>
            Type in the search box above the list. Words like last month, outflows, uncleared or
            over 50 and a category name become filters (these words are English); anything else is
            looked up in payee, memo, category, label and account.
          </Trans>
        ),
        visual: <SearchVisual />,
        docs: 'semantic-search',
      },
      {
        key: 'cleared',
        title: t`Cleared or not yet`,
        body: (
          <Trans>
            Transactions you add start uncleared; select the circle once your bank shows one
            (imported ones arrive cleared). On an account’s page, the Uncleared and Uncategorized
            buttons under the search show only those.
          </Trans>
        ),
        visual: (
          <div className="flex items-center justify-center gap-4 rounded-md border bg-card px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CircleDashed className="h-4 w-4" aria-hidden />
              <Trans>Uncleared</Trans>
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <span className="flex items-center gap-1.5 text-success">
              <CircleCheck className="h-4 w-4" aria-hidden />
              <Trans>Cleared</Trans>
            </span>
          </div>
        ),
        docs: 'accounts',
      },
    ],
    rules: [
      {
        key: 'what',
        title: t`What a rule does`,
        body: (
          <Trans>
            A rule checks a transaction against conditions on memo, payee, amount or account, joined
            with AND or OR, then runs its actions, such as Set category or Set payee. Choose New
            rule to make one; when several rules match, the lower run order goes first.
          </Trans>
        ),
        visual: <RuleVisual />,
        docs: 'rules-engine',
      },
      {
        key: 'when',
        title: t`When rules run`,
        body: (
          <Trans>
            Continuous rules run by themselves on every new transaction: added by hand, imported,
            synced from your bank, pushed or posted from a recurring one. Autofill rules only
            suggest values while you fill in a transaction.
          </Trans>
        ),
        visual: <RuleTriggersVisual />,
      },
      {
        key: 'existing',
        title: t`Run on what you already have`,
        body: (
          <Trans>
            Run now and Retro run apply a rule to every transaction in the budget, and Retro run
            asks first. There is no preview, so check the conditions before you run it; a One time
            rule is done after its first run.
          </Trans>
        ),
      },
      {
        key: 'undo',
        title: t`Undo a run`,
        body: (
          <Trans>
            Open the rule’s History, pick its latest run and choose Undo changes: the transactions
            go back to how they were.
          </Trans>
        ),
        visual: <RuleRunVisual />,
      },
    ],
    recurring: [
      {
        key: 'what',
        title: t`Bills and pay on a schedule`,
        body: (
          <Trans>
            Choose New recurring transaction, or switch on Make recurring while adding a
            transaction, and pick how often it comes. Nothing is posted by itself: you decide each
            time.
          </Trans>
        ),
        visual: <RecurringRowVisual />,
        docs: 'recurring-transactions',
      },
      {
        key: 'register',
        title: t`Where they show up`,
        body: (
          <Trans>
            Each upcoming one appears in its account’s register once the date range at the top
            reaches its due date: pick Next 30 days or Next 3 months there. The dashboard’s Upcoming
            transactions card lists them too.
          </Trans>
        ),
        visual: <DateRangeVisual />,
      },
      {
        key: 'actions',
        title: t`Post it or skip it`,
        body: (
          <Trans>
            Mark ready posts it on its due date, Post now posts it today, and Skip leaves this one
            out. You find them on each upcoming one here and in the register.
          </Trans>
        ),
        visual: <OccurrenceActionsVisual />,
      },
    ],
    reports: [
      {
        key: 'questions',
        title: t`Reports answer questions`,
        body: (
          <Trans>
            The prebuilt reports answer common questions, such as where your money goes. Questions
            you save show up here too, and Dashboards put several of them side by side.
          </Trans>
        ),
        visual: (
          <div className="grid grid-cols-2 gap-1.5">
            <ReportTile icon={Landmark} label={t`Wealth`} question={t`Is my net worth growing?`} />
            <ReportTile icon={Tag} label={t`Spending`} question={t`Where does my money go?`} />
          </div>
        ),
      },
      {
        key: 'build',
        title: t`Ask your own question`,
        body: (
          <Trans>
            Choose New question, pick the data (for example Transactions), then add filters and a
            summary such as spending by category. Save it, and Add to dashboard puts it on a
            dashboard.
          </Trans>
        ),
      },
      {
        key: 'drill',
        title: t`Look inside a number`,
        body: (
          <Trans>
            In a question, select a bar, slice or table value to see those transactions, zoom in by
            month or break it down further. In the Ledger report, select an amount to list its
            transactions.
          </Trans>
        ),
      },
    ],
    home: [
      {
        key: 'overview',
        title: t`Your money at a glance`,
        body: (
          <Trans>
            Cash Balance adds up your checking, savings and cash, and At a glance shows this month’s
            income, spending and what is left to assign. The period buttons set the range the charts
            cover.
          </Trans>
        ),
      },
      {
        key: 'attention',
        title: t`What needs you`,
        body: (
          <Trans>
            Overspent categories, upcoming transactions and transactions that need a category are
            listed here, so you can deal with them in one place.
          </Trans>
        ),
      },
      {
        key: 'yours',
        title: t`Make it yours`,
        body: (
          <Trans>
            Choose Customize to add, move, resize or remove cards; Reset to default in the ⋯ menu
            brings the original back. To open Budgero on another page, change Default Home in
            Settings → Appearance.
          </Trans>
        ),
      },
    ],
    imports: [
      {
        key: 'files',
        title: t`Bring in a file from your bank`,
        body: (
          <Trans>
            Choose Select File under New Import, or drop the file anywhere in Budgero on a computer.
            No export to hand? The upload step links a spreadsheet and a CSV template.
          </Trans>
        ),
        visual: <FileTypesVisual />,
        docs: 'csv-import',
      },
      {
        key: 'accounts',
        title: t`Columns and accounts`,
        body: (
          <Trans>
            Map a date column and an amount (or inflow and outflow) column; payee, memo, category
            and account are optional. If the file names its accounts, Accounts in this file sends
            each one to an account you have, a new account, or Don’t import.
          </Trans>
        ),
        visual: <AccountRouteVisual />,
      },
      {
        key: 'duplicates',
        title: t`Check before anything is added`,
        body: (
          <Trans>
            Each row shows as New, Already imported or Needs review. Match keeps your own
            transaction and marks it cleared, Skip leaves the row out, and the rest are added as
            cleared transactions.
          </Trans>
        ),
        visual: <ImportStatusVisual />,
        docs: 'csv-import',
      },
      {
        key: 'undo',
        title: t`Changed your mind?`,
        body: (
          <Trans>
            Right after an import, undo (Ctrl+Z or ⌘Z, or the undo arrow on a phone) reverts all of
            it. Later, Undo in Import History removes the imported transactions and any empty
            accounts or categories the import created.
          </Trans>
        ),
        visual: <ImportHistoryVisual />,
      },
    ],
  };

  return cards[id];
}
