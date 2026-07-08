import type { Metadata } from 'next';
import Link from 'next/link';
import { allGuides } from 'contentlayer/generated';
import { ArrowRight, BookOpenCheck, Compass, Layers3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { docsSections } from '@/lib/docs-sections';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Budgero Docs — Master zero-based budgeting with confidence',
  description:
    'Deep dive into Budgero features. Learn how ready to assign works, master password best practices, goals, accounts, imports, collaboration, and more.',
  alternates: {
    canonical: 'https://budgero.app/docs',
  },
  openGraph: {
    title: 'Budgero Docs',
    description:
      'Guides that walk you through Budgero budgeting workflows — from ready to assign to multi-currency accounts and encrypted collaboration.',
    url: 'https://budgero.app/docs',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Budgero Docs',
    description:
      'Guides that walk you through Budgero budgeting workflows — from ready to assign to multi-currency accounts and encrypted collaboration.',
  },
};

const heroHighlights = [
  {
    icon: Compass,
    label: 'Step-by-step guides',
  },
  {
    icon: BookOpenCheck,
    label: 'Zero-knowledge friendly',
  },
  {
    icon: Layers3,
    label: 'Budgets that scale with you',
  },
];

type TopicStatus = 'available' | 'coming-soon';

type AugmentedTopic = (typeof docsSections)[number]['topics'][number] & {
  status: TopicStatus;
  href?: string;
  badge?: string;
  readingTimeMinutes?: number;
};

type AugmentedSection = (typeof docsSections)[number] & { topics: AugmentedTopic[] };

export default function DocsPage() {
  const publishedGuides = allGuides.filter((guide) => guide.published !== false);
  const guidesByTopic = new Map(publishedGuides.map((guide) => [guide.topicId, guide]));

  const sections: AugmentedSection[] = docsSections.map((section) => {
    const topics: AugmentedTopic[] = section.topics.map((topic) => {
      const guide = guidesByTopic.get(topic.id);
      if (guide) {
        return {
          ...topic,
          summary: guide.summary ?? topic.summary,
          takeaways:
            guide.takeaways && guide.takeaways.length > 0 ? guide.takeaways : topic.takeaways,
          status: 'available' as const,
          href: guide.url,
          badge: guide.badge ?? 'Guide',
          readingTimeMinutes: guide.readingTimeMinutes,
        };
      }

      return {
        ...topic,
        status: 'coming-soon' as const,
        href: undefined,
        badge: undefined,
        readingTimeMinutes: undefined,
      };
    });

    return { ...section, topics };
  });

  return (
    <main className="bg-background text-foreground">
      <section className="border-b border-border/60 bg-muted/20">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
            Knowledge base
          </Badge>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Budgero Docs
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Master Budgero&apos;s zero-based budgeting system. Explore practical guides that explain
            how ready to assign behaves, how goals accelerate savings, how multi-currency accounts
            sync, and how to stay secure with zero-knowledge encryption.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Switching from YNAB? Start with our{' '}
            <Link href="/vs-ynab" className="underline underline-offset-4">
              YNAB alternative comparison
            </Link>
            .
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {heroHighlights.map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 py-2"
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12 sm:py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[260px_1fr] lg:gap-16">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-6 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Browse topics
              </h2>
              <nav className="mt-5 space-y-3 text-sm">
                {docsSections.map((section) => (
                  <div key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="group flex items-center justify-between rounded-lg px-3 py-2 text-left font-medium text-foreground transition hover:bg-background"
                    >
                      <span>{section.title}</span>
                      <span className="text-xs text-muted-foreground transition group-hover:text-foreground">
                        {section.topics.length} {section.topics.length === 1 ? 'guide' : 'guides'}
                      </span>
                    </a>
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          <div className="space-y-16">
            {sections.map((section) => (
              <article key={section.id} id={section.id} className="scroll-mt-28">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
                      {section.title}
                    </h2>
                    <p className="mt-3 max-w-3xl text-base text-muted-foreground sm:text-lg">
                      {section.description}
                    </p>
                  </div>
                  <Badge className="self-start rounded-full border border-primary/30 bg-primary/15 text-primary">
                    {section.topics.length} {section.topics.length === 1 ? 'guide' : 'guides'}
                  </Badge>
                </div>

                <div className="mt-8 grid gap-6 md:grid-cols-2">
                  {section.topics.map((topic, index) => {
                    const isAvailable = topic.status === 'available';
                    const badgeLabel = topic.badge;
                    const cardClasses = cn(
                      'h-full border-border/70 bg-background/70 transition',
                      isAvailable
                        ? 'hover:border-border hover:shadow-lg hover:shadow-black/5'
                        : 'border-dashed border-border/60 bg-background/40 backdrop-blur-sm',
                      index === 0 ? 'md:col-span-2 lg:col-span-1' : undefined
                    );

                    const card = (
                      <Card className={cardClasses}>
                        <CardHeader>
                          <div className="flex items-center gap-2">
                            <CardTitle
                              className={cn(
                                'text-xl font-semibold',
                                isAvailable ? 'text-foreground' : 'text-foreground/80'
                              )}
                            >
                              {topic.title}
                            </CardTitle>
                            {isAvailable ? (
                              <Badge className="rounded-full border border-primary/30 bg-primary/15 text-primary">
                                {badgeLabel}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="rounded-full border-dashed text-muted-foreground"
                              >
                                Coming soon
                              </Badge>
                            )}
                          </div>
                          <CardDescription className="text-base text-muted-foreground">
                            {topic.summary}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ul
                            className={cn(
                              'space-y-2 text-sm',
                              isAvailable ? 'text-muted-foreground' : 'text-muted-foreground/80'
                            )}
                          >
                            {topic.takeaways.map((point) => (
                              <li key={point} className="flex items-start gap-2">
                                <span
                                  className={cn(
                                    'mt-1 inline-block size-1.5 rounded-full',
                                    isAvailable ? 'bg-primary' : 'bg-muted'
                                  )}
                                  aria-hidden
                                />
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                          {isAvailable ? (
                            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                              Read the guide
                              <ArrowRight
                                className="size-4 transition group-hover:translate-x-1"
                                aria-hidden
                              />
                            </div>
                          ) : (
                            <p className="mt-6 text-sm text-muted-foreground/80">
                              We&apos;re polishing this walkthrough. Keep an eye on the{' '}
                              <Link
                                href="/changelog"
                                className="font-medium text-primary underline-offset-4 hover:underline"
                              >
                                changelog
                              </Link>{' '}
                              to know when it drops.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );

                    if (isAvailable && topic.href) {
                      return (
                        <Link
                          key={topic.id}
                          href={topic.href}
                          className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {card}
                        </Link>
                      );
                    }

                    return (
                      <div key={topic.id} className="h-full">
                        {card}
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 bg-muted/30">
        <div className="container mx-auto px-4 py-14 text-center sm:py-20">
          <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Have a question we haven&apos;t covered?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Email{' '}
            <a
              href="mailto:hello@budgero.app"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              hello@budgero.app
            </a>
            &nbsp;and we&apos;ll point you to the right guide or create a new one.
          </p>
        </div>
      </section>
    </main>
  );
}
