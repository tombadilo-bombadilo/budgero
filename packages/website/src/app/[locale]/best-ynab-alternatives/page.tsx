import { getTranslations, setRequestLocale } from 'next-intl/server';
import { withLocalizedUrls } from '@/lib/localized-metadata';
import { useTranslations } from 'next-intl';
import { ComparisonReferences } from '@/components/comparison-references';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { ArrowRight, Check, X, BookOpen } from 'lucide-react';
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
  return withLocalizedUrls(locale, '/best-ynab-alternatives', {
    title: copy('u_4d51c193d3c5'),
    description: copy('u_86cc536a1ba1'),
    keywords: [
      copy('u_1cf7f9f424ec'),
      copy('u_8a950b0938cf'),
      copy('u_f73b833514a0'),
      copy('u_cde1ec3cfb04'),
      copy('u_fd96684f83b6'),
      copy('u_0cb0fbb0c368'),
      copy('u_8196d4b0cb42'),
      copy('u_565d01ff7ed5'),
      copy('u_b05c62772f94'),
      copy('u_6d3fe9686468'),
      copy('u_7b0bb651841e'),
      copy('u_c3dea0eb5deb'),
    ],
    alternates: { canonical: 'https://budgero.app/best-ynab-alternatives' },
    openGraph: {
      title: copy('u_4d51c193d3c5'),
      description: copy('u_b138e91f7496'),
      url: 'https://budgero.app/best-ynab-alternatives',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: copy('u_4d51c193d3c5'),
      description: copy('u_52f7a720a190'),
    },
  });
}

const summaryData = (copy: CopyTranslator) => [
  {
    app: 'Budgero',
    price: copy('u_d7edca70d4fd', {
      p0: pricing.yearly,
    }),
    zeroBased: true,
    multiCurrency: true,
    encryption: copy('u_e38163aa3fd2'),
    bankSync: true,
    bankSyncNote: copy('u_6e7d19eaf95d'),
  },
  {
    app: 'Monarch Money',
    price: copy('u_f5a033caadb8'),
    zeroBased: true,
    multiCurrency: false,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
    bankSyncNote: copy('u_2c690c1f7aee'),
  },
  {
    app: 'Actual Budget',
    price: copy('u_33e9ba9f1114'),
    zeroBased: true,
    multiCurrency: false,
    encryption: copy('u_1c82e770ddd4'),
    bankSync: true,
    bankSyncNote: copy('u_cfde97097bc8'),
  },
  {
    app: 'PocketSmith',
    price: copy('u_76d3be7c2ef0'),
    zeroBased: false,
    multiCurrency: true,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
    bankSyncNote: copy('u_a258b30f88c3'),
  },
  {
    app: 'Simplifi by Quicken',
    price: copy('u_c4912800e5dd'),
    zeroBased: false,
    multiCurrency: false,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
    bankSyncNote: copy('u_2c690c1f7aee'),
  },
  {
    app: 'Goodbudget',
    price: copy('u_15f72e43480f'),
    zeroBased: true,
    multiCurrency: false,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
    bankSyncNote: copy('u_0fdadc3a8cb3'),
  },
  {
    app: 'EveryDollar',
    price: copy('u_d67b7a63bbf0'),
    zeroBased: true,
    multiCurrency: false,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
    bankSyncNote: copy('u_fad5e315c752'),
  },
  {
    app: 'Lunch Money',
    price: copy('u_f68d62aede35'),
    zeroBased: false,
    multiCurrency: true,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
  },
  {
    app: 'PocketGuard',
    price: copy('u_4681e5a0067e'),
    zeroBased: false,
    multiCurrency: false,
    encryption: copy('u_ef6691545d2c'),
    bankSync: true,
    bankSyncNote: copy('u_2c690c1f7aee'),
  },
];

const alternatives = (copy: CopyTranslator) => [
  {
    name: copy('u_045497ff4fcf'),
    sourceUrl: 'https://budgero.app/#pricing',
    comparisonHref: '/self-hostable',
    price: copy('u_5a87e7f3ddd4', {
      p0: pricing.yearly,
      p1: pricing.monthly,
    }),
    bestFor: copy('u_8cf508208f08'),
    pros: [
      copy('u_c53229329a68'),
      copy('u_24a75e7a5c52'),
      copy('u_5be9074fd435'),
      copy('u_f2cff3ec451c'),
      copy('u_562119ed3bdc'),
      copy('u_f3c34aa6b0ba'),
    ],
    cons: [copy('u_a53978b71592'), copy('u_2961ff71b69b'), copy('u_9c119ce56702')],
    take: copy('u_f2822d28bf93'),
  },
  {
    name: copy('u_96b3722151e7'),
    sourceUrl:
      'https://help.monarch.com/hc/en-us/articles/44815447567636-Updating-Your-Subscription',
    comparisonHref: '/monarch-money-alternative',
    price: copy('u_645f51ea844e'),
    bestFor: copy('u_9587e886a2ce'),
    pros: [
      copy('u_ae638532e8b5'),
      copy('u_58e06ca0fed7'),
      copy('u_aa4c2b2521ab'),
      copy('u_168e491d415b'),
    ],
    cons: [
      copy('u_61819bee7f2f'),
      copy('u_e3abc381b153'),
      copy('u_0df80f5e8c1b'),
      copy('u_53d5ff1545d3'),
    ],
    take: copy('u_91ddd305190c'),
  },
  {
    name: copy('u_a8a1810c10c5'),
    sourceUrl: 'https://actualbudget.org/docs/advanced/bank-sync/',
    comparisonHref: '/blog/actual-budget-vs-budgero',
    price: copy('u_4b45a01f036b'),
    bestFor: copy('u_80807f2a41c5'),
    pros: [
      copy('u_a25523de48e7'),
      copy('u_5134aa650a06'),
      copy('u_476df2be6b02'),
      copy('u_bbfdc803924e'),
    ],
    cons: [
      copy('u_0968a0e4ab2b'),
      copy('u_e3abc381b153'),
      copy('u_a8c199e23275'),
      copy('u_97d851223d4a'),
    ],
    take: copy('u_c12ef0147498'),
  },
  {
    name: copy('u_f7a336aad85f'),
    sourceUrl: 'https://www.pocketsmith.com/pricing/',
    comparisonHref: null,
    price: copy('u_d73e770f5d43'),
    bestFor: copy('u_e0548dd52c40'),
    pros: [
      copy('u_eca738b64946'),
      copy('u_b6746ad1bcf1'),
      copy('u_0cc2ea4752cd'),
      copy('u_2729004660c0'),
    ],
    cons: [
      copy('u_fd89eb0af181'),
      copy('u_cfae2e0148d4'),
      copy('u_7d0b52a7e27e'),
      copy('u_bb30f212d410'),
    ],
    take: copy('u_068cc91eea78'),
  },
  {
    name: copy('u_78274ae03c64'),
    sourceUrl: 'https://www.quicken.com/products/simplifi/',
    comparisonHref: '/quicken-simplifi-alternative',
    price: copy('u_50192a38edca'),
    bestFor: copy('u_050e3fd617e4'),
    pros: [
      copy('u_70349b4559f0'),
      copy('u_bbb3c74f1899'),
      copy('u_6822f02dca0e'),
      copy('u_5221776fc95c'),
    ],
    cons: [
      copy('u_639d902a9e7d'),
      copy('u_3ad8bc2c645b'),
      copy('u_9ed154898a70'),
      copy('u_13ef99c15fdf'),
    ],
    take: copy('u_5ca8599a0aae'),
  },
  {
    name: copy('u_44e97d65b726'),
    sourceUrl: 'https://goodbudget.com/help/billing/subscribe-to-goodbudget/',
    comparisonHref: '/goodbudget-alternative',
    price: copy('u_0c5bf1166e9b'),
    bestFor: copy('u_44ca5c6e5069'),
    pros: [
      copy('u_aa3f06c7a2d7'),
      copy('u_f7b3710c5138'),
      copy('u_bdce6c11ee27'),
      copy('u_180cd6c665fa'),
    ],
    cons: [
      copy('u_6aeb2029273f'),
      copy('u_71bb3bcd412e'),
      copy('u_3ea986aa37ad'),
      copy('u_9ed154898a70'),
    ],
    take: copy('u_408260c76a34'),
  },
  {
    name: copy('u_398f228bd577'),
    sourceUrl:
      'https://everydollar.help.ramseysolutions.com/hc/en-us/articles/21544207900685-EveryDollar-Premium-Subscription-Cost',
    comparisonHref: '/everydollar-alternative',
    price: copy('u_ad411516507a'),
    bestFor: copy('u_68be1b492ecc'),
    pros: [
      copy('u_7a3590e94a9b'),
      copy('u_027a8ed839d2'),
      copy('u_a1415f0c9f9a'),
      copy('u_00bf72877dc8'),
    ],
    cons: [
      copy('u_b6d0fe527479'),
      copy('u_0ee312e33247'),
      copy('u_242a0d53e30d'),
      copy('u_9ed154898a70'),
    ],
    take: copy('u_67ba6880037e'),
  },
  {
    name: copy('u_f5e2cc707264'),
    sourceUrl: 'https://lunchmoney.app/pricing',
    comparisonHref: null,
    price: copy('u_18af14823984'),
    bestFor: copy('u_a21794c31fd2'),
    pros: [
      copy('u_d458c964237f'),
      copy('u_a4928727ffce'),
      copy('u_d98c2d1962f5'),
      copy('u_40e0a1f87a21'),
    ],
    cons: [
      copy('u_52acd4d111d2'),
      copy('u_6e553c17c438'),
      copy('u_8d597e30cced'),
      copy('u_bc47fd57397a'),
    ],
    take: copy('u_8c2e36955524'),
  },
  {
    name: copy('u_101e03b4d670'),
    sourceUrl: 'https://pocketguard.com/pricing/',
    comparisonHref: '/pocketguard-alternative',
    price: copy('u_ea28eaf27d69'),
    bestFor: copy('u_bc2daecfa9c2'),
    pros: [
      copy('u_a922e080ae78'),
      copy('u_73677f03ea75'),
      copy('u_057e39c161db'),
      copy('u_b38885683247'),
    ],
    cons: [
      copy('u_368c449ae9c7'),
      copy('u_bcfcd3e9e28c'),
      copy('u_9ed154898a70'),
      copy('u_63ae78806632'),
    ],
    take: copy('u_c8a97b6f832c'),
  },
];

const pickGuide = (copy: CopyTranslator) => [
  {
    priority: copy('u_54a57c3147c4'),
    pick: copy('u_045497ff4fcf'),
    reason: copy('u_8dd6e3ce3128'),
  },
  {
    priority: copy('u_0394932949c7'),
    pick: copy('u_96b3722151e7'),
    reason: copy('u_614c40cf552d'),
  },
  {
    priority: copy('u_21c84449da5d'),
    pick: copy('u_f7a336aad85f'),
    reason: copy('u_b68f3273c525'),
  },
  {
    priority: copy('u_67a0d2e0dab4'),
    pick: copy('u_a8a1810c10c5'),
    reason: copy('u_e949a02afcb2'),
  },
  {
    priority: copy('u_e5bf6e1036a3'),
    pick: copy('u_045497ff4fcf'),
    reason: copy('u_88469300764a'),
  },
  {
    priority: copy('u_6d8f9ecff5aa'),
    pick: copy('u_045497ff4fcf'),
    reason: copy('u_b1d7bd9efbc2', {
      p0: pricing.yearly,
    }),
  },
  {
    priority: copy('u_f411a1fb6275'),
    pick: copy('u_df266575ce37'),
    reason: copy('u_fe23c32f68fe'),
  },
  {
    priority: copy('u_0588ebfd2367'),
    pick: copy('u_44e97d65b726'),
    reason: copy('u_169ba3b53366'),
  },
  {
    priority: copy('u_0a5ab4b2bb32'),
    pick: copy('u_f7a336aad85f'),
    reason: copy('u_00530632208c'),
  },
];

const faqs = (copy: CopyTranslator) => [
  {
    q: copy('u_8296930963b7'),
    a: copy('u_231e87d5924a'),
  },
  {
    q: copy('u_e84fe83188a8'),
    a: copy('u_adae4841ba81'),
  },
  {
    q: copy('u_e0530b140ca7'),
    a: copy('u_83dd5345dc2f'),
  },
  {
    q: copy('u_e039dd10f16f'),
    a: copy('u_d79114ea143d'),
  },
  {
    q: copy('u_cd6997b22c4b'),
    a: copy('u_3ad217757834'),
  },
  {
    q: copy('u_746465e4090d'),
    a: copy('u_8c82358540c3'),
  },
];

export default async function BestYnabAlternativesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const copy = await getTranslations({
    locale: (await params).locale,
    namespace: 'updates',
  });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: 'Best YNAB Alternatives in 2026 — 9 Apps Compared',
        author: { '@type': 'Organization', name: copy('u_045497ff4fcf') },
        datePublished: '2026-04-11',
        dateModified: '2026-09-05',
        description: copy('u_87bef7a80fd9'),
      },
      {
        '@type': 'ItemList',
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        numberOfItems: alternatives(copy).length,
        itemListElement: alternatives(copy).map((app, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: app.name,
          item: {
            '@type': 'SoftwareApplication',
            name: app.name,
            applicationCategory: 'FinanceApplication',
            description: copy('u_b637475a2034', {
              p0: app.bestFor,
            }),
          },
        })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs(copy).map((faq) => ({
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
            name: copy('u_3a78695388b3'),
            item: 'https://budgero.app/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: copy('u_96bbb2f18917'),
            item: 'https://budgero.app/best-ynab-alternatives',
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
                  className="mb-6 max-w-full whitespace-normal px-4 py-1.5 text-sm font-medium border-border/50"
                >
                  <BookOpen className="w-3.5 h-3.5 mr-2 shrink-0" />
                  <span>{copy('u_812d6a1dfb5b')}</span>
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  {' '}
                  {copy('u_214dfd6e3623')}{' '}
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    {' '}
                    {copy('u_304f20892cf6')}{' '}
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  {' '}
                  {copy('u_02a2b37db91b')}{' '}
                </p>

                <p className="text-sm text-foreground/55 max-w-2xl mx-auto">
                  {' '}
                  {copy('u_0705a8c9b612')}{' '}
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* How we compared */}
            <section className="py-12 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                {' '}
                {copy('u_a560a8a14788')}{' '}
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p> {copy('u_f714b11c309c')} </p>
                <p>
                  {' '}
                  {copy('u_fcb32857713c')}{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    {' '}
                    {copy('u_87814a1a0d81')}{' '}
                  </Link>{' '}
                  {copy('u_531a1a3be899')}{' '}
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Quick Summary Table */}
            <section className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  {' '}
                  {copy('u_7b3ec463252d')}{' '}
                </h2>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                        {' '}
                        {copy('u_0d04bfeb7d64')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        {' '}
                        {copy('u_93c91c851e7a')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        {' '}
                        {copy('u_3af82f6d7cea')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        {' '}
                        {copy('u_b0c0b860c176')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        {' '}
                        {copy('u_82f4e719a19c')}{' '}
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        {' '}
                        {copy('u_9cbff2ed85be')}{' '}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {summaryData(copy).map((row, index) => (
                      <tr
                        key={row.app}
                        className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/25'}
                      >
                        <td className="px-4 py-4 text-sm font-medium text-foreground">{row.app}</td>
                        <td className="px-4 py-4 text-center text-sm text-foreground/70">
                          {row.price}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {row.zeroBased ? (
                            <Check className="w-5 h-5 text-green-600 mx-auto" />
                          ) : (
                            <X className="w-5 h-5 text-foreground/35 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {row.multiCurrency ? (
                            <Check className="w-5 h-5 text-green-600 mx-auto" />
                          ) : (
                            <X className="w-5 h-5 text-foreground/35 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-4 text-center text-sm text-foreground/70">
                          {row.encryption}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {row.bankSync ? (
                            <div className="flex flex-col items-center gap-1">
                              <Check className="w-5 h-5 text-green-600" />
                              {row.bankSyncNote && (
                                <span className="text-xs text-foreground/55">
                                  {row.bankSyncNote}
                                </span>
                              )}
                            </div>
                          ) : (
                            <X className="w-5 h-5 text-foreground/35 mx-auto" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Individual Apps */}
            {alternatives(copy).map((app, idx) => (
              <div key={app.name}>
                <section className="py-12 max-w-4xl mx-auto">
                  <div className="bg-card rounded-2xl p-8 border border-border/70">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-2xl font-bold text-foreground">
                          {idx + 1}. {app.name}
                        </h3>
                        <p className="text-foreground/60 mt-1">
                          {copy('u_b217f8dbd77c')} {app.bestFor}
                        </p>
                      </div>
                      <span className="text-lg font-semibold text-foreground/80 md:max-w-sm md:shrink-0 md:text-right">
                        {app.price}
                      </span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">
                          {' '}
                          {copy('u_d49dbef4d908')}{' '}
                        </h4>
                        <ul className="space-y-2">
                          {app.pros.map((pro) => (
                            <li key={pro} className="flex items-start gap-2 text-foreground/75">
                              <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                              <span className="text-sm">{pro}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">
                          {' '}
                          {copy('u_5c5c68f419f2')}{' '}
                        </h4>
                        <ul className="space-y-2">
                          {app.cons.map((con) => (
                            <li key={con} className="flex items-start gap-2 text-foreground/75">
                              <X className="w-4 h-4 text-foreground/35 mt-0.5 flex-shrink-0" />
                              <span className="text-sm">{con}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <p className="text-sm text-foreground/60 italic">{app.take}</p>
                    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                      <a href={app.sourceUrl} className="underline hover:text-foreground">
                        {app.name}
                        {copy('u_9346754bb2b9')}{' '}
                      </a>
                      {app.comparisonHref && (
                        <Link href={app.comparisonHref} className="underline hover:text-foreground">
                          {app.name === 'Budgero'
                            ? copy('u_f85ad0ef2ecb')
                            : copy('u_6cdc50f888a1', {
                                p0: app.name,
                              })}
                        </Link>
                      )}
                    </div>
                  </div>
                </section>

                {idx < alternatives(copy).length - 1 && (
                  <div className="my-4 border-t border-border/40 max-w-4xl mx-auto" aria-hidden />
                )}
              </div>
            ))}

            <div className="my-12 border-t border-border" aria-hidden />

            {/* How to Choose */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  {' '}
                  {copy('u_c60bc43f27cd')}{' '}
                </h2>
                <p className="text-lg text-foreground/70">{copy('u_71e53a175996')}</p>
              </div>

              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <div className="space-y-4">
                  {pickGuide(copy).map((item) => (
                    <div
                      key={item.priority}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                    >
                      <span className="font-semibold text-foreground min-w-[140px]">
                        {item.priority}
                      </span>
                      <span className="text-foreground/70">
                        <strong className="text-foreground">{item.pick}</strong> &mdash;{' '}
                        {item.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Related guides */}
            <section className="py-12 max-w-3xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                {' '}
                {copy('u_6606e788eb40')}{' '}
              </h2>
              <ul className="space-y-3 text-lg text-foreground/75">
                <li>
                  {' '}
                  {copy('u_7eb2158c1283')}{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    {' '}
                    {copy('u_bdb2f3334b22')}{' '}
                  </Link>
                </li>
                <li>
                  {' '}
                  {copy('u_a29aab2e0767')}{' '}
                  <Link href="/ynab-alternative-uk" className="underline hover:text-foreground">
                    {' '}
                    {copy('u_0a3f5da3c59f')}{' '}
                  </Link>
                </li>
                <li>
                  {' '}
                  {copy('u_7f97c587a7bc')}{' '}
                  <Link
                    href="/ynab-alternative-australia"
                    className="underline hover:text-foreground"
                  >
                    {' '}
                    {copy('u_e7171254aee3')}{' '}
                  </Link>
                </li>
                {locale === 'en' && (
                  <li>
                    In Canada?{' '}
                    <Link
                      href="/ynab-alternative-canada"
                      className="underline hover:text-foreground"
                    >
                      YNAB alternative for Canada
                    </Link>
                  </li>
                )}
                <li>
                  {' '}
                  {copy('u_dfcc832a6b0e')}{' '}
                  <Link href="/firefly-iii-alternative" className="underline hover:text-foreground">
                    {' '}
                    {copy('u_b80151b56beb')}{' '}
                  </Link>
                </li>
                <li>
                  {' '}
                  {copy('u_ffdfddd5a1ed')}{' '}
                  <Link
                    href="/self-hosted-ynab-alternative"
                    className="underline hover:text-foreground"
                  >
                    {' '}
                    {copy('u_a79e58fec792')}{' '}
                  </Link>
                </li>
                <li>
                  {' '}
                  {copy('u_faedf0bbb3e2')}{' '}
                  <Link href="/vs-ynab" className="underline hover:text-foreground">
                    {' '}
                    {copy('u_4293060f6a11')}{' '}
                  </Link>
                </li>
                <li>
                  {' '}
                  {copy('u_88adde6a4b0d')}{' '}
                  <Link
                    href="/monarch-money-alternative"
                    className="underline hover:text-foreground"
                  >
                    {' '}
                    {copy('u_cfe26f3d52ce')}{' '}
                  </Link>
                </li>
              </ul>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-10">
                {' '}
                {copy('u_a3d458e1bd1e')}{' '}
              </h2>
              <div className="space-y-8">
                {faqs(copy).map((faq) => (
                  <div key={faq.q}>
                    <h3 className="text-lg font-semibold text-foreground mb-2">{faq.q}</h3>
                    <p className="text-foreground/70 leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            <ComparisonReferences
              reviewedOn="2026-09-05"
              sources={[
                { label: copy('u_231b0d1311ac'), href: 'https://www.ynab.com/pricing' },
                {
                  label: copy('u_f155eb4760f5'),
                  href: 'https://support.ynab.com/en_us/direct-import-in-europe-Syae1z_A9',
                },
                { label: copy('u_979488f8ded1'), href: 'https://www.ynab.com/security' },
                {
                  label: copy('u_98a78b177cab'),
                  href: 'https://support.simplifi.quicken.com/en/articles/3828353-what-currencies-does-quicken-simplifi-support',
                },
                {
                  label: copy('u_acd82be1e52d'),
                  href: 'https://actualbudget.org/docs/budgeting/multi-currency/',
                },
                { label: copy('u_1520e2eb5966'), href: 'https://actualbudget.org/docs/faq/' },
              ]}
            />

            <TestimonialsSection />

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Final CTA */}
            <section className="py-20 text-center">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  {' '}
                  {copy('u_3f397f5743c3')}{' '}
                </h2>
                <p className="text-lg text-foreground/70 mb-8"> {copy('u_11f55c3d9334')} </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=best-ynab-alternatives&utm_content=final">
                      {' '}
                      {copy('u_d4ddd6ce6fb8')} <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  {' '}
                  {copy('u_f970e30131a2')}{' '}
                  <Link href="/self-hostable" className="underline hover:text-foreground">
                    {' '}
                    {copy('u_a967afa170d4')}{' '}
                  </Link>{' '}
                  {copy('u_ec636432ff1b')}{' '}
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
