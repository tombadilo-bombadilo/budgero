/**
 * Small pictures for the guide cards. Each one is a simplified copy of the
 * real control it explains (named above it), built from the same shared
 * components, labels and colours, and never interactive.
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  ArrowDownRight,
  CalendarClock,
  Flag,
  Repeat,
  Wallet,
  ArrowDownUp,
  Calendar,
  CalendarDays,
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Layers2,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { SUPPORTED_IMPORT_FORMATS_LABEL } from '@features/import/lib/constants';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { ImportStatusChip } from '@shared/ui/import-status-chip';

/** A shared Button drawn as a picture: same look, not focusable or clickable. */
function FakeButton({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'asChild'>) {
  return (
    <Button asChild {...props} className={cn('pointer-events-none', className)}>
      <span aria-hidden>{children}</span>
    </Button>
  );
}

/** The step dots on a guide card: the current one wide. */
export function GuideProgress({ count, index }: { count: number; index: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full',
            i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}

/** Goal type list in the goal editor (goal-management/ui/GoalForm.tsx). */
export function GoalKind({
  icon: Icon,
  label,
  description,
}: {
  icon: LucideIcon;
  label: string;
  /** One plain line under the title. */
  description?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold leading-tight text-foreground">{label}</span>
        {description && (
          <span className="block text-[11px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The goal types the way GoalForm lists them: one cadence per line (the start
 * of each type's title), then what Available and Allocation mean.
 */
export function GoalTypesVisual() {
  const { t } = useLingui();
  return (
    <div className="grid gap-1.5">
      <GoalKind
        icon={Wallet}
        label={t`Monthly`}
        description={t`Every month, like rent or groceries.`}
      />
      <GoalKind
        icon={CalendarClock}
        label={t`Yearly`}
        description={t`By a date, like a holiday or a yearly bill.`}
      />
      <GoalKind
        icon={Repeat}
        label={t`Periodic`}
        description={t`Every few months, like a quarterly bill.`}
      />
      <GoalKind
        icon={Flag}
        label={t`Target Balance`}
        description={t`Build up to an amount, no date, like an emergency fund.`}
      />
      <p className="text-[11px] leading-snug text-muted-foreground">
        <Trans>
          The first three come in two kinds. Available: have the amount ready. Allocation: put a set
          amount aside.
        </Trans>
      </p>
    </div>
  );
}

/** Prebuilt report card on the Reports home (pages/reports/ReportsHomePage.tsx). */
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
    <span className="flex min-w-0 items-start gap-2 rounded-lg border bg-card p-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium leading-snug">{question}</span>
        <span className="block text-[11px] leading-tight text-muted-foreground">{label}</span>
      </span>
    </span>
  );
}

/**
 * Register search and the filters it turns into
 * (transactions/ui/TransactionsToolbar.tsx, SearchActiveFilters.tsx).
 */
export function SearchVisual() {
  const { t, i18n } = useLingui();
  const amount = i18n.number(50, { minimumFractionDigits: 0 });
  const chip = 'flex items-center gap-1.5 pr-1 text-xs font-medium';
  return (
    <div className="space-y-2" aria-hidden>
      <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">last month outflows over 50</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(chip, 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300')}
        >
          <Calendar className="h-3 w-3" />
          <Trans>Last month</Trans>
          <X className="h-3 w-3" />
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            chip,
            'border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-300'
          )}
        >
          <ArrowDownRight className="h-3 w-3" />
          {/* The app shows this chip in English too (SearchActiveFilters). */}
          Outflows
          <X className="h-3 w-3" />
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            chip,
            'border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
          )}
        >
          <Coins className="h-3 w-3" />
          {t`Over`} {amount}
          <X className="h-3 w-3" />
        </Badge>
      </div>
    </div>
  );
}

/** Upload step: the file field and the formats it takes (import/ui/steps/UploadStep.tsx). */
export function FileTypesVisual() {
  const { t } = useLingui();
  return (
    <div className="space-y-1" aria-hidden>
      <div className="text-xs font-medium text-foreground">
        <Trans>Select File</Trans>
      </div>
      <div className="flex h-8 items-center rounded-md border bg-background px-2.5 text-xs text-muted-foreground">
        <span className="truncate">{t(SUPPORTED_IMPORT_FORMATS_LABEL)}</span>
      </div>
    </div>
  );
}

/** One row of "Accounts in this file" (import/ui/steps/configure/AccountsInFilePanel.tsx). */
export function AccountRouteVisual() {
  const { i18n } = useLingui();
  const count = i18n.number(42);
  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-xs" aria-hidden>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono font-medium">DE89 3704 •••• 3000</div>
        <div className="text-muted-foreground">
          <Trans>{count} transactions</Trans>
        </div>
      </div>
      <span className="flex h-8 w-32 shrink-0 items-center justify-between rounded-md border bg-background px-2.5">
        <Trans>Checking</Trans>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    </div>
  );
}

/** Import row statuses as coloured pills (shared/ui/import-status-chip.tsx). */
export function ImportStatusVisual() {
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      <ImportStatusChip status="new">
        <Trans>New</Trans>
      </ImportStatusChip>
      <ImportStatusChip status="already-imported">
        <Trans>Already imported</Trans>
      </ImportStatusChip>
      <ImportStatusChip status="needs-review">
        <Trans>Needs review</Trans>
      </ImportStatusChip>
    </div>
  );
}

/** An Import History row with its Undo button (pages/settings/ImportsPage.tsx). */
export function ImportHistoryVisual() {
  const { i18n } = useLingui();
  const rows = i18n.number(42);
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate">
        statement.ofx · <Trans>{rows} transactions</Trans>
      </span>
      <FakeButton size="sm" variant="outline">
        <Trans>
          <Undo2 className="h-4 w-4 mr-1" />
          Undo
        </Trans>
      </FakeButton>
    </div>
  );
}

/** On Budget / Off Budget sections of the account list (app/layout/desktop-shell/AccountsList.tsx). */
export function BudgetAccountsVisual() {
  const section = (title: React.ReactNode, names: React.ReactNode[]) => (
    <div className="min-w-0">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {names.map((name, i) => (
        <div key={i} className="truncate rounded px-1 py-0.5 text-xs">
          {name}
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border px-2 py-1.5" aria-hidden>
      {section(<Trans>On Budget</Trans>, [
        <Trans key="c">Checking</Trans>,
        <Trans key="s">Savings</Trans>,
      ])}
      {section(<Trans>Off Budget</Trans>, [
        <Trans key="m">Mortgage</Trans>,
        <Trans key="i">Investment</Trans>,
      ])}
    </div>
  );
}

/** Date range picker: trigger and its preset list (shared/ui/date-range-picker.tsx). */
export function DateRangeVisual() {
  const { i18n } = useLingui();
  const today = new Date();
  const range = `${i18n.date(today, { day: 'numeric', month: 'short' })} – ${i18n.date(
    new Date(today.getTime() + 30 * 86_400_000),
    { day: 'numeric', month: 'short' }
  )}`;
  return (
    <div className="flex items-start gap-2" aria-hidden>
      <FakeButton size="sm" variant="outline" className="text-xs">
        <CalendarDays className="h-4 w-4" />
        {range}
      </FakeButton>
      <div className="flex flex-col rounded-md border p-1 text-xs">
        {/* The picker shows its presets in English in every language. */}
        <span className="rounded px-2 py-1">Last 30 days</span>
        <span className="rounded bg-accent px-2 py-1 text-accent-foreground">Next 30 days</span>
        <span className="rounded px-2 py-1">Next 3 months</span>
      </div>
    </div>
  );
}

/** A rule in the rules list (pages/settings/automation-rules/RuleRow.tsx). */
export function RuleVisual() {
  const rule = { runOrder: 1 };
  const conditionCount = 1;
  const actionCount = 1;
  return (
    <div className="space-y-0.5 rounded-md border px-3 py-2" aria-hidden>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">
          Lidl → <Trans>Groceries</Trans>
        </span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          <Trans>Continuous</Trans>
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Trans>
            <Layers2 className="h-3 w-3" />
            Run order {rule.runOrder}
          </Trans>
        </span>
        <span>
          <Trans>
            {conditionCount} condition(s) · {actionCount} action(s)
          </Trans>
        </span>
      </div>
    </div>
  );
}

/** The rule modes, as the badges in the rules list (RuleRow.tsx). */
export function RuleTriggersVisual() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden>
      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
        <Trans>Continuous</Trans>
      </Badge>
      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
        <Trans>Autofill</Trans>
      </Badge>
      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
        <Trans>One time</Trans>
      </Badge>
    </div>
  );
}

/** The undo box in a rule's run history (features/rules/ui/RuleHistoryDrawer.tsx). */
export function RuleRunVisual() {
  const run = { transactionCount: 12 };
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/40 p-2.5 sm:flex-row sm:items-center sm:justify-between"
      aria-hidden
    >
      <div className="text-xs text-muted-foreground">
        {plural(run.transactionCount, {
          one: 'Restore # transaction to its pre-run values.',
          other: 'Restore # transactions to their pre-run values.',
        })}
      </div>
      <FakeButton size="sm" className="self-start">
        <RotateCcw className="mr-2 h-4 w-4" />
        <Trans>Undo changes</Trans>
      </FakeButton>
    </div>
  );
}

/** A recurring template row (pages/settings/recurring/components/RecurringTemplateCard.tsx). */
export function RecurringRowVisual() {
  const { i18n } = useLingui();
  const amount = i18n.number(-950, { minimumFractionDigits: 0 });
  return (
    <div className="flex items-start gap-2 rounded-md border px-3 py-2" aria-hidden>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm font-medium">
          <Trans>Rent</Trans>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" /> <Trans>Monthly</Trans>
          <Clock className="ml-2 h-3 w-3" />
        </div>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{amount}</span>
    </div>
  );
}

/** An upcoming occurrence with its buttons (recurring/components/RecurringOccurrenceRow.tsx). */
export function OccurrenceActionsVisual() {
  const { i18n } = useLingui();
  const due = i18n.date(new Date(2026, 11, 1), { dateStyle: 'medium' });
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
      aria-hidden
    >
      <span className="text-xs tabular-nums">{due}</span>
      <div className="flex shrink-0 items-center gap-1">
        <FakeButton size="sm" variant="outline" className="h-7 px-2.5 text-xs">
          <Trans>Mark ready</Trans>
        </FakeButton>
        <FakeButton size="sm" variant="outline" className="h-7 px-2.5 text-xs">
          <Trans>Post now</Trans>
        </FakeButton>
        <FakeButton size="sm" variant="ghost" className="h-7 px-2.5 text-xs">
          <Trans>Skip</Trans>
        </FakeButton>
      </div>
    </div>
  );
}

/** Income / Expense / Transfer tabs of the transaction form (form/TransactionTypeSelector.tsx). */
export function TransactionTypeVisual() {
  const tab =
    'flex items-center justify-center rounded-md border border-transparent px-2 py-1.5 text-xs';
  return (
    <div className="grid grid-cols-3 gap-1 p-1" aria-hidden>
      <span className={tab}>
        <span className="mr-1 text-base font-semibold leading-none">+</span>
        <Trans>Income</Trans>
      </span>
      <span
        className={cn(tab, 'border-destructive/20 bg-destructive/10 text-destructive shadow-sm')}
      >
        <span className="mr-1 text-base font-semibold leading-none">−</span>
        <Trans>Expense</Trans>
      </span>
      <span className={tab}>
        <ArrowDownUp className="mr-1 h-3 w-3" />
        <Trans>Transfer</Trans>
      </span>
    </div>
  );
}

/** A workspace row on the Workspaces page (pages/settings/components/WorkspaceRow.tsx). */
export function WorkspaceRowVisual() {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card p-3"
      aria-hidden
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          <Trans>Family budget</Trans>
        </div>
        {/* The page shows the role as stored, in English. */}
        <div className="text-xs text-muted-foreground">Role: owner</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary">
          <Trans>Active</Trans>
        </Badge>
        <FakeButton size="sm" variant="outline">
          <Trans>Switch</Trans>
        </FakeButton>
      </div>
    </div>
  );
}

/** The box shown after Create Invite (features/budget-sharing/ui/WorkspaceSharingPanel.tsx). */
export function InviteReadyVisual() {
  return (
    <div
      className="space-y-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2.5"
      aria-hidden
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Check className="h-3.5 w-3.5 text-primary" />
        <Trans>Invite ready — share the link below</Trans>
      </div>
      <div className="truncate rounded bg-background px-2 py-1 font-mono text-[11px]">
        https://my.budgero.app/join#code=••••••••
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FakeButton size="sm" className="h-7 px-2.5 text-xs">
          <Trans>
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </Trans>
        </FakeButton>
        <FakeButton size="sm" variant="outline" className="h-7 px-2.5 text-xs">
          <Trans>
            <Mail className="h-3.5 w-3.5" />
            Open in email
          </Trans>
        </FakeButton>
      </div>
    </div>
  );
}

/** The two master-password storage choices (pages/settings/SecurityPage.tsx). */
export function PasswordStorageVisual() {
  const option = (selected: boolean, label: React.ReactNode) => (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border p-2 text-xs font-medium',
        selected ? 'border-primary/60 bg-primary/5' : 'border-border/70 bg-muted/20'
      )}
    >
      <span
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary' : 'border-muted-foreground/50'
        )}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">{label}</span>
    </div>
  );
  return (
    <div className="space-y-1.5" aria-hidden>
      {option(true, <Trans>Keep in memory only (recommended)</Trans>)}
      {option(false, <Trans>Remember on this device (IndexedDB)</Trans>)}
    </div>
  );
}

/** A row of the custom exchange rates table (pages/settings/CurrencySettingsPage.tsx). */
export function CustomRateVisual() {
  const { i18n } = useLingui();
  const rate = i18n.number(1.0845, { minimumFractionDigits: 4 });
  const start = i18n.date(new Date(2026, 0, 1), { dateStyle: 'medium' });
  return (
    <div className="overflow-hidden rounded-md border text-xs" aria-hidden>
      <div className="grid grid-cols-[3rem_3rem_1fr_auto] gap-x-2 border-b px-2 py-1 text-muted-foreground">
        <span>
          <Trans>From</Trans>
        </span>
        <span>
          <Trans>To</Trans>
        </span>
        <span className="text-right">
          <Trans>Rate</Trans>
        </span>
        <span>
          <Trans>Start Date</Trans>
        </span>
      </div>
      <div className="grid grid-cols-[3rem_3rem_1fr_auto] gap-x-2 px-2 py-1.5">
        <span className="font-medium">EUR</span>
        <span className="font-medium">USD</span>
        <span className="text-right font-mono">{rate}</span>
        <span>{start}</span>
      </div>
    </div>
  );
}
