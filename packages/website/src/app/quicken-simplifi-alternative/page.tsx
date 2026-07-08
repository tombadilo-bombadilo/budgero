import type { Metadata } from 'next';
import { ArrowRight, Check, X, Globe, Shield, Target, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quicken Simplifi Alternative - Private Budgeting App | Budgero',
  description:
    'Looking for a Quicken Simplifi alternative? Budgero offers zero-based budgeting with zero-knowledge encryption, 168 currencies, and no bank connection required.',
  keywords: [
    'quicken simplifi alternative',
    'simplifi alternative',
    'quicken alternative',
    'simplifi replacement',
    'budgeting app private',
    'simplifi vs budgero',
  ],
  alternates: { canonical: 'https://budgero.app/quicken-simplifi-alternative' },
  openGraph: {
    title: 'Quicken Simplifi Alternative - Private Budgeting App | Budgero',
    description:
      'Looking for a Quicken Simplifi alternative? Budgero offers zero-based budgeting with zero-knowledge encryption, 168 currencies, and no bank connection required.',
    url: 'https://budgero.app/quicken-simplifi-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Quicken Simplifi Alternative - Private Budgeting App | Budgero',
    description:
      'Looking for a Quicken Simplifi alternative? Budgero offers zero-based budgeting with zero-knowledge encryption, 168 currencies, and no bank connection required.',
  },
};

const comparisonData = [
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    simplifi: '$35.88/year',
    budgeroNote: 'Or free with Self-Host',
    simplifiNote: '$2.99/mo billed annually',
  },
  {
    feature: 'Works outside the US',
    budgero: true,
    simplifi: false,
    budgeroNote: 'Any country, 168 currencies',
    simplifiNote: 'US banks and USD only',
  },
  {
    feature: 'Budgeting method',
    budgero: 'Zero-based',
    simplifi: 'Spending plan',
    budgeroNote: 'Every dollar gets a job',
    simplifiNote: 'Tracks spending after the fact',
  },
  {
    feature: 'Zero-knowledge encryption',
    budgero: true,
    simplifi: false,
    budgeroNote: 'We cannot see your data',
    simplifiNote: 'Data stored on Quicken servers',
  },
  {
    feature: 'Bank sync required',
    budgero: false,
    simplifi: true,
    budgeroNote: 'Manual-first by design',
    simplifiNote: 'Core functionality depends on it',
  },
  {
    feature: 'Multi-currency support',
    budgero: true,
    simplifi: false,
    budgeroNote: '168 currencies with live FX rates',
    simplifiNote: 'USD only',
  },
  {
    feature: 'Works offline',
    budgero: true,
    simplifi: false,
    budgeroNote: null,
    simplifiNote: 'Cloud-only, needs internet',
  },
  {
    feature: 'Investment tracking',
    budgero: 'Manual',
    simplifi: 'Automatic',
    budgeroNote: null,
    simplifiNote: 'Syncs with brokerages',
  },
  {
    feature: 'Shared budgets',
    budgero: true,
    simplifi: false,
    budgeroNote: null,
    simplifiNote: null,
  },
  {
    feature: 'Self-host option',
    budgero: true,
    simplifi: false,
    budgeroNote: 'Free forever with full features',
    simplifiNote: null,
  },
  {
    feature: 'Works worldwide',
    budgero: true,
    simplifi: false,
    budgeroNote: null,
    simplifiNote: 'US focused',
  },
];

const faqs = [
  {
    q: 'What is the difference between Simplifi and Budgero?',
    a: "Philosophy. Simplifi is automation-first: it syncs your banks, categorizes transactions, and its Spending Plan tells you what's left to spend after bills and savings. Budgero is intention-first: zero-based budgeting where you assign every dollar a job before spending it, with no bank connection required and zero-knowledge encryption so nobody — including us — can read your data.",
  },
  {
    q: 'Is Simplifi cheaper than Budgero?',
    a: `On Cloud plans, yes: Simplifi is $35.88/year ($2.99/mo billed annually) versus Budgero Cloud at ${pricing.yearly}/year. But Budgero Self-Host is free forever with the full feature set, which makes it the cheaper option overall if you're willing to run a Docker container.`,
  },
  {
    q: 'Does Simplifi work outside the US?',
    a: 'Not really. Simplifi connects to US financial institutions and operates in USD. If you live outside the US, bank with non-US institutions, or need multiple currencies, Simplifi is not built for you — that is exactly the case Budgero covers, with 168 currencies and no dependency on bank connections.',
  },
  {
    q: 'Can I switch from Simplifi to Budgero?',
    a: 'Yes. Export your transactions from Simplifi as CSV, then import them into Budgero — the import preview maps dates, payees, amounts, and categories before anything is written. Expect to spend an evening tidying categories and setting up your first zero-based budget.',
  },
  {
    q: 'Does Budgero require sharing my bank credentials?',
    a: 'No — and it never asks. Simplifi pulls transactions through bank connections, which means credentials and transaction data flow through aggregator infrastructure. Budgero is manual-first: you enter transactions or import CSVs, and your banking credentials never leave your control.',
  },
];

export default function QuickenSimplifiAlternativePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        image: 'https://budgero.app/logo_512.png',
        name: 'Budgero',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
        url: 'https://budgero.app/quicken-simplifi-alternative',
        description:
          'Quicken Simplifi alternative with zero-based budgeting, zero-knowledge encryption, 168 currencies, and no bank connection required.',
        offers: {
          '@type': 'Offer',
          price: pricing.yearly.replace(/[^0-9.]/g, ''),
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        featureList: [
          'Zero-based budgeting',
          'Zero-knowledge encryption',
          '168 currencies with live exchange rates',
          'No bank connection required',
          'Offline support',
          'Shared budgets',
        ],
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
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://budgero.app/' },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Quicken Simplifi Alternative',
            item: 'https://budgero.app/quicken-simplifi-alternative',
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
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-amber-600/30 text-amber-700 bg-amber-50"
                >
                  <Shield className="w-3.5 h-3.5 mr-2" />
                  Privacy-First Budgeting
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  Quicken Simplifi Alternative
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    Budget without sharing your bank credentials
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Simplifi is a modern take on Quicken&apos;s legacy, but it still requires bank
                  connections and stores your data on their servers. Budgero takes a different
                  approach: zero-based budgeting with zero-knowledge encryption.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=quicken-simplifi-alternative&utm_content=hero">
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
                  Key Differences from Simplifi
                </h2>
                <p className="text-lg text-foreground/70">
                  Different philosophy, different approach to your finances.
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
                    Simplifi stores your financial data on Quicken servers where it can be accessed.
                    Budgero encrypts everything on your device before syncing. We literally cannot
                    see your data.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dde9df] flex items-center justify-center mb-4">
                    <Target className="w-6 h-6 text-[#2f6246]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Zero-Based Budgeting
                  </h3>
                  <p className="text-foreground/70">
                    Simplifi tracks your spending after the fact. Budgero assigns every dollar a job
                    before the month starts, giving you full control over where your money goes.
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
                    Simplifi is US focused and works primarily with USD. Budgero supports 168
                    currencies with live exchange rates and automatic conversion, working anywhere in
                    the world.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#efe4d8] flex items-center justify-center mb-4">
                    <WifiOff className="w-6 h-6 text-[#8a5730]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    No Bank Connection Required
                  </h3>
                  <p className="text-foreground/70">
                    Simplifi needs Plaid to connect to your bank and pull transactions automatically.
                    Budgero is manual-first by design. You stay in control of what data enters your
                    budget.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs Quicken Simplifi
                </h2>
                <p className="text-lg text-foreground/70">
                  Feature-by-feature comparison
                </p>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[560px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                        Feature
                      </th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-foreground">
                        Budgero
                      </th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-foreground">
                        Quicken Simplifi
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
                          {typeof row.simplifi === 'boolean' ? (
                            <div className="flex flex-col items-center gap-1">
                              {row.simplifi ? (
                                <Check className="w-5 h-5 text-green-600" />
                              ) : (
                                <X className="w-5 h-5 text-foreground/35" />
                              )}
                              {row.simplifiNote && (
                                <span className="text-xs text-foreground/55">{row.simplifiNote}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm text-foreground/65">
                                {row.simplifi}
                              </span>
                              {row.simplifiNote && (
                                <span className="text-xs text-foreground/55">{row.simplifiNote}</span>
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

            {/* Spending Plan vs zero-based */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Spending Plan vs. Zero-Based: Why the Method Matters
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Simplifi&apos;s flagship feature is the Spending Plan: it takes your income,
                  subtracts detected bills and savings goals, and shows you a single
                  &ldquo;safe-to-spend&rdquo; number. It is genuinely clever, and for people who
                  found YNAB-style budgeting exhausting, it removes nearly all the work.
                </p>
                <p>
                  The catch is that removing the work also removes the awareness. The Spending
                  Plan tells you what&apos;s left; it doesn&apos;t make you decide what your money
                  is <em>for</em>. Zero-based budgeting — the method Budgero shares with YNAB —
                  forces that decision up front: every dollar gets a job before the month starts,
                  and overspending in one envelope means consciously taking from another. People
                  who switch from passive tracking to zero-based budgeting consistently report the
                  method itself, not the app, is what changed their finances.
                </p>
                <p>
                  Neither approach is wrong. If you want money management on autopilot, Simplifi
                  does it cheaply and well — for US banks and US dollars. If you want the
                  discipline of envelopes with privacy and multi-currency on top, that&apos;s
                  Budgero&apos;s lane. We compare both against seven other apps in our{' '}
                  <a href="/best-ynab-alternatives" className="underline hover:text-foreground">
                    9-app comparison
                  </a>
                  .
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Where Simplifi Wins */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                  Where Simplifi Wins
                </h2>
                <p className="text-lg text-foreground/75 mb-6">
                  Simplifi is a solid product. Here is where it genuinely does better than Budgero:
                </p>
                <ul className="space-y-4 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Investment tracking and net worth:</strong>{' '}
                      Simplifi automatically syncs with brokerages and tracks your investments and
                      net worth in real time. Budgero only supports manual investment tracking.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Bill tracking and reminders:</strong>{' '}
                      Simplifi detects recurring bills from your connected accounts and reminds you
                      before they are due.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Lower price point:</strong>{' '}
                      At $35.88/year ($2.99/mo billed annually), Simplifi costs less than
                      Budgero Cloud at {pricing.yearly}/year. Though you can{' '}
                      <a href="/self-hostable" className="underline hover:text-foreground">
                        self-host Budgero for free
                      </a>.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Automatic transaction categorization:</strong>{' '}
                      With bank sync enabled, Simplifi automatically imports and categorizes
                      transactions. Budgero is manual-first, which means more control but more effort.
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
                      <span>You prefer zero-based budgeting over spending tracking</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You do not want to share bank credentials with a third party</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You manage money in multiple currencies or live outside the US</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You need offline access or want to share budgets with a partner</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        You want to{' '}
                        <a href="/self-hostable" className="underline">
                          self-host
                        </a>{' '}
                        your budgeting app for free
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Stick with Simplifi if:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You rely on automatic bank sync for transaction import</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You need automatic investment and net worth tracking</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You want bill detection and payment reminders</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>Price is your top priority and $35.88/year matters over privacy</span>
                    </li>
                  </ul>
                </div>
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
                  Ready to switch from Quicken Simplifi?
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Try Budgero free for 35 days. Zero-based budgeting, zero-knowledge encryption, and
                  168 currencies with no bank connection required.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=quicken-simplifi-alternative&utm_content=final">
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
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
