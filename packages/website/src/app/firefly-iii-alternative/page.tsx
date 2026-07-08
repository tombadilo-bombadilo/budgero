import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Firefly III Alternative — Self-Hosted Budgeting | Budgero',
  description:
    'Looking for a Firefly III alternative? Budgero Self-Host is free, runs in Docker, and adds zero-based envelope budgeting, 168 currencies with live FX, end-to-end encryption, and a polished PWA.',
  keywords: [
    'firefly iii alternative',
    'firefly iii alternatives',
    'firefly alternative',
    'self hosted budgeting app',
    'self hosted personal finance',
    'firefly iii vs',
    'firefly iii replacement',
    'docker budgeting app',
    'envelope budgeting self hosted',
  ],
  alternates: { canonical: 'https://budgero.app/firefly-iii-alternative' },
  openGraph: {
    title: 'Firefly III Alternative — Self-Hosted Budgeting | Budgero',
    description:
      'Budgero Self-Host is free, runs in Docker, and adds zero-based envelope budgeting, 168 currencies, end-to-end encryption, and a polished PWA.',
    url: 'https://budgero.app/firefly-iii-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Firefly III Alternative — Self-Hosted Budgeting | Budgero',
    description:
      'Free, Docker-based, zero-based envelope budgeting with 168 currencies and end-to-end encryption.',
  },
};

const comparisonData = [
  {
    feature: 'Price (self-hosted)',
    budgero: 'Free',
    firefly: 'Free',
    budgeroNote: 'Full feature parity, no gating',
    fireflyNote: 'Free and open source',
  },
  {
    feature: 'Open source',
    budgero: false,
    firefly: true,
    budgeroNote: 'Proprietary, self-hostable',
    fireflyNote: 'AGPL, community-driven',
  },
  {
    feature: 'Budgeting method',
    budgero: 'Zero-based envelopes',
    firefly: 'Double-entry ledger',
    budgeroNote: 'YNAB-style "every dollar a job"',
    fireflyNote: 'Budgets exist, but accounting-first',
  },
  {
    feature: 'Multi-currency budgeting',
    budgero: '168 currencies, live FX',
    firefly: 'Partial',
    budgeroNote: 'One budget across currencies',
    fireflyNote: 'Currencies supported; cross-currency budgeting and reporting are limited',
  },
  {
    feature: 'End-to-end encryption',
    budgero: true,
    firefly: false,
    budgeroNote: 'AES-256-GCM, zero-knowledge',
    fireflyNote: 'Server-side data, protected by your setup',
  },
  {
    feature: 'Mobile experience',
    budgero: 'PWA, offline-first',
    firefly: 'Community apps',
    budgeroNote: 'Installable, works offline',
    fireflyNote: 'No official mobile app',
  },
  {
    feature: 'Setup',
    budgero: 'Docker Compose',
    firefly: 'Docker Compose',
    budgeroNote: 'Single compose file, ~10 minutes',
    fireflyNote: 'App + separate data importer',
  },
  {
    feature: 'Managed cloud option',
    budgero: true,
    firefly: false,
    budgeroNote: `${pricing.monthly}/mo if you stop wanting to run servers`,
    fireflyNote: 'Self-host only',
  },
  {
    feature: 'YNAB import',
    budgero: true,
    firefly: 'Via importer',
    budgeroNote: 'Direct import, 5 minutes',
    fireflyNote: 'CSV through the data importer',
  },
  {
    feature: 'API access',
    budgero: true,
    firefly: true,
    budgeroNote: 'Push API',
    fireflyNote: 'Full REST API',
  },
];

const faqs = [
  {
    q: 'Why would I switch from Firefly III?',
    a: "The two most common reasons: budgeting method and day-to-day ergonomics. Firefly III is a double-entry personal finance ledger — superb for recording and reporting on what happened, less natural for forward-looking envelope budgeting. And while Firefly's web UI is powerful, there's no official mobile app and the learning curve is real. If you want YNAB-style zero-based budgeting on your own server with a polished, offline-capable PWA, that's exactly the gap Budgero Self-Host fills.",
  },
  {
    q: 'Is Budgero open source like Firefly III?',
    a: 'No. Budgero is proprietary software that you can self-host for free with the full feature set. If open-source licensing is a hard requirement, Firefly III and Actual Budget are the right choices — and we genuinely recommend them for that case. If what you actually want is "my data on my server, no subscription", Budgero Self-Host delivers that without the license.',
  },
  {
    q: 'How does multi-currency compare between Budgero and Firefly III?',
    a: 'Firefly III supports multiple currencies at the transaction and account level, but budgeting and reporting across currencies is limited — it remains primarily a one-main-currency system. Budgero treats multi-currency as the core feature: 168 currencies in one budget, live exchange rates, and a unified home-currency rollup across all accounts and envelopes.',
  },
  {
    q: 'Can I migrate my Firefly III data to Budgero?',
    a: 'Yes, via CSV. Export your transactions from Firefly III (it has solid export options), then import the CSV into Budgero — accounts, dates, payees, amounts, and categories map in a preview before anything is written. Plan an evening for it if you have years of history and want to tidy categories afterwards.',
  },
  {
    q: 'What does Budgero Self-Host require?',
    a: 'Docker and roughly 10 minutes: pull the image, copy the example docker-compose.yml, set a few environment variables, and docker compose up. It runs comfortably on a Raspberry Pi, a NAS, or the smallest VPS tier. There is no license key, no telemetry unless you opt in, and no feature gating versus the Cloud edition.',
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
        className={`text-sm ${
          isHighlight ? 'font-medium text-[#2f6246]' : 'text-foreground/65'
        }`}
      >
        {String(val)}
      </span>
      {note && <span className="text-xs text-foreground/55">{note}</span>}
    </div>
  );
}

export default function FireflyAlternativePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Budgero',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
        url: 'https://budgero.app/firefly-iii-alternative',
        description:
          'Firefly III alternative — free, self-hosted, zero-based envelope budgeting with 168 currencies, end-to-end encryption, and an offline-first PWA.',
        offers: [
          {
            '@type': 'Offer',
            name: 'Budgero Self-Host',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Budgero Cloud',
            price: pricing.monthly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
        ],
        featureList: [
          'Zero-based envelope budgeting',
          'Free self-host edition (Docker)',
          'Multi-currency (168 currencies) with live FX',
          'Zero-knowledge encryption (AES-256-GCM)',
          'Offline-first PWA',
          'YNAB and CSV import',
          'Managed Cloud option',
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
            name: 'Firefly III Alternative',
            item: 'https://budgero.app/firefly-iii-alternative',
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
                  <Server className="w-3.5 h-3.5 mr-2" />
                  Self-hosted, free, Docker-based
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  The Firefly III Alternative
                  <span className="block text-2xl md:text-3xl mt-3 text-foreground/70 font-medium">
                    Same self-hosted freedom — with envelope budgeting your household will
                    actually use.
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Firefly III is a great ledger. Budgero Self-Host is a budgeting app: zero-based
                  envelopes, 168 currencies with live FX, end-to-end encryption, and an
                  offline-first PWA — free on your own server.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <Link href="/docs/self-hosting-guide">
                      Self-Host for Free
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <a href="#comparison">Compare with Firefly III</a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  Or try Budgero Cloud free for 35 days — no card, no server needed.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Honest framing */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Firefly III Is a Ledger. Budgero Is a Budget.
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Let&apos;s be fair to Firefly III first: it is free, open source, actively
                  maintained, and one of the most complete double-entry personal finance systems
                  you can run yourself. If you think in accounts, journals, and reports, it is
                  excellent — and if open-source licensing is non-negotiable for you, Firefly III
                  or Actual Budget is the right call, not Budgero.
                </p>
                <p>
                  The reason people go looking for an alternative is usually not a missing feature
                  — it&apos;s a mismatch of method. Firefly III records what happened. Zero-based
                  envelope budgeting decides what happens <em>next</em>: every unit of money gets
                  a job before you spend it. Firefly has budget features, but they sit on top of
                  an accounting core; in Budgero, the envelope method <em>is</em> the core, the
                  same philosophy that made YNAB work — with{' '}
                  <Link
                    href="/multi-currency-budgeting"
                    className="underline hover:text-foreground"
                  >
                    168 currencies
                  </Link>{' '}
                  handled natively.
                </p>
                <p>
                  The second reason is the household test: Firefly III makes sense to the person
                  who set it up. A spouse logging groceries on a phone at the supermarket needs
                  something else — Budgero&apos;s PWA installs like a native app, works offline,
                  and syncs when you&apos;re back online.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section id="comparison" className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero Self-Host vs. Firefly III
                </h2>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                        Feature
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Budgero Self-Host
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Firefly III
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
                          {renderCellValue(row.firefly, row.fireflyNote, false)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-6 text-foreground/60 text-sm max-w-3xl">
                <strong className="text-foreground">Key takeaway:</strong> pick Firefly III for an
                open-source double-entry ledger with deep reporting. Pick Budgero for zero-based
                envelope budgeting your whole household can use, real multi-currency, and
                end-to-end encryption — still free, still on your server.
              </p>
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
                  Your server. Your data. A budget that looks forward.
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Spin up Budgero Self-Host with Docker in about 10 minutes — free forever, full
                  feature set, no telemetry unless you opt in.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <Link href="/docs/self-hosting-guide">
                      Read the Self-Hosting Guide
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=firefly-iii-alternative&utm_content=final">
                      Try Cloud Free Instead
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Also see:{' '}
                  <Link
                    href="/self-hosted-ynab-alternative"
                    className="underline hover:text-foreground"
                  >
                    Self-hosted YNAB alternative
                  </Link>{' '}
                  ·{' '}
                  <Link href="/best-ynab-alternatives" className="underline hover:text-foreground">
                    Best YNAB alternatives in 2026
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
