import { Trans, useLingui } from '@lingui/react/macro';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  History,
  RefreshCw,
  SkipForward,
  Zap,
  Coins,
  FileText,
  Search,
  TrendingDown,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

/** A goal type tile in the goals card. */
export function GoalKind({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 leading-tight">{label}</span>
    </span>
  );
}

/** A prebuilt report tile in the reports card. */
export function ReportTile({
  icon: Icon,
  label,
  question,
}: {
  icon: LucideIcon;
  label: string;
  question: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        {label}
      </span>
      <span className="text-[11px] leading-tight text-muted-foreground">{question}</span>
    </span>
  );
}

/** The register search with a typed query and the filters it turns into. */
export function SearchVisual() {
  const { t, i18n } = useLingui();
  const amount = i18n.number(50, { minimumFractionDigits: 0 });
  return (
    <div className="space-y-1.5 rounded-md border bg-card px-2.5 py-2">
      <div className="flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs text-foreground">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-mono">last month outflows over 50</span>
      </div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-700 dark:text-blue-300">
          <CalendarDays className="h-3 w-3" aria-hidden />
          <Trans>Last month</Trans>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-orange-700 dark:text-orange-300">
          <TrendingDown className="h-3 w-3" aria-hidden />
          {/* The app shows this chip in English too (SearchActiveFilters). */}
          Outflows
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-800 dark:text-yellow-300">
          <Coins className="h-3 w-3" aria-hidden />
          {t`Over`} {amount}
        </span>
      </div>
    </div>
  );
}

const FILE_TYPES = ['CSV', 'OFX', 'QFX', 'QIF', 'CAMT.053', 'PDF'];

/** The file types the importer reads. */
export function FileTypesVisual() {
  return (
    <div className="flex flex-wrap gap-1">
      {FILE_TYPES.map((type) => (
        <span
          key={type}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 font-mono text-[11px] text-foreground"
        >
          <FileText className="h-3 w-3 text-primary" aria-hidden />
          {type}
        </span>
      ))}
    </div>
  );
}

/** One account named in the file, sent to an account of the user's. */
export function AccountRouteVisual() {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <span className="min-w-0 truncate font-mono text-muted-foreground">DE89 3704 •••• 3000</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="ml-auto shrink-0 rounded border bg-background px-2 py-0.5 font-medium">
        <Trans>Checking</Trans>
      </span>
    </div>
  );
}

/** The review step's row statuses. */
export function ImportStatusVisual() {
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
        <Trans>New</Trans>
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
        <Trans>Already imported</Trans>
      </span>
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-800 dark:text-amber-300">
        <Trans>Needs review</Trans>
      </span>
    </div>
  );
}

/** An Import History row with its Undo button. */
export function ImportHistoryVisual() {
  const { i18n } = useLingui();
  const rows = i18n.number(42);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        statement.ofx · <Trans>{rows} transactions</Trans>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded border bg-background px-2 py-0.5 font-medium">
        <Undo2 className="h-3 w-3" aria-hidden />
        <Trans>Undo</Trans>
      </span>
    </div>
  );
}

/** On-budget and off-budget account groups, as in the account lists. */
export function BudgetAccountsVisual() {
  return (
    <div className="grid grid-cols-2 gap-1.5 text-xs">
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="font-medium">
          <Trans>On Budget</Trans>
        </div>
        <div className="truncate text-muted-foreground">
          <Trans>Checking</Trans> · <Trans>Savings</Trans>
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="font-medium">
          <Trans>Off Budget</Trans>
        </div>
        <div className="truncate text-muted-foreground">
          <Trans>Mortgage</Trans> · <Trans>Investment</Trans>
        </div>
      </div>
    </div>
  );
}

/** The register's date range with the two future presets. */
export function DateRangeVisual() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-2.5 py-2 text-xs">
      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {/* The picker shows these presets in English in every language. */}
      <span className="rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground">
        Next 30 days
      </span>
      <span className="rounded border px-2 py-0.5 text-muted-foreground">Next 3 months</span>
    </div>
  );
}

/** A rule: one condition, one action. */
export function RuleVisual() {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <span className="min-w-0 truncate">
        <Trans>Payee</Trans> <span className="text-muted-foreground">contains</span>{' '}
        <span className="font-mono">Lidl</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="ml-auto shrink-0 rounded border bg-background px-2 py-0.5 font-medium">
        <Trans>Groceries</Trans>
      </span>
    </div>
  );
}

/** Where continuous rules run by themselves. */
export function RuleTriggersVisual() {
  const { t } = useLingui();
  const triggers = [t`Add Transaction`, t`Imports`, t`Bank sync`, t`Recurring`];
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      {triggers.map((label) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5"
        >
          <Zap className="h-3 w-3 text-primary" aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

/** A rule's run history entry with its undo button. */
export function RuleRunVisual() {
  const { i18n } = useLingui();
  const count = i18n.number(12);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <History className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <Trans>{count} transactions updated.</Trans>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded border bg-background px-2 py-0.5 font-medium">
        <Undo2 className="h-3 w-3" aria-hidden />
        <Trans>Undo changes</Trans>
      </span>
    </div>
  );
}

/** A recurring template row. */
export function RecurringRowVisual() {
  const { i18n } = useLingui();
  const amount = i18n.number(-950, { minimumFractionDigits: 0 });
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <RefreshCw className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          <Trans>Rent</Trans>
        </span>{' '}
        · <Trans>Monthly</Trans>
      </span>
      <span className="shrink-0 tabular-nums">{amount}</span>
    </div>
  );
}

/** The three things to do with an upcoming occurrence. */
export function OccurrenceActionsVisual() {
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      <span className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 font-medium">
        <CalendarCheck className="h-3 w-3" aria-hidden />
        <Trans>Mark ready</Trans>
      </span>
      <span className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 font-medium">
        <Zap className="h-3 w-3" aria-hidden />
        <Trans>Post now</Trans>
      </span>
      <span className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-muted-foreground">
        <SkipForward className="h-3 w-3" aria-hidden />
        <Trans>Skip</Trans>
      </span>
    </div>
  );
}
