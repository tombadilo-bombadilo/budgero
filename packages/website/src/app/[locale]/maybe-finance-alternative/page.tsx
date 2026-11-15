import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Archive } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

const path = '/maybe-finance-alternative';
const canonical = `https://budgero.app${path}`;
const reviewedOn = '2026-11-15';

// English only until the copy is approved and translated. Other locales redirect
// here, and the sitemap, hreflang and locale switcher treat it as a single page.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: 'en', namespace: 'maybe_finance_alternative' });
  const title = t('meta.title');
  const description = t('meta.description');
  return {
    title,
    description,
    keywords: t.raw('meta.keywords') as string[],
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'article', locale: 'en_US' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

const columns = ['maybe', 'sure', 'budgero'] as const;
type ColumnId = (typeof columns)[number];

const linkClass = 'underline underline-offset-4 hover:text-foreground';

const internal = (href: string) => {
  const InternalLink = (chunks: ReactNode) => (
    <Link href={href} className={linkClass}>
      {chunks}
    </Link>
  );
  return InternalLink;
};

const richTags = {
  selfhostGuide: internal('/docs/self-hosting-guide'),
  bestSelfHosted: internal('/best-self-hosted-budgeting-apps'),
  actualAlt: internal('/actual-budget-alternative'),
  fireflyAlt: internal('/firefly-iii-alternative'),
  security: internal('/docs/security'),
  enableBanking: internal('/docs/bank-sync-enable-banking'),
  fileImport: internal('/docs/csv-import'),
  accounts: internal('/docs/accounts'),
  strong: (chunks: ReactNode) => <strong className="text-foreground">{chunks}</strong>,
  monthly: pricing.monthly,
  yearly: pricing.yearly,
};

type Row = { label: string } & Record<ColumnId, string>;
type Faq = { q: string; a: string };
type Dated = { date: string; text: string };
type Move = { to: string; text: string };
type Source = { label: string; href: string };

const options = ['sure', 'stay', 'budgero'] as const;

export default async function MaybeFinanceAlternativePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== 'en') redirect(path);
  setRequestLocale('en');
  const t = await getTranslations({ locale: 'en', namespace: 'maybe_finance_alternative' });

  const names = t.raw('names') as Record<ColumnId, string>;
  const rows = t.raw('table.rows') as Row[];
  const faqs = t.raw('faq.items') as Faq[];
  const history = t.raw('history.items') as Dated[];
  const moves = t.raw('move.items') as Move[];
  const sources = t.raw('sources.items') as Source[];
  const paragraphKeys = (key: string) => Object.keys(t.raw(key) as Record<string, string>);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: t('meta.headline'),
        author: { '@type': 'Organization', name: 'Budgero' },
        datePublished: reviewedOn,
        dateModified: reviewedOn,
        description: t('meta.description'),
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Budgero', item: 'https://budgero.app/' },
          { '@type': 'ListItem', position: 2, name: t('meta.breadcrumb'), item: canonical },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-background text-foreground">
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="relative z-10 px-4 sm:px-6 lg:px-10 xl:px-12 2xl:px-16 py-2 sm:py-4 lg:py-6">
            {/* Hero */}
            <section className="pt-24 pb-12 md:pt-32 md:pb-16 text-center">
              <div className="max-w-4xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 max-w-full whitespace-normal px-4 py-1.5 text-sm font-medium border-border/50"
                >
                  <Archive className="w-3.5 h-3.5 mr-2 shrink-0" />
                  <span>{t('hero.eyebrow')}</span>
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  {t('hero.title')}
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    {t('hero.subtitle')}
                  </span>
                </h1>

                <div className="mb-8 max-w-2xl mx-auto rounded-2xl border border-border/70 bg-card p-6 text-left">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground mb-3">
                    {t('hero.answerTitle')}
                  </h2>
                  <ul className="space-y-2 text-base text-foreground/80 leading-relaxed">
                    {(t.raw('hero.answer') as string[]).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>

                <p className="text-sm text-foreground/60 max-w-2xl mx-auto leading-relaxed">
                  {t('hero.disclosure')}
                </p>
              </div>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* What happened */}
            <section id="what-happened" className="py-10 max-w-3xl mx-auto scroll-mt-24">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                {t('history.title')}
              </h2>
              <ol className="space-y-4 border-l border-border pl-6">
                {history.map((item) => (
                  <li key={item.date}>
                    <p className="text-sm font-semibold text-foreground">{item.date}</p>
                    <p className="text-foreground/75 leading-relaxed">{item.text}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-8 space-y-4 text-lg text-foreground/75 leading-relaxed">
                {paragraphKeys('history.body').map((key) => (
                  <p key={key}>{t(`history.body.${key}`)}</p>
                ))}
              </div>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* Options */}
            <section id="options" className="py-10 max-w-3xl mx-auto scroll-mt-24">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                {t('options.title')}
              </h2>
            </section>

            {options.map((id) => (
              <section key={id} id={id} className="pb-10 max-w-3xl mx-auto scroll-mt-24">
                <h3 className="text-2xl md:text-3xl font-bold text-foreground">
                  {t(`options.${id}.title`)}
                </h3>
                <p className="mt-2 text-sm text-foreground/60">{t(`options.${id}.facts`)}</p>
                <div className="mt-6 space-y-4 text-lg text-foreground/75 leading-relaxed">
                  {paragraphKeys(`options.${id}.body`).map((key) => (
                    <p key={key}>{t.rich(`options.${id}.body.${key}`, richTags)}</p>
                  ))}
                </div>
                {id === 'stay' && (
                  <div className="mt-6">
                    <h4 className="font-semibold text-foreground mb-2">
                      {t('options.stay.listTitle')}
                    </h4>
                    <ul className="list-disc pl-5 space-y-1 text-foreground/75">
                      {(t.raw('options.stay.list') as string[]).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-6 rounded-xl border border-border/70 bg-muted/25 p-4 text-foreground/80 leading-relaxed">
                  <strong className="text-foreground">{t('options.pickLabel')}</strong>{' '}
                  {t(`options.${id}.pick`)}
                </p>
              </section>
            ))}

            <section id="others" className="pb-10 max-w-3xl mx-auto scroll-mt-24">
              <h3 className="text-2xl md:text-3xl font-bold text-foreground">
                {t('options.others.title')}
              </h3>
              <div className="mt-6 space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t.rich('options.others.actual', richTags)}</p>
                <p>{t.rich('options.others.firefly', richTags)}</p>
              </div>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* Comparison table */}
            <section id="compare" className="py-10 max-w-5xl mx-auto scroll-mt-24">
              <div className="text-center mb-8">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  {t('table.title')}
                </h2>
                <p className="text-sm text-foreground/60 max-w-2xl mx-auto">
                  {t.rich('table.intro', richTags)}
                </p>
              </div>

              <div
                className="overflow-x-auto rounded-2xl border border-border/70 bg-card"
                role="region"
                aria-label={t('table.title')}
                tabIndex={0}
              >
                <table className="w-full min-w-[720px] text-sm leading-relaxed">
                  <caption className="sr-only">{t('table.title')}</caption>
                  <thead className="bg-muted/35">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-3 text-left font-semibold text-foreground sticky left-0 bg-muted"
                      >
                        <span className="sr-only">{t('table.criterion')}</span>
                      </th>
                      {columns.map((id) => (
                        <th
                          key={id}
                          scope="col"
                          className="px-3 py-3 text-left font-semibold text-foreground align-bottom"
                        >
                          {names[id]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {rows.map((row, index) => (
                      <tr
                        key={row.label}
                        className={`align-top ${index % 2 === 0 ? '' : 'bg-muted/25'}`}
                      >
                        <th
                          scope="row"
                          className="px-3 py-3 text-left font-semibold text-foreground sticky left-0 bg-card w-[130px]"
                        >
                          {row.label}
                        </th>
                        {columns.map((id) => (
                          <td key={id} className="px-3 py-3 text-foreground/75">
                            {row[id]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm text-foreground/60 max-w-3xl mx-auto">{t('table.note')}</p>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* Moving data */}
            <section id="move" className="py-10 max-w-3xl mx-auto scroll-mt-24">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                {t('move.title')}
              </h2>
              <p className="text-lg text-foreground/75 leading-relaxed mb-6">{t('move.intro')}</p>
              <dl className="space-y-5 rounded-2xl border border-border/70 bg-muted/25 p-6">
                {moves.map((item) => (
                  <div key={item.to}>
                    <dt className="font-semibold text-foreground">{item.to}</dt>
                    <dd className="mt-1 text-foreground/75 leading-relaxed">{item.text}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-foreground/75">{t.rich('move.csvLink', richTags)}</p>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section id="faq" className="py-10 max-w-3xl mx-auto scroll-mt-24">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                {t('faq.title')}
              </h2>
              <div className="space-y-8">
                {faqs.map((faq) => (
                  <div key={faq.q}>
                    <h3 className="text-lg font-semibold text-foreground mb-2">{faq.q}</h3>
                    <p className="text-foreground/70 leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* Related pages */}
            <section className="py-10 max-w-3xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                {t('related.title')}
              </h2>
              <ul className="space-y-3 text-lg text-foreground/75 list-disc pl-5">
                {Object.keys(t.raw('related.items') as Record<string, string>).map((key) => (
                  <li key={key}>{t.rich(`related.items.${key}`, richTags)}</li>
                ))}
              </ul>
            </section>

            {/* Sources */}
            <section className="py-10 max-w-3xl mx-auto" aria-labelledby="sources">
              <h2 id="sources" className="text-2xl font-semibold text-foreground mb-4">
                {t('sources.title')}
              </h2>
              <p className="text-sm text-foreground/70 leading-relaxed">
                {t('sources.intro')} <time dateTime={reviewedOn}>{t('sources.date')}</time>.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-foreground/75">
                {sources.map((source) => (
                  <li key={source.href}>
                    <a href={source.href} className={linkClass}>
                      {source.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <div className="my-10 border-t border-border" aria-hidden />

            {/* CTA */}
            <section className="py-16 text-center">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  {t('cta.title')}
                </h2>
                <p className="text-lg text-foreground/70 mb-8">{t('cta.body')}</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <Link href="/docs/self-hosting-guide">
                      {t('cta.primary')} <ArrowRight className="w-5 h-5 ml-2" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-14 px-8 text-lg">
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=maybe-finance-alternative&utm_content=final">
                      {t('cta.secondary')}
                    </a>
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
