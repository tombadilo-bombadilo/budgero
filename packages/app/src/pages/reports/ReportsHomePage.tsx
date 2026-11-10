import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  Code2,
  FlaskConical,
  LayoutGrid,
  MoreHorizontal,
  Network,
  PieChart,
  Plus,
  Search,
  Table2,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { UnifiedReport } from '@budgero/core/browser';
import { useReports } from '@entities/report/api/useReports';
import { parseQuestionHeader, resolveVisualization } from '@features/reports/lib/question';
import { describeQuestion } from '@features/reports/ui/notebook/question-labels';
import { VIZ_ICONS } from '@features/reports/ui/notebook/viz/viz-meta';
import { REPORT_ORDER, reportMeta } from '@pages/analytics/report-questions';
import type { ReportKey } from '@pages/analytics/analytics-state';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { cn } from '@shared/lib/utils';
import { collectionOf } from './collections';
import { useDeleteQuestion } from './question/useDeleteQuestion';

const REPORT_ICONS: Record<ReportKey, LucideIcon> = {
  wealth: TrendingUp,
  spending: PieChart,
  'in-out': ArrowLeftRight,
  plan: Target,
  'money-map': Network,
  scenario: FlaskConical,
  ledger: Table2,
};

const MY_QUESTIONS = '__mine__';
const ALL = '__all__';

interface SavedCard {
  report: UnifiedReport;
  summary: string;
  icon: LucideIcon;
  collection: string | undefined;
}

const CARD_CLASS =
  'group flex h-full flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function matches(query: string, ...texts: (string | undefined)[]) {
  if (!query) return true;
  return texts.some((text) => text?.toLowerCase().includes(query));
}

/**
 * /reports — one home for every report: the prebuilt questions and the
 * user's saved questions (grouped into collections), side by side.
 */
export default function ReportsHomePage() {
  const { t, i18n } = useLingui();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState(ALL);
  const { data: reports = [], isLoading } = useReports();
  const deletion = useDeleteQuestion();
  const query = search.trim().toLowerCase();

  const prebuilt = REPORT_ORDER.map((key) => ({ key, ...reportMeta(key) })).filter((item) =>
    matches(query, item.label, item.question, item.hint)
  );

  const saved = useMemo<SavedCard[]>(
    () =>
      [...reports]
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .map((report) => {
          const spec = parseQuestionHeader(report.query);
          return {
            report,
            summary: report.description || (spec ? describeQuestion(spec) : t`SQL query`),
            icon: spec ? VIZ_ICONS[resolveVisualization(spec)] : Code2,
            collection: collectionOf(report),
          };
        }),
    [reports, t]
  );

  const collections = useMemo(() => {
    const names = new Set<string>();
    for (const card of saved) if (card.collection) names.add(card.collection);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [saved]);
  const hasMine = saved.some((card) => !card.collection);

  const visibleSaved = saved.filter(
    (card) =>
      (collection === ALL ||
        (collection === MY_QUESTIONS ? !card.collection : card.collection === collection)) &&
      matches(query, card.report.name, card.summary, card.collection)
  );

  const formatUpdated = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString(i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const collectionFilters = [
    { id: ALL, label: t`All` },
    ...(hasMine ? [{ id: MY_QUESTIONS, label: t`My questions` }] : []),
    ...collections.map((name) => ({ id: name, label: name })),
  ];

  return (
    <div className="w-full space-y-8 p-4 pb-24 sm:p-6 md:pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans>Reports</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans>Ready-made answers to common questions, and the questions you’ve saved.</Trans>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/reports/dashboards">
              <LayoutGrid className="h-4 w-4" aria-hidden />
              <Trans>Dashboards</Trans>
            </Link>
          </Button>
          <Button asChild>
            <Link to="/reports/question/new">
              <Plus className="h-4 w-4" aria-hidden />
              <Trans>New question</Trans>
            </Link>
          </Button>
        </div>
      </header>

      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={searchId}
          aria-label={t`Search reports`}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t`Search reports…`}
          className="pl-9"
        />
      </div>

      <section aria-labelledby={`${searchId}-prebuilt`} className="space-y-3">
        <h2 id={`${searchId}-prebuilt`} className="text-lg font-semibold">
          <Trans>Prebuilt reports</Trans>
        </h2>
        {prebuilt.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No prebuilt report matches your search.</Trans>
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {prebuilt.map((item) => {
              const Icon = REPORT_ICONS[item.key];
              return (
                <li key={item.key}>
                  <Link to={`/reports/prebuilt/${item.key}`} className={CARD_CLASS}>
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium leading-snug">{item.question}</p>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.hint}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${searchId}-saved`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${searchId}-saved`} className="text-lg font-semibold">
            <Trans>Saved questions</Trans>
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/reports/question/new?mode=sql">
              <Code2 className="h-4 w-4" aria-hidden />
              <Trans>New SQL query</Trans>
            </Link>
          </Button>
        </div>

        {collectionFilters.length > 2 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t`Collections`}>
            {collectionFilters.map((item) => (
              <Button
                key={item.id}
                variant={collection === item.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={collection === item.id}
                className={cn('h-8 rounded-full border', collection === item.id && 'border-border')}
                onClick={() => setCollection(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : saved.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <Wallet className="h-8 w-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">
                <Trans>No saved questions yet</Trans>
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Ask your own: pick data, filter it, summarize it and save it to reuse or pin to a
                  dashboard.
                </Trans>
              </p>
            </div>
            <Button asChild>
              <Link to="/reports/question/new">
                <Plus className="h-4 w-4" aria-hidden />
                <Trans>New question</Trans>
              </Link>
            </Button>
          </div>
        ) : visibleSaved.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No saved question matches your search.</Trans>
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visibleSaved.map(({ report, summary, icon: Icon, collection: name }) => {
              const updated = formatUpdated(report.updatedAt);
              return (
                <li key={report.id} className="relative">
                  <Link to={`/reports/question/${report.id}`} className={cn(CARD_CLASS, 'pr-12')}>
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium leading-snug">{report.name}</p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{summary}</p>
                      </div>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border px-2 py-0.5">
                        {name ?? t`My questions`}
                      </span>
                      {updated && <span>{t`Updated ${updated}`}</span>}
                    </div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 top-2 h-8 w-8"
                        aria-label={t`More actions for ${report.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => deletion.ask(report)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        <Trans>Delete question</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {deletion.dialog}
    </div>
  );
}
