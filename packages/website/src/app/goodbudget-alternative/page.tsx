import type { Metadata } from 'next';
import { ArrowRight, Check, X, Shield, Globe, BarChart3, Paintbrush } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Goodbudget Alternative - Encrypted Envelope Budgeting | Budgero',
  description:
    'Looking for a Goodbudget alternative? Budgero offers envelope budgeting with zero-knowledge encryption, 168 currencies, modern UI, and powerful reporting.',
  keywords: [
    'goodbudget alternative',
    'goodbudget replacement',
    'envelope budgeting app',
    'goodbudget vs budgero',
    'envelope budgeting private',
    'budget app for couples',
  ],
  alternates: { canonical: 'https://budgero.app/goodbudget-alternative' },
  openGraph: {
    title: 'Goodbudget Alternative - Encrypted Envelope Budgeting | Budgero',
    description:
      'Looking for a Goodbudget alternative? Budgero offers envelope budgeting with zero-knowledge encryption, 168 currencies, modern UI, and powerful reporting.',
    url: 'https://budgero.app/goodbudget-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Goodbudget Alternative - Encrypted Envelope Budgeting | Budgero',
    description:
      'Looking for a Goodbudget alternative? Budgero offers envelope budgeting with zero-knowledge encryption, 168 currencies, modern UI, and powerful reporting.',
  },
};

const comparisonData = [
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    goodbudget: '$70/year',
    budgeroNote: 'Or free with Self-Host',
    goodbudgetNote: 'Plus plan; free tier available',
  },
  {
    feature: 'Envelope / zero-based method',
    budgero: true,
    goodbudget: true,
    budgeroNote: null,
    goodbudgetNote: null,
  },
  {
    feature: 'Zero-knowledge encryption',
    budgero: true,
    goodbudget: false,
    budgeroNote: 'We cannot see your data',
    goodbudgetNote: 'Standard server-side storage',
  },
  {
    feature: 'Bank sync',
    budgero: false,
    goodbudget: false,
    budgeroNote: null,
    goodbudgetNote: null,
  },
  {
    feature: 'Multi-currency support',
    budgero: true,
    goodbudget: false,
    budgeroNote: '168 currencies, live FX rates',
    goodbudgetNote: 'Single currency only',
  },
  {
    feature: 'Works offline',
    budgero: true,
    goodbudget: true,
    budgeroNote: null,
    goodbudgetNote: null,
  },
  {
    feature: 'Shared budgets',
    budgero: true,
    goodbudget: true,
    budgeroNote: '5 seats included',
    goodbudgetNote: 'Sync between partners',
  },
  {
    feature: 'Reporting & analytics',
    budgero: 'Advanced',
    goodbudget: 'Basic',
    budgeroNote: 'Spending breakdowns, net worth, trends',
    goodbudgetNote: 'Simple spending reports',
  },
  {
    feature: 'Mobile app',
    budgero: 'PWA',
    goodbudget: 'Native',
    budgeroNote: 'Works on any device via browser',
    goodbudgetNote: 'iOS and Android apps',
  },
  {
    feature: 'Self-host option',
    budgero: true,
    goodbudget: false,
    budgeroNote: 'Full features, free forever',
    goodbudgetNote: null,
  },
  {
    feature: 'CSV / data import',
    budgero: true,
    goodbudget: true,
    budgeroNote: 'CSV, PDF, YNAB import',
    goodbudgetNote: 'CSV import',
  },
];

export default function GoodbudgetAlternativePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    image: 'https://budgero.app/logo_512.png',
    name: 'Budgero',
    applicationCategory: 'FinanceApplication',
    operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
    url: 'https://budgero.app/goodbudget-alternative',
    description:
      'Goodbudget alternative with envelope budgeting, zero-knowledge encryption, 168 currencies, and modern reporting.',
    offers: {
      '@type': 'Offer',
      price: pricing.yearly.replace(/[^0-9.]/g, ''),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    featureList: [
      'Envelope / zero-based budgeting',
      'Zero-knowledge encryption',
      '168 currencies with live exchange rates',
      'Spending breakdowns and trend analysis',
      'Shared budgets with 5 seats',
      'Self-host option',
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
            {/* Hero Section */}
            <section className="pt-24 pb-16 md:pt-32 md:pb-24 text-center">
              <div className="max-w-4xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-600/30 text-green-700 bg-green-50"
                >
                  <Shield className="w-3.5 h-3.5 mr-2" />
                  Modern Envelope Budgeting
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  Goodbudget Alternative
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    Envelope budgeting with encryption, multi-currency, and modern design
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Goodbudget is simple and reliable, but its interface and feature set haven&apos;t
                  kept up. Budgero takes the same envelope-based, zero-based philosophy and adds
                  zero-knowledge encryption, 168 currencies, modern reporting, and a polished
                  interface.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=goodbudget-alternative&utm_content=hero">
                      Start 35-Day Free Trial
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <a href="/self-hostable">
                      Explore Self-Host
                    </a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  No credit card required. Zero-knowledge encryption on all plans.
                  <br />
                  Or{' '}
                  <a
                    href="/self-hostable"
                    className="underline hover:text-foreground"
                  >
                    self-host for free
                  </a>{' '}
                  with full features.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Key Differences Section */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Why Switch from Goodbudget?
                </h2>
                <p className="text-lg text-foreground/70">
                  Goodbudget nails the basics. Here&apos;s where Budgero goes further.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#e4dff0] flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-[#564176]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Zero-Knowledge Encryption
                  </h3>
                  <p className="text-foreground/70">
                    Goodbudget uses standard server-side storage. Budgero encrypts everything on your
                    device before it leaves. We literally cannot see your financial data.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dfe4ec] flex items-center justify-center mb-4">
                    <Globe className="w-6 h-6 text-[#314258]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    168 Currencies
                  </h3>
                  <p className="text-foreground/70">
                    Goodbudget is single-currency only. Budgero handles 168 currencies with live
                    exchange rates and automatic conversion in a single budget.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dde9df] flex items-center justify-center mb-4">
                    <BarChart3 className="w-6 h-6 text-[#2f6246]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Modern Reporting
                  </h3>
                  <p className="text-foreground/70">
                    Goodbudget offers basic spending reports. Budgero provides detailed spending
                    breakdowns, net worth tracking, and trend analysis across all your accounts.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#efe4d8] flex items-center justify-center mb-4">
                    <Paintbrush className="w-6 h-6 text-[#8a5730]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Modern Interface
                  </h3>
                  <p className="text-foreground/70">
                    Goodbudget&apos;s UI hasn&apos;t changed much in years. Budgero is built with a
                    modern, polished design that feels responsive and refined on every screen size.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs Goodbudget
                </h2>
                <p className="text-lg text-foreground/70">
                  Feature-by-feature comparison
                </p>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                <table className="w-full">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                        Feature
                      </th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-foreground">
                        Budgero
                      </th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-foreground">
                        Goodbudget
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {comparisonData.map((row, index) => (
                      <tr
                        key={row.feature}
                        className={
                          index % 2 === 0
                            ? 'bg-transparent'
                            : 'bg-muted/25'
                        }
                      >
                        <td className="px-6 py-4 text-sm font-medium text-foreground">
                          {row.feature}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {typeof row.budgero === 'boolean' ? (
                            <div className="flex flex-col items-center gap-1">
                              {row.budgero ? (
                                <Check className="w-5 h-5 text-green-600" />
                              ) : (
                                <X className="w-5 h-5 text-foreground/35" />
                              )}
                              {row.budgeroNote && (
                                <span className="text-xs text-foreground/55">{row.budgeroNote}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm font-medium text-[#2f6246]">
                                {row.budgero}
                              </span>
                              {row.budgeroNote && (
                                <span className="text-xs text-foreground/55">{row.budgeroNote}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {typeof row.goodbudget === 'boolean' ? (
                            <div className="flex flex-col items-center gap-1">
                              {row.goodbudget ? (
                                <Check className="w-5 h-5 text-green-600" />
                              ) : (
                                <X className="w-5 h-5 text-foreground/35" />
                              )}
                              {row.goodbudgetNote && (
                                <span className="text-xs text-foreground/55">{row.goodbudgetNote}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm text-foreground/65">
                                {row.goodbudget}
                              </span>
                              {row.goodbudgetNote && (
                                <span className="text-xs text-foreground/55">{row.goodbudgetNote}</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Where Goodbudget Wins */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                  Where Goodbudget Wins
                </h2>
                <p className="text-lg text-foreground/75 mb-6">
                  Goodbudget has real strengths. Here&apos;s where it still comes out ahead:
                </p>
                <ul className="space-y-4 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Simpler learning curve:</strong>{' '}
                      Goodbudget keeps things minimal. If you just want envelopes without extra
                      features, it&apos;s easier to pick up.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Native mobile apps:</strong>{' '}
                      Goodbudget has dedicated iOS and Android apps. Budgero uses a PWA that works
                      on all devices but is not listed in app stores.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Free tier:</strong>{' '}
                      Goodbudget offers a free plan with limited envelopes and accounts. Budgero
                      Cloud requires a paid subscription (though you can{' '}
                      <a href="/self-hostable" className="underline hover:text-foreground">
                        self-host for free
                      </a>
                      ).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Long track record for couples:</strong>{' '}
                      Goodbudget has been helping couples budget together for over a decade. It has
                      a proven, stable workflow for shared household finances.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Switch or Stick */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-[#e8f0e8] rounded-2xl p-8 border border-[#bfd7c2]">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <Check className="w-6 h-6 text-green-600" />
                    Switch to Budgero if:
                  </h3>
                  <ul className="space-y-3 text-foreground/80">
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You want zero-knowledge encryption for your financial data</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You manage money in multiple currencies</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You need deeper reporting: spending breakdowns, net worth, trends</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You want a modern, polished interface</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        You want to{' '}
                        <a href="/self-hostable" className="underline">
                          self-host
                        </a>{' '}
                        with full features for free
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Stick with Goodbudget if:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You prefer the simplest possible envelope system</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You need a native app from the App Store or Google Play</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You want a free plan for basic budgeting</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You only use one currency and don&apos;t need advanced reports</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            <TestimonialsSection />

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Final CTA */}
            <section className="py-20 text-center">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Ready to switch from Goodbudget?
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Try Budgero free for 35 days. Envelope budgeting with zero-knowledge encryption,
                  168 currencies, and modern reporting.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=goodbudget-alternative&utm_content=final">
                      Start Free Trial
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Want all features for free?{' '}
                  <a
                    href="/self-hostable"
                    className="underline hover:text-foreground"
                  >
                    Self-host Budgero
                  </a>{' '}
                  with full sync, multi-currency, and collaboration.
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Still exploring? Compare the{' '}
                  <a
                    href="/best-ynab-alternatives"
                    className="underline hover:text-foreground"
                  >
                    YNAB alternatives
                  </a>{' '}
                  worth switching to.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
