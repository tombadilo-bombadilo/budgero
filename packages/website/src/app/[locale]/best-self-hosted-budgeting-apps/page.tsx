import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Server } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

const path = '/best-self-hosted-budgeting-apps';
const canonical = `https://budgero.app${path}`;
const reviewedOn = '2026-11-15';

// English only until the copy is approved and translated. Other locales redirect
// here, and the sitemap, hreflang and locale switcher treat it as a single page.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: 'en', namespace: 'best_self_hosted_budgeting_apps' });
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

const apps = ['actual', 'firefly', 'sure', 'openbudgeteer', 'budgero'] as const;
type AppId = (typeof apps)[number];

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
  selfhostable: internal('/self-hostable'),
  ynabSelfHosted: internal('/self-hosted-ynab-alternative'),
  bestYnab: internal('/best-ynab-alternatives'),
  actualAlt: internal('/actual-budget-alternative'),
  fireflyAlt: internal('/firefly-iii-alternative'),
  security: internal('/docs/security'),
  enableBanking: internal('/docs/bank-sync-enable-banking'),
  simplefin: internal('/docs/bank-sync-simplefin'),
  fileImport: internal('/docs/csv-import'),
  multiCurrency: internal('/docs/multi-currency'),
  sharing: internal('/docs/sharing'),
  masterPassword: internal('/docs/master-password'),
  ynabImport: internal('/docs/ynab-import'),
  maybeAlt: internal('/maybe-finance-alternative'),
  monthly: pricing.monthly,
  yearly: pricing.yearly,
};

// t.raw() returns strings unformatted, so prices are filled in here.
const fill = (text: string) =>
  text.replaceAll('{monthly}', pricing.monthly).replaceAll('{yearly}', pricing.yearly);

type Row = { label: string } & Record<AppId, string>;
type Faq = { q: string; a: string };
type Pick = { if: string; pick: string };
type Source = { label: string; href: string };

export default async function BestSelfHostedBudgetingAppsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== 'en') redirect(path);
  setRequestLocale('en');
  const t = await getTranslations({ locale: 'en', namespace: 'best_self_hosted_budgeting_apps' });

  const names = t.raw('names') as Record<AppId, string>;
  const rows = t.raw('table.rows') as Row[];
  const faqs = (t.raw('faq.items') as Faq[]).map((faq) => ({ q: faq.q, a: fill(faq.a) }));
  const picks = (t.raw('choose.items') as Pick[]).map((p) => ({ if: p.if, pick: fill(p.pick) }));
  const sources = t.raw('sources.items') as Source[];
  const paragraphKeys = (id: AppId) =>
    Object.keys(t.raw(`apps.${id}.body`) as Record<string, string>);

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
        '@type': 'ItemList',
        numberOfItems: apps.length,
        itemListElement: apps.map((id, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: names[id],
          item: {
            '@type': 'SoftwareApplication',
            name: names[id],
            applicationCategory: 'FinanceApplication',
            operatingSystem: 'Docker',
          },
        })),
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
                  <Server className="w-3.5 h-3.5 mr-2 shrink-0" />
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

            {/* Comparison table */}
            <section id="compare" className="py-10 max-w-6xl mx-auto scroll-mt-24">
              <div className="text-center mb-8">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  {t('table.title')}
                </h2>
                <p className="text-sm text-foreground/60 max-w-2xl mx-auto">{t('table.intro')}</p>
              </div>

              <div
                className="max-h-[80vh] overflow-auto rounded-2xl border border-border/70 bg-card"
                role="region"
                aria-label={t('table.title')}
                tabIndex={0}
              >
                <table className="w-full min-w-[1040px] text-sm leading-relaxed">
                  <caption className="sr-only">{t('table.title')}</caption>
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-3 text-left font-semibold text-foreground sticky top-0 left-0 z-20 bg-muted"
                      >
                        <span className="sr-only">{t('table.criterion')}</span>
                      </th>
                      {apps.map((id) => (
                        <th
                          key={id}
                          scope="col"
                          className="px-3 py-3 text-left font-semibold text-foreground align-bottom sticky top-0 z-10 bg-muted"
                        >
                          <a href={`#${id}`} className={linkClass}>
                            {names[id]}
                          </a>
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
                          className="px-3 py-3 text-left font-semibold text-foreground sticky left-0 bg-card w-[140px]"
                        >
                          {row.label}
                        </th>
                        {apps.map((id) => (
                          <td key={id} className="px-3 py-3 text-foreground/75">
                            {fill(row[id])}
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

            {/* One section per app */}
            {apps.map((id, idx) => (
              <section key={id} id={id} className="py-10 max-w-3xl mx-auto scroll-mt-24">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground">
                  {idx + 1}. {names[id]}
                </h2>
                <p className="mt-2 text-sm text-foreground/60">{t(`apps.${id}.facts`)}</p>
                <div className="mt-6 space-y-4 text-lg text-foreground/75 leading-relaxed">
                  {paragraphKeys(id).map((key) => (
                    <p key={key}>{t.rich(`apps.${id}.body.${key}`, richTags)}</p>
                  ))}
                </div>
                <p className="mt-6 rounded-xl border border-border/70 bg-muted/25 p-4 text-foreground/80 leading-relaxed">
                  <strong className="text-foreground">{t('apps.pickLabel')}</strong>{' '}
                  {t(`apps.${id}.pick`)}
                </p>
              </section>
            ))}

            <div className="my-10 border-t border-border" aria-hidden />

            {/* How to choose */}
            <section id="choose" className="py-10 max-w-3xl mx-auto scroll-mt-24">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                {t('choose.title')}
              </h2>
              <p className="text-lg text-foreground/75 leading-relaxed mb-6">
                {t.rich('choose.intro', richTags)}
              </p>
              <dl className="space-y-4 rounded-2xl border border-border/70 bg-muted/25 p-6">
                {picks.map((item) => (
                  <div key={item.if}>
                    <dt className="font-semibold text-foreground">{item.if}</dt>
                    <dd className="text-foreground/75">{item.pick}</dd>
                  </div>
                ))}
              </dl>
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
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=best-self-hosted-budgeting-apps&utm_content=final">
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
