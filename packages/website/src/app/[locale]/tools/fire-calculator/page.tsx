import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Calculator } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrackedLink } from '@/components/TrackedLink';
import { FireCalculator } from '@/components/tools/fire-calculator';

export const dynamic = 'force-static';
export const revalidate = false;

const PATH = '/tools/fire-calculator';
const canonical = `https://budgero.app${PATH}`;

export async function generateMetadata(): Promise<Metadata> {
  // English only until the copy is translated; other locales redirect here.
  const t = await getTranslations({ locale: 'en', namespace: 'fire_calculator' });
  return {
    title: t('meta_title'),
    description: t('meta_description'),
    keywords: [
      'fire calculator',
      'fire number calculator',
      'coast fire calculator',
      'early retirement calculator',
      '4% rule calculator',
    ],
    alternates: { canonical },
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: canonical,
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta_title'),
      description: t('meta_description'),
    },
  };
}

const FAQ_KEYS = ['inflation', 'rate', 'after', 'data', 'currency'] as const;
const LEAVES_OUT_KEYS = [
  'taxes',
  'fees',
  'pensions',
  'sequence',
  'spending',
  'contributions',
] as const;
const SOURCES = [
  {
    key: 'source_bengen',
    href: 'https://www.financialplanningassociation.org/sites/default/files/2021-04/MAR04%20Determining%20Withdrawal%20Rates%20Using%20Historical%20Data.pdf',
  },
  {
    key: 'source_trinity',
    href: 'https://www.aaii.com/journal/article/retirement-savings-choosing-a-withdrawal-rate-that-is-sustainable',
  },
] as const;

export default async function FireCalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Temporary redirect: the page gets localized URLs once it is translated.
  if (locale !== 'en') redirect(PATH);
  setRequestLocale('en');
  const t = await getTranslations({ locale: 'en', namespace: 'fire_calculator' });

  const faqs = FAQ_KEYS.map((key) => ({ q: t(`faq_${key}_q`), a: t(`faq_${key}_a`) }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: t('app_name'),
        url: canonical,
        description: t('app_description'),
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@type': 'Organization', name: 'Budgero', url: 'https://budgero.app/' },
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
          {
            '@type': 'ListItem',
            position: 1,
            name: t('breadcrumb_home'),
            item: 'https://budgero.app/',
          },
          { '@type': 'ListItem', position: 2, name: t('app_name'), item: canonical },
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
            <section className="pt-24 pb-10 md:pt-32 md:pb-14 text-center">
              <div className="max-w-3xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-border/50"
                >
                  <Calculator className="w-3.5 h-3.5 mr-2" aria-hidden /> {t('badge')}
                </Badge>
                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  {t('title')}
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    {t('subtitle')}
                  </span>
                </h1>
                <p className="text-lg md:text-xl text-foreground/70 max-w-2xl mx-auto leading-relaxed">
                  {t('intro')}
                </p>
              </div>
            </section>

            {/* Calculator */}
            <div className="max-w-5xl mx-auto">
              <FireCalculator />

              <section className="mt-10 rounded-xl border border-border/70 bg-muted/20 p-5 sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  {t('assumptions_heading')}
                </h2>
                <p className="text-foreground/75 leading-relaxed">{t('assumptions_body')}</p>
                <p className="mt-3 text-sm text-foreground/60">{t('not_advice')}</p>
              </section>
            </div>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Explanation */}
            <section className="py-8 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                {t('number_heading')}
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t('number_body')}</p>
              </div>

              <h3 className="mt-10 mb-4 text-2xl font-semibold text-foreground">
                {t('example_heading')}
              </h3>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t('example_body')}</p>
                <p>{t('example_rate')}</p>
              </div>

              <h3 className="mt-10 mb-4 text-2xl font-semibold text-foreground">
                {t('rule_heading')}
              </h3>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t('rule_bengen')}</p>
                <p>{t('rule_trinity')}</p>
                <p>{t('rule_limits')}</p>
              </div>
              <h4 className="mt-6 mb-2 text-base font-semibold text-foreground">
                {t('sources_heading')}
              </h4>
              <ul className="list-disc space-y-2 pl-6 text-sm text-foreground/70 leading-relaxed">
                {SOURCES.map((source) => (
                  <li key={source.key}>
                    <a className="underline hover:text-foreground" href={source.href}>
                      {t(source.key)}
                    </a>
                  </li>
                ))}
              </ul>

              <h3 className="mt-10 mb-4 text-2xl font-semibold text-foreground">
                {t('coast_section_heading')}
              </h3>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t('coast_section_body')}</p>
                <p>{t('coast_section_formula')}</p>
              </div>

              <h3 className="mt-10 mb-4 text-2xl font-semibold text-foreground">
                {t('leaves_out_heading')}
              </h3>
              <ul className="list-disc space-y-2 pl-6 text-lg text-foreground/75 leading-relaxed">
                {LEAVES_OUT_KEYS.map((key) => (
                  <li key={key}>{t(`leaves_out_${key}`)}</li>
                ))}
              </ul>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Budgero */}
            <section className="py-8 max-w-3xl mx-auto">
              <div className="bg-card rounded-2xl p-6 sm:p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-5">
                  {t('budget_heading')}
                </h2>
                <div className="space-y-4 text-foreground/75 leading-relaxed">
                  <p>{t('budget_body')}</p>
                  <p>{t('budget_track')}</p>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <TrackedLink
                      external
                      href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=fire-calculator&utm_content=budget-section"
                      event="Trial CTA - FIRE Calculator"
                    >
                      {t('budget_cta')} <ArrowRight className="w-4 h-4 ml-2" aria-hidden />
                    </TrackedLink>
                  </Button>
                </div>
                <p className="mt-4 text-sm text-foreground/55">{t('budget_trial')}</p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-8 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                {t('faq_heading')}
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

            {/* Related */}
            <section className="pt-4 pb-20 max-w-3xl mx-auto">
              <h2 className="text-xl font-semibold text-foreground mb-3">{t('related_heading')}</h2>
              <p className="text-foreground/70 leading-relaxed">
                <TrackedLink
                  href="/tools/debt-payoff-calculator"
                  event="Related Tool - FIRE Calculator"
                  className="font-medium text-foreground underline"
                >
                  {t('related_link')}
                </TrackedLink>
                . {t('related_body')}
              </p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
