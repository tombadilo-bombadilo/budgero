import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Does Monarch Money Support Multiple Currencies? (2026)',
  description:
    "No — Monarch Money is USD/CAD only, with no multi-currency budgets. Here's exactly what Monarch supports in 2026, the workarounds people use, and what to use instead if you need real multi-currency budgeting.",
  keywords: [
    'monarch money multi currency',
    'monarch money multi currency support',
    'monarch multi currency',
    'monarch money multiple currencies',
    'monarch money supported countries',
    'monarch money foreign currency',
    'monarch money euros',
    'monarch money international',
    'monarch currency',
    'multi currency budgeting app',
  ],
  alternates: { canonical: 'https://budgero.app/monarch-money-multi-currency' },
  openGraph: {
    title: 'Does Monarch Money Support Multiple Currencies? (2026)',
    description:
      "No — Monarch is USD/CAD only. What Monarch supports in 2026, the workarounds, and what to use instead for real multi-currency budgeting.",
    url: 'https://budgero.app/monarch-money-multi-currency',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Does Monarch Money Support Multiple Currencies? (2026)',
    description:
      'No — Monarch is USD/CAD only. What it supports, the workarounds, and what to use instead.',
  },
};

const comparisonData = [
  {
    feature: 'Currencies per budget',
    monarch: 'One (USD or CAD)',
    budgero: '168, mixed freely',
  },
  {
    feature: 'Live exchange rates',
    monarch: false,
    budgero: true,
  },
  {
    feature: 'Home-currency rollup',
    monarch: false,
    budgero: true,
  },
  {
    feature: 'Supported countries',
    monarch: 'US & Canada',
    budgero: 'Everywhere',
  },
  {
    feature: 'Foreign accounts (EUR, GBP, AUD…)',
    monarch: 'Manual workarounds',
    budgero: 'Native',
  },
  {
    feature: 'Price',
    monarch: '$99.99/yr',
    budgero: `${pricing.yearly}/yr (or free self-host)`,
  },
];

const faqs = [
  {
    q: 'Does Monarch Money support multiple currencies?',
    a: 'No. As of 2026, Monarch Money does not support multi-currency budgeting. Each budget operates in a single currency (USD, or CAD for Canadian users), there is no native way to hold accounts in different currencies, no automatic exchange-rate conversion, and no consolidated view across currencies.',
  },
  {
    q: 'Which countries does Monarch Money support?',
    a: 'Monarch Money officially supports the United States and Canada. Its bank connections run through Plaid and similar US-focused aggregators, billing is in USD, and the company states it is not available internationally. You can create an account from elsewhere, but bank sync and currency handling will not work for non-US/CA banks.',
  },
  {
    q: 'What workarounds do people use for foreign currencies in Monarch?',
    a: 'The common ones: tracking foreign accounts as manual accounts converted by hand at a fixed rate, keeping a separate spreadsheet for non-USD holdings, or simply excluding foreign finances from Monarch entirely. All three break down quickly — rates drift, manual entries go stale, and your net worth is permanently wrong by whatever the FX moved.',
  },
  {
    q: 'What should I use instead if I need multi-currency budgeting?',
    a: 'Use an app where multi-currency is native rather than bolted on. Budgero supports 168 currencies in one budget with live exchange rates and a home-currency rollup. PocketSmith (forecast-oriented) and Lunch Money (tracking-oriented) also handle multiple currencies. If you specifically want zero-based envelope budgeting across currencies, Budgero is the closest fit.',
  },
  {
    q: 'Is Monarch Money planning to add multi-currency support?',
    a: "Multi-currency has been a long-running feature request in Monarch's community forums, but as of 2026 Monarch has not shipped it or committed to a date. Monarch's product focus remains the US/Canada market, where the demand is for bank sync coverage and investment tracking rather than currency handling.",
  },
];

function renderCell(val: unknown, highlight?: boolean) {
  if (typeof val === 'boolean') {
    return val ? (
      <Check className="w-5 h-5 text-green-600 mx-auto" />
    ) : (
      <X className="w-5 h-5 text-foreground/35 mx-auto" />
    );
  }
  return (
    <span
      className={`text-sm ${highlight ? 'font-medium text-[#2f6246]' : 'text-foreground/65'}`}
    >
      {String(val)}
    </span>
  );
}

export default function MonarchMultiCurrencyPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: 'Does Monarch Money Support Multiple Currencies? (2026)',
        author: { '@type': 'Organization', name: 'Budgero' },
        datePublished: '2026-06-11',
        dateModified: '2026-06-11',
        description:
          'What Monarch Money supports in 2026 for currencies and countries, the workarounds, and multi-currency alternatives.',
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
            name: 'Monarch Money Multi-Currency',
            item: 'https://budgero.app/monarch-money-multi-currency',
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
            <section className="pt-24 pb-12 md:pt-32 md:pb-16 text-center">
              <div className="max-w-4xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-border/50"
                >
                  <Globe className="w-3.5 h-3.5 mr-2" />
                  Updated June 2026
                </Badge>

                <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-6 leading-[1.15]">
                  Does Monarch Money Support Multiple Currencies?
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-4 max-w-2xl mx-auto leading-relaxed">
                  <strong className="text-foreground">Short answer: no.</strong> Monarch Money is
                  built for the US and Canada, budgets in a single currency, and has no
                  multi-currency support as of 2026.
                </p>
                <p className="text-lg text-foreground/60 max-w-2xl mx-auto">
                  Here&apos;s exactly what Monarch does and doesn&apos;t support, the workarounds
                  people try, and what to use if your money lives in more than one currency.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* What Monarch supports */}
            <section className="py-12 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                What Monarch Actually Supports in 2026
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Monarch Money operates in <strong className="text-foreground">USD for US
                  users and CAD for Canadian users</strong> — one currency per budget, chosen by
                  your country. There is no native way to hold an account in euros, pounds, or yen
                  alongside your dollar accounts, no automatic exchange-rate conversion, and no
                  consolidated net worth across currencies.
                </p>
                <p>
                  This is a deliberate product choice, not an oversight. Monarch&apos;s strength is
                  deep US/Canada bank sync and investment tracking, and its roadmap follows that
                  market. Multi-currency support has been requested in Monarch&apos;s community
                  forums for years without a shipped feature or a committed date.
                </p>
                <p>
                  If you only ever touch dollars, none of this matters — Monarch is a genuinely
                  good app for that life. The problem starts when your life crosses a border:
                  a salary in EUR and a mortgage in USD, family support in another currency,
                  freelance clients abroad, or a planned move.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Workarounds */}
            <section className="py-12 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                The Workarounds (and Why They Break)
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>
                  <strong className="text-foreground">Manual accounts at a fixed rate.</strong>{' '}
                  You add your EUR account as a manual USD account, converted by hand at
                  today&apos;s rate. Within a month the rate has moved and your balances are
                  fiction. Every reconciliation means redoing the maths.
                </p>
                <p>
                  <strong className="text-foreground">The side spreadsheet.</strong> Foreign
                  accounts live in a spreadsheet; Monarch only sees domestic money. Now you have
                  two systems, neither of which shows your actual net worth.
                </p>
                <p>
                  <strong className="text-foreground">Just ignoring it.</strong> The most common
                  one. The foreign part of your financial life goes untracked — which defeats the
                  purpose of a money app.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison */}
            <section className="py-12 max-w-4xl mx-auto">
              <div className="text-center mb-10">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Monarch vs. a Multi-Currency-Native App
                </h2>
                <p className="text-lg text-foreground/70">
                  What &ldquo;native&rdquo; multi-currency actually means, side by side.
                </p>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[560px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                        Feature
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Monarch Money
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Budgero
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
                        <td className="px-4 py-4 text-center">{renderCell(row.monarch)}</td>
                        <td className="px-4 py-4 text-center">{renderCell(row.budgero, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-6 text-foreground/60 text-sm max-w-3xl">
                Being fair to Monarch: it has automatic US/CA bank sync and investment tracking,
                which Budgero deliberately doesn&apos;t (Budgero is manual-first for privacy). If
                you&apos;re US-only and want sync, Monarch is the better fit — see our full{' '}
                <Link
                  href="/monarch-money-alternative"
                  className="underline hover:text-foreground"
                >
                  Monarch Money alternative comparison
                </Link>{' '}
                for the honest breakdown.
              </p>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* What to use instead */}
            <section className="py-12 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                If You Need Real Multi-Currency Budgeting
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Budgero treats currencies as a first-class feature: hold accounts in any of{' '}
                  <Link
                    href="/multi-currency-budgeting"
                    className="underline hover:text-foreground"
                  >
                    168 currencies
                  </Link>{' '}
                  inside one budget, with live exchange rates and everything rolled up in your
                  home currency. Zero-based envelopes work across currencies transparently, and
                  the whole thing is end-to-end encrypted.
                </p>
                <p>
                  If zero-based budgeting isn&apos;t your method, PocketSmith (calendar
                  forecasting, multi-currency) and Lunch Money (expense tracking, multi-currency)
                  are the other serious options — we compare all of them in our{' '}
                  <Link
                    href="/best-ynab-alternatives"
                    className="underline hover:text-foreground"
                  >
                    9-app comparison
                  </Link>
                  .
                </p>
                <p>
                  Based in Europe? Monarch doesn&apos;t work there at all — that case has its own
                  guide:{' '}
                  <Link
                    href="/monarch-money-europe-alternative"
                    className="underline hover:text-foreground"
                  >
                    Monarch Money alternative for Europe
                  </Link>
                  .
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-12 max-w-3xl mx-auto">
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

            {/* Final CTA */}
            <section className="py-16 text-center">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Budget in every currency you actually use
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  168 currencies, live FX rates, one unified budget — end-to-end encrypted, from{' '}
                  {pricing.monthly}/mo or free if you self-host.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-money-multi-currency&utm_content=final">
                    Start 35-Day Free Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                </Button>
                <p className="mt-6 text-sm text-foreground/60">
                  No card needed. Import from Monarch via CSV in minutes.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
