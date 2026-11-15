import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, BookOpen, Calculator } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrackedLink } from '@/components/TrackedLink';
import { DebtPayoffCalculator } from '@/components/tools/debt-payoff-calculator';

export const dynamic = 'force-static';
export const revalidate = false;

const PATH = '/tools/debt-payoff-calculator';
const canonical = `https://budgero.app${PATH}`;

export async function generateMetadata(): Promise<Metadata> {
  // English only until the copy is translated; other locales redirect here.
  const t = await getTranslations({ locale: 'en', namespace: 'debt_payoff_calculator' });
  return {
    title: t('meta_title'),
    description: t('meta_description'),
    keywords: [
      'debt payoff calculator',
      'debt snowball calculator',
      'debt avalanche calculator',
      'snowball vs avalanche calculator',
      'debt free date calculator',
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

const FAQ_KEYS = ['better', 'date', 'short', 'loan', 'data', 'currency'] as const;
const LEAVES_OUT_KEYS = ['spending', 'rates', 'fees', 'promo', 'minimums', 'daily'] as const;

export default async function DebtPayoffCalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Temporary redirect: the page gets localized URLs once it is translated.
  if (locale !== 'en') redirect(PATH);
  setRequestLocale('en');
  const t = await getTranslations({ locale: 'en', namespace: 'debt_payoff_calculator' });

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
              <DebtPayoffCalculator />

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
                {t('explain_heading')}
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t('explain_both')}</p>
                <p>{t('explain_snowball')}</p>
                <p>{t('explain_avalanche')}</p>
              </div>

              <h3 className="mt-10 mb-4 text-2xl font-semibold text-foreground">
                {t('small_heading')}
              </h3>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>{t('small_example')}</p>
                <p>{t('small_when')}</p>
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
                  {t('budgero_heading')}
                </h2>
                <div className="space-y-4 text-foreground/75 leading-relaxed">
                  <p>{t('budgero_intro')}</p>
                  <p>{t('budgero_cards')}</p>
                  <p>{t('budgero_loans')}</p>
                  <p>{t('budgero_missing')}</p>
                  <p>{t('budgero_privacy')}</p>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <TrackedLink
                      external
                      href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=debt-payoff-calculator&utm_content=budgero-section"
                      event="Trial CTA - Debt Calculator"
                    >
                      {t('budgero_cta')} <ArrowRight className="w-4 h-4 ml-2" aria-hidden />
                    </TrackedLink>
                  </Button>
                  <TrackedLink
                    href="/docs/debt-tracking"
                    event="Docs Link - Debt Calculator"
                    className="inline-flex items-center gap-1.5 text-foreground font-medium hover:underline"
                  >
                    <BookOpen className="w-4 h-4" aria-hidden /> {t('budgero_docs_link')}
                  </TrackedLink>
                </div>
                <p className="mt-4 text-sm text-foreground/55">{t('budgero_trial')}</p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-8 pb-20 max-w-3xl mx-auto">
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
          </div>
        </div>
      </div>
    </>
  );
}
