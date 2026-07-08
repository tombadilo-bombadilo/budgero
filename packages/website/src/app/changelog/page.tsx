import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Sparkles,
  Wrench,
  ArrowUpRight,
  Archive,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { changelogEntries, type ChangelogItemType } from '@/lib/changelog-data';
import { cn } from '@/lib/utils';

const latestEntry = changelogEntries.find((entry) => entry.isLatest) ?? changelogEntries[0];

export const metadata: Metadata = {
  title: "What's New in Budgero - Changelog",
  description: 'Read the latest updates, features, and bug fixes for Budgero.',
  alternates: {
    canonical: 'https://budgero.app/changelog',
  },
  openGraph: {
    title: "What's New in Budgero - Changelog",
    description: 'Read the latest updates, features, and bug fixes for Budgero.',
    url: 'https://budgero.app/changelog',
  },
  twitter: {
    card: 'summary_large_image',
    title: "What's New in Budgero - Changelog",
    description: 'Read the latest updates, features, and bug fixes for Budgero.',
  },
};

const typeMeta: Record<
  ChangelogItemType,
  { label: string; className: string; icon: ComponentType<{ className?: string }> }
> = {
  new: {
    label: 'New',
    className: 'border-border/60 bg-muted/40 text-foreground',
    icon: Sparkles,
  },
  improved: {
    label: 'Improved',
    className: 'border-border/60 bg-muted/40 text-foreground',
    icon: ArrowUpRight,
  },
  fixed: {
    label: 'Fixed',
    className: 'border-border/60 bg-muted/40 text-foreground',
    icon: Wrench,
  },
  'coming-soon': {
    label: 'Coming soon',
    className: 'border-border/60 bg-muted/40 text-foreground',
    icon: Clock3,
  },
  deprecated: {
    label: 'Deprecated',
    className: 'border-border/60 bg-muted/40 text-foreground',
    icon: Archive,
  },
};

export default function ChangelogPage() {
  return (
    <main className="bg-background text-foreground">
      <section className="border-b border-border/60 bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
            What&apos;s new
          </Badge>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Badge className="rounded-full border border-primary/30 bg-primary/15 text-primary">
              Current version
            </Badge>
            <span className="font-semibold text-foreground">{latestEntry.version}</span>
            <span aria-hidden>•</span>
            <span>{latestEntry.date}</span>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Budgero Changelog
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            We ship improvements weekly so you can budget with confidence. Browse everything
            we&apos;ve released, polished, and fixed without waiting for the next newsletter.
          </p>
        </div>
      </section>

      <section className="container mx-auto space-y-12 px-4 py-12 sm:space-y-16 sm:py-16">
        <div className="relative">
          <div
            className="absolute left-[19px] top-0 h-full w-px bg-border/60 sm:left-6"
            aria-hidden
          >
            <span className="sr-only">Timeline</span>
          </div>
          <div className="space-y-12 sm:space-y-16">
            {changelogEntries.map((entry) => (
              <article key={entry.version} className="relative pl-10 sm:pl-14">
                <div className="absolute left-0 top-9 flex size-10 items-center justify-center rounded-full border border-border bg-background shadow-sm sm:left-[-8px]">
                  <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
                </div>

                <Card className="overflow-hidden border-border/70 shadow-lg shadow-black/5 dark:shadow-none">
                  <div
                    className="h-1 w-full bg-gradient-to-r from-[#d7dbe2] via-[#8a93a3] to-[#111c34]"
                    aria-hidden
                  />
                  <CardHeader className="pt-8">
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <CalendarDays className="size-4" aria-hidden />
                      <span>{entry.date}</span>
                      {entry.isLatest ? (
                        <Badge className="rounded-full border border-primary/30 bg-primary/15 text-primary">
                          Latest
                        </Badge>
                      ) : null}
                    </div>
                    <CardTitle className="text-2xl font-bold sm:text-3xl">
                      {entry.version}
                    </CardTitle>
                    <CardDescription className="text-base text-muted-foreground">
                      {entry.summary}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-8">
                    <ul className="grid gap-4 md:grid-cols-2">
                      {entry.items.map((item) => {
                        const meta = typeMeta[item.type];
                        const ItemIcon = meta.icon;

                        return (
                          <li
                            key={`${entry.version}-${item.title}`}
                            className="group rounded-xl border border-border/60 bg-background/60 p-5 transition-colors hover:border-border hover:bg-muted/40"
                          >
                            <div className="flex items-center gap-3">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                                  meta.className
                                )}
                              >
                                <ItemIcon className="size-3.5" aria-hidden />
                                {meta.label}
                              </Badge>
                              <h3 className="text-base font-semibold text-foreground">
                                {item.title}
                              </h3>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                              {item.description}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              </article>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-muted/20 px-8 py-10 text-center shadow-inner">
          <div
            className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(120,120,120,0.18),transparent_55%)]"
            aria-hidden
          />
          <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Get updates the moment we ship
          </h2>
          <p className="mt-3 text-muted-foreground">
            Use <span className="font-medium text-foreground">my.budgero.app</span> to stay current
            with new features, performance fixes, and upcoming previews.
          </p>
          <a
            href="https://my.budgero.app"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            Head to the app
            <ArrowRight className="ml-2 size-4" aria-hidden />
          </a>
        </div>
      </section>
    </main>
  );
}
