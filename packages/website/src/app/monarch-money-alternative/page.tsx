import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Globe, Shield, Cpu, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Monarch Money Alternative — Private, No Plaid Required | Budgero',
  description:
    'Budgero is the private Monarch Money alternative: zero-knowledge encryption, no Plaid, no bank credentials shared — and 40% cheaper. Works in 168 currencies, anywhere. 35-day free trial, no card.',
  keywords: [
    'monarch money alternative',
    'monarch alternative',
    'monarch money multi currency',
    'monarch money europe alternative',
    'monarch money international',
    'monarch money replacement',
    'privacy budgeting app',
    'international budgeting app',
    'monarch money vs budgero',
    'budgeting app outside us',
  ],
  alternates: { canonical: 'https://budgero.app/monarch-money-alternative' },
  openGraph: {
    title: 'Monarch Money Alternative — Private, No Plaid Required | Budgero',
    description:
      'Zero-knowledge encryption, no Plaid, no bank credentials shared — and 40% cheaper than Monarch. Works in 168 currencies, anywhere in the world.',
    url: 'https://budgero.app/monarch-money-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Monarch Money Alternative — Private, No Plaid Required | Budgero',
    description:
      'Zero-knowledge encryption, no Plaid, no bank credentials shared — and 40% cheaper than Monarch. Works in 168 currencies, anywhere.',
  },
};

const comparisonData = [
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    monarch: '$99.99/year',
    budgeroNote: 'Or free with Self-Host',
    monarchNote: null,
  },
  {
    feature: 'Monthly price',
    budgero: `${pricing.monthly}/mo`,
    monarch: '$14.99/mo',
    budgeroNote: null,
    monarchNote: null,
  },
  {
    feature: 'Multi-currency support',
    budgero: true,
    monarch: false,
    budgeroNote: 'Live FX rates, auto conversion',
    monarchNote: 'USD/CAD only, no conversion',
  },
  {
    feature: 'Works worldwide',
    budgero: true,
    monarch: false,
    budgeroNote: null,
    monarchNote: 'US & Canada only',
  },
  {
    feature: 'Works offline',
    budgero: true,
    monarch: false,
    budgeroNote: null,
    monarchNote: 'Cloud-only, needs internet',
  },
  {
    feature: 'Zero-knowledge encryption',
    budgero: true,
    monarch: false,
    budgeroNote: 'We cannot see your data',
    monarchNote: 'Bank-level, but not zero-knowledge',
  },
  {
    feature: 'Local LLM integration',
    budgero: true,
    monarch: false,
    budgeroNote: 'Connect to locally-hosted models',
    monarchNote: 'Uses third-party AI (data processed externally)',
  },
  {
    feature: 'Bank sync',
    budgero: 'Push API*',
    monarch: true,
    budgeroNote: 'DIY with encrypted Python SDK',
    monarchNote: 'US/Canada banks only',
  },
  {
    feature: 'Investment tracking',
    budgero: 'Manual',
    monarch: 'Automatic',
    budgeroNote: null,
    monarchNote: 'Syncs with brokerages',
  },
  {
    feature: 'Zero-based budgeting',
    budgero: true,
    monarch: true,
    budgeroNote: null,
    monarchNote: null,
  },
  {
    feature: 'Shared budgets',
    budgero: true,
    monarch: true,
    budgeroNote: null,
    monarchNote: null,
  },
  {
    feature: 'Free tier available',
    budgero: true,
    monarch: false,
    budgeroNote: 'Budgero Self-Host is free forever',
    monarchNote: '7-day trial only',
  },
];

const faqs = [
  {
    q: 'Does Monarch Money work outside the US?',
    a: 'Not really. Monarch Money is built for the US (with limited Canadian support). You cannot connect non-US/Canadian banks, the iOS app is not in most international App Stores, and balances are displayed as plain "$" with no currency conversion. If you live outside North America, manage money in multiple currencies, or travel often, Monarch is effectively unusable.',
  },
  {
    q: 'What is the cheapest Monarch Money alternative?',
    a: `Budgero. Budgero Cloud is ${pricing.monthly}/month or ${pricing.yearly}/year — about 40% less than Monarch Money's $99.99/year. You get a 35-day free trial with no credit card, native multi-currency support, zero-knowledge encryption, and offline mode. If you do not want to pay anything at all, Budgero Self-Host is free forever on your own Docker server.`,
  },
  {
    q: 'Does Budgero connect to my bank like Monarch Money does?',
    a: 'No, and that is by design. Bank sync requires sharing credentials with a third-party aggregator (Plaid, MX, Tink), which limits the providers you can use, restricts which countries the app works in, and prevents true zero-knowledge encryption. Budgero is manual-first: enter transactions yourself, import CSVs from any bank in the world, or use our Push API for DIY automation. The trade-off is that Budgero works literally everywhere, your credentials stay yours, and your data is end-to-end encrypted.',
  },
  {
    q: 'Can I import my Monarch Money data into Budgero?',
    a: 'Yes. Budgero imports CSV exports from Monarch (and from most other budgeting apps including YNAB, Mint, EveryDollar, and Goodbudget). Categories, transactions, and account balances come across. You get a preview before confirming, so nothing is overwritten unexpectedly. Most users finish migrating in under 15 minutes.',
  },
  {
    q: 'Does Budgero support shared budgets like Monarch Money?',
    a: 'Yes. Budgero Cloud supports encrypted shared workspaces — invite your partner or roommates and budget together, with every transaction still end-to-end encrypted in transit and at rest. Self-Host users can run a shared server for the same effect.',
  },
  {
    q: 'Is Budgero really 40% cheaper than Monarch Money?',
    a: `Yes, and there is no asterisk. Monarch is $99.99/year. Budgero Cloud is ${pricing.yearly}/year for the full feature set — multi-currency, zero-knowledge encryption, encrypted sync, shared budgets, AI categorization, and 35-day cardless trial. Budgero Self-Host is free forever and includes the same feature set. There is no "premium" upsell tier.`,
  },
  {
    q: 'What about investment tracking — Monarch syncs with brokerages.',
    a: 'Budgero supports manual investment tracking — you can record any asset, in any currency, at any value. Automatic brokerage sync is something Monarch does well in the US, but it does not work with European, UK, Asian, or most non-US brokerages anyway. If you live outside the US, manual tracking is what you would end up with on Monarch too — just without multi-currency support.',
  },
  {
    q: 'Can I self-host Budgero?',
    a: `Yes. Budgero Self-Host is free, runs on Docker, and includes the full feature set — zero-knowledge encryption, multi-currency, shared budgets, and YNAB import. No license keys, no feature gating, no telemetry. You can run it on a Raspberry Pi, NAS (Synology, Unraid, TrueNAS), homelab server, or any cloud VPS. Monarch has no self-host option.`,
  },
];

const MONARCH_YEARLY_USD = 99.99;

function priceNumber(displayPrice: string): string {
  return displayPrice.replace(/[^0-9.]/g, '');
}

export default function MonarchMoneyAlternativePage() {
  const budgeroYearly = parseFloat(priceNumber(pricing.yearly));
  const yearlySavings = Math.max(0, Math.round(MONARCH_YEARLY_USD - budgeroYearly));
  const percentCheaper = Math.max(
    0,
    Math.round(((MONARCH_YEARLY_USD - budgeroYearly) / MONARCH_YEARLY_USD) * 100)
  );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        image: 'https://budgero.app/logo_512.png',
        name: 'Budgero',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
        url: 'https://budgero.app/monarch-money-alternative',
        description:
          'Monarch Money alternative with multi-currency support, zero-knowledge encryption, offline mode, and local LLM integration. Works worldwide.',
        offers: [
          {
            '@type': 'Offer',
            name: 'Budgero Self-Host',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            priceValidUntil: '2026-12-31',
          },
          {
            '@type': 'Offer',
            name: 'Budgero Cloud (monthly)',
            price: priceNumber(pricing.monthly),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            priceValidUntil: '2026-12-31',
          },
          {
            '@type': 'Offer',
            name: 'Budgero Cloud (yearly)',
            price: priceNumber(pricing.yearly),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            priceValidUntil: '2026-12-31',
          },
        ],
        featureList: [
          'Multi-currency with live exchange rates',
          'Zero-knowledge encryption',
          'Offline support',
          'Integrates with locally-hosted LLMs',
          'Works worldwide',
          'Zero-based budgeting',
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
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://budgero.app/' },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Monarch Money Alternative',
            item: 'https://budgero.app/monarch-money-alternative',
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
            {/* Hero Section */}
            <section className="pt-24 pb-16 md:pt-32 md:pb-24 text-center">
              <div className="max-w-4xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-[#111c34]/30 text-[#111c34] bg-[#111c34]/10"
                >
                  <Shield className="w-3.5 h-3.5 mr-2" />
                  Zero-Knowledge Privacy — No Plaid
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  Monarch Money Alternative
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    Private, No Plaid &amp; {percentCheaper}% Cheaper
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Budgero is the privacy-first Monarch alternative: zero-knowledge encryption, no
                  Plaid, and no bank credentials ever shared. Zero-based budgeting, multi-currency,
                  and offline mode for {pricing.yearly}/year — or self-host free. No automatic bank
                  sync, by design.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-alternative&utm_content=hero">
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

            {/* Key Advantages Section */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Why Switch from Monarch Money?
                </h2>
                <p className="text-lg text-foreground/70">
                  Monarch is polished — but it can read your data, leans on Plaid, and costs more.
                  Here&apos;s where Budgero is different.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dfe4ec] flex items-center justify-center mb-4">
                    <Globe className="w-6 h-6 text-[#314258]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    True Multi-Currency
                  </h3>
                  <p className="text-foreground/70">
                    Monarch shows everything as $ with no conversion. Budgero handles USD, EUR, GBP,
                    and 168 currencies with live exchange rates and automatic conversion.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dde9df] flex items-center justify-center mb-4">
                    <DollarSign className="w-6 h-6 text-[#2f6246]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    {percentCheaper}% Cheaper
                  </h3>
                  <p className="text-foreground/70">
                    Monarch costs $99.99/year. Budgero Cloud is {pricing.yearly}/year — save
                    ~${yearlySavings}/year with every feature included. You can also{' '}
                    <a
                      href="/self-hostable"
                      className="underline hover:text-foreground"
                    >
                      self-host
                    </a>{' '}
                    for free with full features including sync and multi-currency.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#e4dff0] flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-[#564176]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Zero-Knowledge Privacy
                  </h3>
                  <p className="text-foreground/70">
                    Monarch has &quot;bank-level&quot; encryption but can still access your data.
                    Budgero uses zero-knowledge encryption — we literally cannot see your finances.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#efe4d8] flex items-center justify-center mb-4">
                    <Cpu className="w-6 h-6 text-[#8a5730]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Local LLM Integration
                  </h3>
                  <p className="text-foreground/70">
                    Monarch&apos;s AI uses third-party providers, sending transaction data
                    externally for processing. Budgero integrates with locally-hosted models
                    (Ollama, LM Studio) — your data stays on your device.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs Monarch Money
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
                        Monarch Money
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
                          {typeof row.monarch === 'boolean' ? (
                            <div className="flex flex-col items-center gap-1">
                              {row.monarch ? (
                                <Check className="w-5 h-5 text-green-600" />
                              ) : (
                                <X className="w-5 h-5 text-foreground/35" />
                              )}
                              {row.monarchNote && (
                                <span className="text-xs text-foreground/55">{row.monarchNote}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm text-foreground/65">
                                {row.monarch}
                              </span>
                              {row.monarchNote && (
                                <span className="text-xs text-foreground/55">{row.monarchNote}</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm text-foreground/60">
                * Push API requires writing your own automation scripts using our encrypted Python
                SDK. Not a plug-and-play bank sync.{' '}
                <Link
                  href="/docs/push-api"
                  className="underline hover:text-foreground"
                >
                  Learn more
                </Link>
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="h-12 px-7 text-base bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-alternative&utm_content=mid-table">
                    Try Budgero Free for 35 Days
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <span className="text-sm text-foreground/60">
                  No card required · Multi-currency · Works worldwide
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Who This Is For */}
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
                      <span>You live outside the US/Canada or travel frequently</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You manage money in multiple currencies</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You want true privacy with zero-knowledge encryption</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You want to use your own locally-hosted LLM (Ollama, LM Studio)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        You want to save ~${yearlySavings}/year (or go free with{' '}
                        <a href="/self-hostable" className="underline">
                          Self-Host
                        </a>
                        )
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You need offline access when traveling</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Stick with Monarch if:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You need automatic US/Canadian bank sync</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You want automatic investment/brokerage syncing</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You only use USD and live in North America</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You prefer fully hands-off automation over privacy</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Monarch Limitations Section */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                  What Monarch Money Gets Wrong
                </h2>
                <p className="text-lg text-foreground/75 mb-6">
                  Monarch Money is a solid app for US-based users, but it has significant
                  limitations:
                </p>
                <ul className="space-y-4 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <X className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">No multi-currency:</strong>{' '}
                      Monarch displays all transactions as &quot;$&quot; regardless of actual
                      currency. A 1,000 JPY transaction shows as &quot;$1,000&quot; — misleading and
                      unusable for international users.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <X className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">US/Canada only:</strong> You
                      cannot download the app outside North American app stores or connect
                      non-US/Canadian banks.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <X className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Cloud-only:</strong> No
                      offline mode. You need internet to access your budget.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <X className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">
                        AI processes data externally:
                      </strong>{' '}
                      Monarch&apos;s AI assistant uses third-party LLM providers, sending
                      transaction data to external servers for processing (though not stored or used
                      for training).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <X className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Expensive:</strong> At
                      $99.99/year, Monarch costs ~${yearlySavings}/year more than Budgero Cloud&apos;s {pricing.yearly}.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-10">
                Frequently Asked Questions
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
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Ready to switch from Monarch Money?
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Try Budgero free for 35 days. Multi-currency, zero-knowledge encryption, and works
                  anywhere in the world.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-alternative&utm_content=final">
                      Start Free Trial
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Want all features for free?{' '}
                  <Link
                    href="/self-hosted-ynab-alternative"
                    className="underline hover:text-foreground"
                  >
                    Self-host Budgero
                  </Link>{' '}
                  with full sync, multi-currency, and collaboration.
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Based in Europe?{' '}
                  <Link
                    href="/monarch-money-europe-alternative"
                    className="underline hover:text-foreground"
                  >
                    Monarch Money isn&apos;t available here
                  </Link>{' '}
                  — see the dedicated comparison.
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Wondering about currencies?{' '}
                  <Link
                    href="/monarch-money-multi-currency"
                    className="underline hover:text-foreground"
                  >
                    Does Monarch Money support multiple currencies?
                  </Link>
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Still comparing apps? See{' '}
                  <Link
                    href="/best-ynab-alternatives"
                    className="underline hover:text-foreground"
                  >
                    9 budgeting apps compared
                  </Link>
                  .
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
