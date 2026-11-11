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
import { GoalKind, ReportTile } from './guide-visuals';

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
        key: 'import',
        title: t`Import a file from your bank`,
        body: (
          <Trans>
            Go to Settings → Imports, or drop the file onto the page on a computer. CSV, OFX, QFX,
            QIF, CAMT.053 and PDF statements work, and possible duplicates are shown before anything
            is added.
          </Trans>
        ),
        docs: 'csv-import',
      },
      {
        key: 'cleared',
        title: t`Cleared or not yet`,
        body: (
          <Trans>
            Transactions you add start uncleared. Select the circle once your bank shows the
            transaction; imported ones arrive cleared.
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
  };

  return cards[id];
}
