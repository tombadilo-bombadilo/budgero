import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { withLocalizedUrls } from '@/lib/localized-metadata';
import { Link } from '@/i18n/navigation';
import { ArrowRight, Check, X, Download, PoundSterling } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const copy = await getTranslations({
    locale: (await params).locale,
    namespace: 'updates',
  });
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ynab_alternative_uk' });
  return withLocalizedUrls(locale, '/ynab-alternative-uk', {
    title: t('meta_title'),
    description: t('meta_description', {
      monthly: pricing.monthly,
      yearly: pricing.yearly,
      yearlyEquivMonthly: pricing.yearlyEquivMonthly,
    }),
    keywords: [
      copy('u_f9bcdf6da636'),
      copy('u_cd95de5dc351'),
      copy('u_20a529ac3d98'),
      copy('u_b89cbc49af83'),
      copy('u_96af89428a50'),
      copy('u_0a2142c55635'),
      copy('u_49c116fd9be2'),
      copy('u_1f755deb526c'),
      copy('u_535c987447f7'),
      copy('u_65c44d0c177c'),
      copy('u_3872574fc3af'),
      copy('u_5211dfed6e46'),
    ],
    alternates: { canonical: 'https://budgero.app/ynab-alternative-uk' },
    openGraph: {
      title: t('meta_title'),
      description: t('og_description'),
      url: 'https://budgero.app/ynab-alternative-uk',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta_title'),
      description: t('tw_description'),
    },
  });
}

const makeComparisonData = (
  t: (key: string, values?: Record<string, string | number>) => string,
  copy: CopyTranslator
) => [
  {
    feature: t('comparisonData_built_for_the_uk'),
    budgero: true,
    ynab: t('cell_partial'),
    budgeroNote: t('comparisonData_gbp_first_works_with_every_uk'),
    ynabNote: t('comparisonData_returned_2024_25_via_plaid_select'),
  },
  {
    feature: t('comparisonData_works_with_your_bank'),
    budgero: t('comparisonData_all_uk_banks'),
    ynab: t('comparisonData_select_banks'),
    budgeroNote: t('comparisonData_csv_import_from_monzo_starling_anyone'),
    ynabNote: t('comparisonData_monzo_revolut_natwest_hsbc_in_many'),
  },
  {
    feature: t('comparisonData_gbp_eur_in_one_budget'),
    budgero: true,
    ynab: false,
    budgeroNote: t('comparisonData_168_currencies_with_live_fx'),
    ynabNote: t('comparisonData_one_currency_per_budget'),
  },
  {
    feature: t('comparisonData_billing_currency'),
    budgero: 'GBP',
    ynab: t('comparisonData_usd_only'),
    budgeroNote: t('comparisonData_no_fx_fees_on_your_card'),
    ynabNote: t('comparisonData_109_yr_card_fx_fees'),
  },
  {
    feature: t('comparisonData_annual_price'),
    budgero: copy('u_6730f1c07c70', {
      p0: pricing.yearly,
    }),
    ynab: t('comparisonData_109_year_85'),
    budgeroNote: t('comparisonData_or_free_with_self_host'),
    ynabNote: null,
  },
  {
    feature: t('comparisonData_end_to_end_encryption'),
    budgero: true,
    ynab: false,
    budgeroNote: t('comparisonData_aes_256_gcm_zero_knowledge'),
    ynabNote: t('comparisonData_plaintext_on_their_servers'),
  },
  {
    feature: t('comparisonData_where_your_data_lives'),
    budgero: t('comparisonData_finland_eu'),
    ynab: t('comparisonData_united_states'),
    budgeroNote: t('comparisonData_zero_knowledge_encrypted_eu_jurisdiction'),
    ynabNote: t('comparisonData_subject_to_us_data_law'),
  },
  {
    feature: t('comparisonData_telemetry_tracking'),
    budgero: t('comparisonData_no_ads_no_cookies'),
    ynab: true,
    budgeroNote: t('comparisonData_cookieless_analytics_you_can_switch_off'),
    ynabNote: t('comparisonData_third_party_analytics_by_default'),
  },
  {
    feature: t('comparisonData_offline_mode'),
    budgero: true,
    ynab: false,
    budgeroNote: t('comparisonData_pwa_works_fully_offline'),
    ynabNote: t('comparisonData_requires_internet'),
  },
  {
    feature: t('comparisonData_zero_based_budgeting'),
    budgero: true,
    ynab: true,
    budgeroNote: null,
    ynabNote: null,
  },
  {
    feature: t('comparisonData_ynab_data_import'),
    budgero: true,
    ynab: 'N/A',
    budgeroNote: t('comparisonData_full_categories_transactions_history'),
    ynabNote: null,
  },
  {
    feature: t('comparisonData_self_host_option'),
    budgero: true,
    ynab: false,
    budgeroNote: t('comparisonData_docker_your_own_server'),
    ynabNote: null,
  },
];

const makeFaqs = (t: (key: string, values?: Record<string, string | number>) => string) => [
  {
    q: t('faqs_does_ynab_still_work_in_the'),
    a: t('faqs_sort_of_ynab_officially_withdrew_from'),
  },
  {
    q: t('faqs_does_budgero_work_with_uk_banks'),
    a: t('faqs_yes_with_every_uk_bank_because'),
  },
  {
    q: t('faqs_can_i_budget_in_gbp_and'),
    a: t('faqs_yes_budgero_supports_168_currencies_in'),
  },
  {
    q: t('faqs_how_much_does_budgero_cost_in'),
    a: t('faqs_budgero_cloud_is_monthly_month_or', {
      monthly: pricing.monthly,
      yearly: pricing.yearly,
    }),
  },
  {
    q: t('faqs_can_i_import_my_ynab_budget'),
    a: t('faqs_yes_budgero_imports_ynab_export_files'),
  },
  {
    q: t('faqs_where_is_my_data_stored'),
    a: t('faqs_in_finland_in_the_eu_under'),
  },
  {
    q: t('faqs_is_there_a_free_version'),
    a: t('faqs_yes_budgero_self_host_is_completely'),
  },
];

function renderCellValue(val: unknown, note?: string | null, isHighlight?: boolean) {
  if (typeof val === 'boolean') {
    return (
      <div className="flex flex-col items-center gap-1">
        {val ? (
          <Check className="w-5 h-5 text-green-600" />
        ) : (
          <X className="w-5 h-5 text-foreground/35" />
        )}
        {note && <span className="text-xs text-foreground/55">{note}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`text-sm ${isHighlight ? 'font-medium text-[#2f6246]' : 'text-foreground/65'}`}
      >
        {String(val)}
      </span>
      {note && <span className="text-xs text-foreground/55">{note}</span>}
    </div>
  );
}

export default async function YnabAlternativeUkPage({
  params,
}: {
  params: Promise<{
    locale: string;
  }>;
}) {
  const copy = await getTranslations({
    locale: (await params).locale,
    namespace: 'updates',
  });
  const { locale } = await params;

  setRequestLocale(locale);
  const t = await getTranslations({
    locale: (await params).locale,
    namespace: 'ynab_alternative_uk',
  });
  const faqs = makeFaqs(t);
  const comparisonData = makeComparisonData(t, copy);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: copy('u_045497ff4fcf'),
        applicationCategory: 'FinanceApplication',
        operatingSystem: [
          copy('u_2975104784a4'),
          copy('u_d598026a9cbc'),
          copy('u_aed6b7aa2a05'),
          copy('u_4828e60247c1'),
        ],
        url: 'https://budgero.app/ynab-alternative-uk',
        description: copy('u_318c6c2f5431'),
        offers: [
          {
            '@type': 'Offer',
            name: copy('u_02c52ce2f60b'),
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: copy('u_94523db6cbd4'),
            price: pricing.monthly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: copy('u_6fdf0566337b'),
            price: pricing.yearly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
        ],
        featureList: [
          copy('u_0c3992b67600'),
          copy('u_538c50736958'),
          copy('u_e6072dcb869e'),
          copy('u_1043ef737af6'),
          copy('u_42077391e2da'),
          copy('u_05139f16c815'),
          copy('u_7fbac46a5a55'),
          copy('u_9a326d07d39f'),
          copy('u_170eda937fe7'),
          copy('u_a87f8b3aa36a'),
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.a,
          },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: copy('u_3a78695388b3'),
            item: 'https://budgero.app/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: copy('u_23bd4f675761'),
            item: 'https://budgero.app/ynab-alternative-uk',
          },
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
            <section className="pt-24 pb-16 md:pt-32 md:pb-24 text-center">
              <div className="max-w-4xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 max-w-full whitespace-normal text-center px-3 py-1.5 text-xs sm:text-sm font-medium border-blue-500/30 text-blue-700 dark:text-blue-400 bg-blue-500/10"
                >
                  <PoundSterling className="w-3.5 h-3.5 mr-2 shrink-0" />
                  <span>{t('built_for_the_uk_billed_in')}</span>
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  {' '}
                  {t('the_ynab_alternative_for_the_uk')}{' '}
                  <span className="block text-2xl md:text-3xl mt-3 text-foreground/70 font-medium">
                    {' '}
                    {t('gbp_budgeting_that_works_with_every')}{' '}
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  {' '}
                  {t('ynab_left_the_uk_in_2022')}{' '}
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-uk&utm_content=hero">
                      {' '}
                      {t('start_35_day_free_trial')} <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <a href="#comparison">{t('see_the_uk_comparison')}</a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  {' '}
                  {t('35_days_free_no_card_needed')}{' '}
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why UK YNAB users are leaving */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                {' '}
                {t('why_uk_ynab_users_are_switching')}{' '}
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p> {t('ynab_s_relationship_with_the_uk')} </p>

                <div className="space-y-4">
                  <p>
                    <strong className="text-foreground">{t('bank_coverage_is_selective')}</strong>{' '}
                    {t('monzo_revolut_nationwide_natwest_hsbc_and')}{' '}
                  </p>
                  <p>
                    <strong className="text-foreground">{t('you_pay_in_dollars')}</strong>{' '}
                    {t('109_year_lands_as_roughly_85')}{' '}
                  </p>
                  <p>
                    <strong className="text-foreground">{t('no_multi_currency')}</strong>{' '}
                    {t('if_you_hold_eur_for_work')}{' '}
                  </p>
                  <p>
                    <strong className="text-foreground">
                      {t('your_data_crosses_the_atlantic')}
                    </strong>{' '}
                    {t('ynab_stores_budgets_in_plaintext_on')}{' '}
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section id="comparison" className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  {' '}
                  {t('budgero_vs_ynab_the_uk_view')}{' '}
                </h2>
                <p className="text-lg text-foreground/70">
                  {' '}
                  {t('where_it_actually_matters_for_uk')}{' '}
                </p>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                        {' '}
                        {t('feature')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        {' '}
                        {t('budgero')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        YNAB
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {comparisonData.map((row, index) => (
                      <tr
                        key={row.feature}
                        className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/25'}
                      >
                        <td className="px-4 py-4 text-sm font-medium text-foreground">
                          {row.feature}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {renderCellValue(row.budgero, row.budgeroNote, true)}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {renderCellValue(row.ynab, row.ynabNote, false)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="h-12 px-7 text-base bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-uk&utm_content=mid-table">
                    {' '}
                    {t('start_35_day_free_trial')} <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <span className="text-sm text-foreground/60">
                  {' '}
                  {t('no_card_gbp_billing_works_with')}{' '}
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* UK banking reality */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                {' '}
                {t('works_with_monzo_starling_and_the')}{' '}
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p> {t('budgero_skips_the_bank_aggregator_middleman')} </p>
                <p> {t('the_upside_of_doing_it_this')} </p>
                <p>
                  {' '}
                  {t('and_if_you_earn_or_spend')}{' '}
                  <Link
                    href="/multi-currency-budgeting"
                    className="underline hover:text-foreground"
                  >
                    {' '}
                    {t('gbp_and_eur_side_by_side')}{' '}
                  </Link>{' '}
                  {t('with_live_exchange_rates_something_ynab')}{' '}
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-10">
                {' '}
                {t('frequently_asked_questions')}{' '}
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

            <div className="my-12 border-t border-border" aria-hidden />

            <TestimonialsSection />

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Final CTA */}
            <section className="py-20 text-center">
              <div className="max-w-2xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
                >
                  <Download className="w-3.5 h-3.5 mr-2" /> {t('35_days_free_no_card')}{' '}
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  {' '}
                  {t('budget_in_pounds_privately_without_the')}{' '}
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  {' '}
                  {t('start_your_35_day_budgero_cloud')}{' '}
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-uk&utm_content=final">
                      {' '}
                      {t('start_free_trial')} <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <Link href="/self-hosted-ynab-alternative">{t('prefer_to_self_host')}</Link>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  {' '}
                  {t('also_see')}{' '}
                  <Link href="/best-ynab-alternatives" className="underline hover:text-foreground">
                    {' '}
                    {t('best_ynab_alternatives_in_2026')}{' '}
                  </Link>{' '}
                  ·{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    {' '}
                    {t('ynab_alternative_for_europe')}{' '}
                  </Link>{' '}
                  ·{' '}
                  <Link href="/vs-ynab" className="underline hover:text-foreground">
                    {' '}
                    {t('full_budgero_vs_ynab_comparison')}{' '}
                  </Link>
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
type CopyTranslator = (key: string, values?: Record<string, string | number>) => string;
