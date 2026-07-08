import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Best YNAB Alternatives in 2026 — 9 Apps Compared | Budgero',
  description:
    'Looking for a YNAB alternative? We compare 9 budgeting apps on price, privacy, bank sync, and features — free and paid picks for 2026, with the best option for each situation.',
  keywords: [
    'best ynab alternatives',
    'ynab alternatives',
    'ynab alternatives 2026',
    'ynab alternative',
    'alternative to ynab',
    'apps like ynab',
    'ynab replacement',
    'ynab competitors',
    'free ynab alternative',
    'ynab alternative europe',
    'ynab multi currency alternative',
    'budgeting app comparison',
  ],
  alternates: { canonical: 'https://budgero.app/best-ynab-alternatives' },
  openGraph: {
    title: 'Best YNAB Alternatives in 2026 — 9 Apps Compared | Budgero',
    description:
      'We compare 9 YNAB alternatives on price, privacy, bank sync, and features in 2026 — with the best pick for each situation.',
    url: 'https://budgero.app/best-ynab-alternatives',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Best YNAB Alternatives in 2026 — 9 Apps Compared | Budgero',
    description:
      'We compare 9 budgeting apps on price, privacy, bank sync, and features — the best pick for each situation.',
  },
};

const summaryData = [
  {
    app: 'Budgero',
    price: `${pricing.yearly}/yr`,
    zeroBased: true,
    multiCurrency: true,
    encryption: 'Zero-knowledge',
    bankSync: false,
  },
  {
    app: 'Monarch Money',
    price: '$99.99/yr',
    zeroBased: true,
    multiCurrency: false,
    encryption: 'Standard',
    bankSync: true,
    bankSyncNote: 'US/CA',
  },
  {
    app: 'Actual Budget',
    price: 'Free (self-host)',
    zeroBased: true,
    multiCurrency: false,
    encryption: 'E2EE (optional)',
    bankSync: false,
  },
  {
    app: 'PocketSmith',
    price: 'From $9.99/mo',
    zeroBased: false,
    multiCurrency: true,
    encryption: 'Standard',
    bankSync: true,
    bankSyncNote: 'Global',
  },
  {
    app: 'Simplifi by Quicken',
    price: '$35.88/yr',
    zeroBased: false,
    multiCurrency: false,
    encryption: 'Standard',
    bankSync: true,
    bankSyncNote: 'US',
  },
  {
    app: 'Goodbudget',
    price: 'Free / $70/yr',
    zeroBased: true,
    multiCurrency: false,
    encryption: 'Standard',
    bankSync: false,
  },
  {
    app: 'EveryDollar',
    price: 'Free / $79.99/yr',
    zeroBased: true,
    multiCurrency: false,
    encryption: 'Standard',
    bankSync: true,
    bankSyncNote: 'US only',
  },
  {
    app: 'Lunch Money',
    price: '$100/yr',
    zeroBased: false,
    multiCurrency: true,
    encryption: 'Standard',
    bankSync: true,
  },
  {
    app: 'PocketGuard',
    price: 'Free / $74.99/yr',
    zeroBased: false,
    multiCurrency: false,
    encryption: 'Standard',
    bankSync: true,
    bankSyncNote: 'US/CA',
  },
];

const alternatives = [
  {
    name: 'Budgero',
    price: `${pricing.yearly}/yr or ${pricing.monthly}/mo (free self-host option)`,
    bestFor: 'Privacy-conscious users, expats, multi-currency households',
    pros: [
      'Zero-knowledge encryption (AES-256-GCM, client-side)',
      '168 currencies with live FX rates in one budget',
      '5 seats included per subscription',
      'Self-host option with full feature parity',
      'YNAB, CSV, and PDF import',
      'Works fully offline (PWA)',
    ],
    cons: [
      'No automatic bank sync',
      'Smaller community compared to YNAB',
      'PWA instead of native mobile app',
    ],
    take: "Full disclosure: Budgero is our product, so judge this entry accordingly. It exists because YNAB's method works but its US-centricity doesn't — Budgero keeps zero-based budgeting and adds the things international users keep asking for: real multi-currency, end-to-end encryption, offline mode, and a free self-host edition. If automatic bank sync is non-negotiable, pick Monarch or PocketSmith instead.",
  },
  {
    name: 'Monarch Money',
    price: '$99.99/yr or $14.99/mo',
    bestFor: 'US-based users who want a modern all-in-one',
    pros: [
      'Clean, modern interface',
      'Investment and net worth tracking',
      'Automatic bank sync via Plaid',
      'Collaborative household budgeting',
    ],
    cons: [
      'US and Canada only',
      'No multi-currency support',
      'No zero-knowledge encryption',
      'More expensive than most alternatives',
    ],
    take: "The best YNAB alternative if you're in the US, want bank sync, and prefer a full financial picture (investments, net worth) over strict envelope discipline. It is not usable outside North America — if that's you, see our Monarch Money alternative for Europe guide.",
  },
  {
    name: 'Actual Budget',
    price: 'Free (self-hosted)',
    bestFor: 'Technical users who want open-source and local-first',
    pros: [
      'Open source and actively maintained',
      'Local-first architecture',
      'Completely free, no paid tiers',
      'Growing community',
    ],
    cons: [
      'Requires technical setup for self-hosting',
      'No multi-currency support',
      'Smaller feature set than YNAB or Budgero',
      'No dedicated mobile app',
    ],
    take: "The strongest free option if you're comfortable running Docker. Actual nails the YNAB envelope method and costs nothing — the trade-offs are single-currency budgets, a thinner feature set, and you being your own sysadmin. We compare it to Budgero in detail in our Actual Budget vs Budgero post.",
  },
  {
    name: 'PocketSmith',
    price: 'From $9.99/mo (Foundation) to $26.66/mo (Fortune)',
    bestFor: 'Forecasting and calendar-based planning, global bank feeds',
    pros: [
      'Cashflow forecasting up to 10+ years out',
      'Multi-currency accounts with daily FX updates',
      'Bank feeds in many countries (not just US/CA)',
      'Powerful calendar view of upcoming money',
    ],
    cons: [
      'Not zero-based budgeting — forecast-first approach',
      'Gets expensive on higher tiers',
      'Steeper learning curve',
      'Multi-country bank feeds require mid/top tiers',
    ],
    take: "The most capable alternative for people who think in calendars and projections rather than envelopes. If you loved YNAB's discipline, PocketSmith will feel different — it answers 'where is my money heading?' more than 'what is every dollar's job?'. One of the few apps with genuinely international bank feeds.",
  },
  {
    name: 'Simplifi by Quicken',
    price: '$2.99/mo billed annually ($35.88/yr)',
    bestFor: 'US users who want cheap, automated budgeting',
    pros: [
      'Roughly a third of YNAB\'s price',
      'Automatic bank sync',
      'Spending Plan shows what\'s safe to spend',
      'Polished mobile apps',
    ],
    cons: [
      'US only',
      'Not zero-based — automation-first philosophy',
      'No multi-currency',
      'Quicken account required; data lives on their servers',
    ],
    take: "The budget pick for US users who found YNAB's manual method exhausting. Simplifi's Spending Plan does the math for you — income minus bills minus savings equals safe-to-spend. If the hands-on ritual is what made YNAB work for you, Simplifi's automation may undo the habit.",
  },
  {
    name: 'Goodbudget',
    price: 'Free (limited) or $70/yr',
    bestFor: 'Couples who want simple envelope budgeting',
    pros: [
      'Simple envelope system that works',
      'Shared budgets for couples',
      'Available on web, iOS, and Android',
      'Free tier for basic use',
    ],
    cons: [
      'No bank sync',
      'Limited reporting and analytics',
      'Dated interface',
      'No multi-currency',
    ],
    take: "Keeps it simple. The free tier (limited envelopes, 2 devices) is one of the easiest ways to try envelope budgeting without paying anything. Good if you want the method without complexity; you'll outgrow it if you want reports, multi-currency, or encryption.",
  },
  {
    name: 'EveryDollar',
    price: 'Free (manual) or $79.99/yr with bank sync',
    bestFor: 'Dave Ramsey followers',
    pros: [
      'Simple zero-based interface',
      'Genuinely usable free tier (manual entry)',
      'Bank sync in premium tier',
      'Debt payoff tools (Baby Steps)',
    ],
    cons: [
      'US only',
      'Tied to the Ramsey ecosystem',
      'Limited customization',
      'No multi-currency',
    ],
    take: "Designed around the Ramsey method, and the free manual tier is a legitimate zero-cost YNAB substitute for US users who don't need sync. If you follow the Baby Steps it's a natural fit; if you don't, the ecosystem framing gets in the way.",
  },
  {
    name: 'Lunch Money',
    price: '$100/yr or $10/mo',
    bestFor: 'Tech-savvy users who want API access and multi-currency',
    pros: [
      'Multi-currency support',
      'Developer-friendly API',
      'Clean, minimal interface',
      'Bank sync via Plaid',
    ],
    cons: [
      'Not zero-based budgeting (tracking-focused)',
      'More expensive than most options',
      'No self-host option',
      'Smaller team and community',
    ],
    take: 'Closest to Budgero on multi-currency but takes a tracking approach rather than zero-based budgeting. Built by a solo developer with an excellent API — a favorite among programmers who want to script their finances.',
  },
  {
    name: 'PocketGuard',
    price: 'Free / $74.99/yr (or $149.99 lifetime)',
    bestFor: 'Guardrails and overspending alerts, irregular incomes',
    pros: [
      '"In My Pocket" shows safe-to-spend at a glance',
      'Bank sync with unlimited accounts on Plus',
      'Lifetime purchase option — pay once',
      'Debt payoff planning tools',
    ],
    cons: [
      'Not zero-based budgeting',
      'US/Canada focused',
      'No multi-currency',
      'Free tier is quite limited',
    ],
    take: "The pick for people who don't want to budget so much as be told when to stop spending. The 2026 'Pace' feature warns you mid-month if you're burning too fast. Philosophically the opposite of YNAB's intentionality — which is exactly why it works for some people YNAB never clicked for.",
  },
];

const pickGuide = [
  { priority: 'Privacy', pick: 'Budgero', reason: 'Zero-knowledge encryption, self-host option' },
  { priority: 'Bank sync (US)', pick: 'Monarch Money', reason: 'Best modern US bank integration' },
  { priority: 'Bank sync (global)', pick: 'PocketSmith', reason: 'Feeds in many countries, multi-currency' },
  { priority: 'Open source', pick: 'Actual Budget', reason: 'Fully open, local-first' },
  { priority: 'Multi-currency', pick: 'Budgero', reason: '168 currencies, live FX rates' },
  { priority: 'Lowest paid price', pick: 'Simplifi', reason: '$35.88/yr — a third of YNAB' },
  { priority: 'Free', pick: 'Actual, EveryDollar, or Budgero Self-Host', reason: 'All genuinely free, different trade-offs' },
  { priority: 'Simplicity', pick: 'Goodbudget', reason: 'No-frills envelope budgeting' },
  { priority: 'Forecasting', pick: 'PocketSmith', reason: 'Calendar-based projections, years ahead' },
];

const faqs = [
  {
    q: 'What is the best YNAB alternative in 2026?',
    a: "It depends on what made you leave. If you want YNAB's zero-based method with multi-currency, privacy, and a lower price, Budgero is the closest match. If you're in the US and want automatic bank sync with investment tracking, Monarch Money. If you want completely free and don't mind self-hosting, Actual Budget. If you think in forecasts rather than envelopes, PocketSmith.",
  },
  {
    q: 'Is there a free YNAB alternative?',
    a: 'Yes, several. Actual Budget is free and open source (self-hosted). EveryDollar has a genuinely usable free tier with manual entry. Goodbudget offers a limited free tier. Budgero Self-Host is free forever on your own server with the full feature set — and Budgero Cloud has a 35-day free trial with no card required.',
  },
  {
    q: 'What is the best YNAB alternative for Europe?',
    a: "Most US budgeting apps (Monarch, Simplifi, EveryDollar) simply don't work in Europe. The realistic European options are Budgero (multi-currency, EU data hosting, EUR/GBP billing), PocketSmith (international bank feeds), and Actual Budget (self-hosted). See our dedicated YNAB alternative for Europe guide for the full breakdown.",
  },
  {
    q: 'What is the best self-hosted YNAB alternative?',
    a: 'Two serious options: Actual Budget (free, open source, single-currency) and Budgero Self-Host (free, 168 currencies, encryption built in). Both run in Docker on a NAS, Raspberry Pi, or VPS. Our self-hosted YNAB alternative guide walks through setup for both.',
  },
  {
    q: 'Which YNAB alternatives support multiple currencies?',
    a: 'Only three apps in this comparison handle multi-currency properly: Budgero (168 currencies in one budget with live FX rates), PocketSmith (multi-currency accounts with daily rate updates), and Lunch Money (multi-currency tracking). YNAB itself, Monarch, Simplifi, EveryDollar, Goodbudget, and PocketGuard are all effectively single-currency.',
  },
  {
    q: 'Why are people leaving YNAB?',
    a: "Three reasons come up constantly: price ($109/yr and rising), US-centricity (bank sync barely works outside North America and there's no multi-currency support), and data privacy (budgets are stored on YNAB's servers in readable form). Which of those bothers you most should drive which alternative you pick.",
  },
];

export default function BestYnabAlternativesPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: 'Best YNAB Alternatives in 2026 — 9 Apps Compared',
        author: { '@type': 'Organization', name: 'Budgero' },
        datePublished: '2026-04-11',
        dateModified: '2026-06-11',
        description:
          'Comparing 9 YNAB alternatives on price, privacy, multi-currency, and features.',
      },
      {
        '@type': 'ItemList',
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        numberOfItems: alternatives.length,
        itemListElement: alternatives.map((app, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: app.name,
          item: {
            '@type': 'SoftwareApplication',
            name: app.name,
            applicationCategory: 'FinanceApplication',
            description: `Best for: ${app.bestFor}`,
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
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://budgero.app/' },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Best YNAB Alternatives',
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
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-border/50"
                >
                  <BookOpen className="w-3.5 h-3.5 mr-2" />
                  2026 Comparison Guide — Updated June 2026
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  Best YNAB Alternatives in 2026
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    9 budgeting apps compared honestly
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  YNAB is a great zero-based budgeting app, but at $109/yr it&apos;s not for
                  everyone. Some people need multi-currency, better privacy, bank sync that works
                  in their country, or just a lower price. Here are the 9 best alternatives,
                  compared honestly.
                </p>

                <p className="text-sm text-foreground/55 max-w-2xl mx-auto">
                  Disclosure: Budgero is our app. It&apos;s in this list because it belongs here,
                  but we tell you exactly when it&apos;s <em>not</em> the right pick — and which
                  app is.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* How we compared */}
            <section className="py-12 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                How We Compared Them
              </h2>
              <div className="space-y-4 text-lg text-foreground/75 leading-relaxed">
                <p>
                  People leave YNAB for three reasons: <strong className="text-foreground">price</strong>{' '}
                  ($109/yr and climbing), <strong className="text-foreground">geography</strong>{' '}
                  (bank sync barely works outside North America, and there&apos;s no multi-currency
                  support), and <strong className="text-foreground">privacy</strong> (your budget
                  lives on their servers in readable form). So that&apos;s what we scored every app
                  on — alongside the question that matters most: does it actually keep the
                  zero-based method that made YNAB work for you, or does it quietly replace it with
                  passive expense tracking?
                </p>
                <p>
                  Five of the nine apps below are US-only in practice. If you&apos;re in Europe or
                  budgeting across currencies, your realistic shortlist is Budgero, PocketSmith,
                  Actual Budget, and Goodbudget — we&apos;ve written a dedicated{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    YNAB alternative for Europe
                  </Link>{' '}
                  guide for that case.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Quick Summary Table */}
            <section className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Quick Comparison
                </h2>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                        App
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Price
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Zero-Based
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Multi-Currency
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Encryption
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Bank Sync
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {summaryData.map((row, index) => (
                      <tr
                        key={row.app}
                        className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/25'}
                      >
                        <td className="px-4 py-4 text-sm font-medium text-foreground">
                          {row.app}
                        </td>
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
            {alternatives.map((app, idx) => (
              <div key={app.name}>
                <section className="py-12 max-w-4xl mx-auto">
                  <div className="bg-card rounded-2xl p-8 border border-border/70">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-2xl font-bold text-foreground">
                          {idx + 1}. {app.name}
                        </h3>
                        <p className="text-foreground/60 mt-1">Best for: {app.bestFor}</p>
                      </div>
                      <span className="text-lg font-semibold text-foreground/80 md:whitespace-nowrap md:text-right">
                        {app.price}
                      </span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">
                          Pros
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
                          Cons
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
                  </div>
                </section>

                {idx < alternatives.length - 1 && (
                  <div className="my-4 border-t border-border/40 max-w-4xl mx-auto" aria-hidden />
                )}
              </div>
            ))}

            <div className="my-12 border-t border-border" aria-hidden />

            {/* How to Choose */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  How to Choose
                </h2>
                <p className="text-lg text-foreground/70">Pick based on your top priority.</p>
              </div>

              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <div className="space-y-4">
                  {pickGuide.map((item) => (
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
                Dig Deeper by Situation
              </h2>
              <ul className="space-y-3 text-lg text-foreground/75">
                <li>
                  In Europe?{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    YNAB alternative for Europe
                  </Link>
                </li>
                <li>
                  In the UK?{' '}
                  <Link href="/ynab-alternative-uk" className="underline hover:text-foreground">
                    YNAB alternative for the UK
                  </Link>
                </li>
                <li>
                  In Australia?{' '}
                  <Link
                    href="/ynab-alternative-australia"
                    className="underline hover:text-foreground"
                  >
                    YNAB alternative for Australia
                  </Link>
                </li>
                <li>
                  Coming from Firefly III?{' '}
                  <Link
                    href="/firefly-iii-alternative"
                    className="underline hover:text-foreground"
                  >
                    Firefly III alternative
                  </Link>
                </li>
                <li>
                  Want it free, on your own server?{' '}
                  <Link
                    href="/self-hosted-ynab-alternative"
                    className="underline hover:text-foreground"
                  >
                    Self-hosted YNAB alternative
                  </Link>
                </li>
                <li>
                  Deciding between YNAB and Budgero specifically?{' '}
                  <Link href="/vs-ynab" className="underline hover:text-foreground">
                    Budgero vs YNAB, feature by feature
                  </Link>
                </li>
                <li>
                  Leaving Monarch instead?{' '}
                  <Link
                    href="/monarch-money-alternative"
                    className="underline hover:text-foreground"
                  >
                    Monarch Money alternative
                  </Link>
                </li>
              </ul>
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
                  Try Budgero free for 35 days
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Zero-knowledge encryption, 168 currencies, 5 seats included. No credit card
                  required.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=best-ynab-alternatives&utm_content=final">
                      Start Free Trial
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Want all features for free?{' '}
                  <a href="/self-hostable" className="underline hover:text-foreground">
                    Self-host Budgero
                  </a>{' '}
                  on your own infrastructure.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
