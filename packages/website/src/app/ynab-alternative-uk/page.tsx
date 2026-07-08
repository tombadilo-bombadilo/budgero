import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Download, PoundSterling } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'YNAB Alternative for the UK — GBP Budgeting | Budgero',
  description: `The YNAB alternative built for the UK. Budget in GBP (and 167 other currencies), works with every UK bank via CSV, end-to-end encrypted, data hosted in the EU. From ${pricing.monthly}/mo. 35-day free trial.`,
  keywords: [
    'ynab alternative uk',
    'ynab uk alternative',
    'ynab uk',
    'ynab alternative united kingdom',
    'uk budgeting app',
    'budgeting app uk',
    'ynab gbp',
    'ynab monzo',
    'ynab starling',
    'zero based budgeting uk',
    'envelope budgeting app uk',
    'best budgeting app uk',
  ],
  alternates: { canonical: 'https://budgero.app/ynab-alternative-uk' },
  openGraph: {
    title: 'YNAB Alternative for the UK — GBP Budgeting | Budgero',
    description:
      'The YNAB alternative built for the UK. GBP budgeting, works with every UK bank via CSV, end-to-end encrypted, data hosted in the EU.',
    url: 'https://budgero.app/ynab-alternative-uk',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'YNAB Alternative for the UK — GBP Budgeting | Budgero',
    description:
      'GBP budgeting that works with every UK bank. End-to-end encrypted, data hosted in the EU, half the price of YNAB.',
  },
};

const comparisonData = [
  {
    feature: 'Built for the UK',
    budgero: true,
    ynab: 'Partial',
    budgeroNote: 'GBP-first, works with every UK bank',
    ynabNote: 'Returned 2024–25 via Plaid, select banks only',
  },
  {
    feature: 'Works with your bank',
    budgero: 'All UK banks',
    ynab: 'Select banks',
    budgeroNote: 'CSV import from Monzo, Starling, anyone',
    ynabNote: 'Monzo, Revolut, NatWest, HSBC in; many out',
  },
  {
    feature: 'GBP + EUR in one budget',
    budgero: true,
    ynab: false,
    budgeroNote: '168 currencies with live FX',
    ynabNote: 'One currency per budget',
  },
  {
    feature: 'Billing currency',
    budgero: 'GBP',
    ynab: 'USD only',
    budgeroNote: 'No FX fees on your card',
    ynabNote: '$109/yr + card FX fees',
  },
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    ynab: '$109/year (~£85)',
    budgeroNote: 'Or free with Self-Host',
    ynabNote: null,
  },
  {
    feature: 'End-to-end encryption',
    budgero: true,
    ynab: false,
    budgeroNote: 'AES-256-GCM, zero-knowledge',
    ynabNote: 'Plaintext on their servers',
  },
  {
    feature: 'Where your data lives',
    budgero: 'Finland (EU)',
    ynab: 'United States',
    budgeroNote: 'Zero-knowledge encrypted, EU jurisdiction',
    ynabNote: 'Subject to US data law',
  },
  {
    feature: 'Telemetry & tracking',
    budgero: 'Opt-in only',
    ynab: true,
    budgeroNote: 'No telemetry unless you explicitly allow it',
    ynabNote: 'Third-party analytics by default',
  },
  {
    feature: 'Offline mode',
    budgero: true,
    ynab: false,
    budgeroNote: 'PWA works fully offline',
    ynabNote: 'Requires internet',
  },
  {
    feature: 'Zero-based budgeting',
    budgero: true,
    ynab: true,
    budgeroNote: null,
    ynabNote: null,
  },
  {
    feature: 'YNAB data import',
    budgero: true,
    ynab: 'N/A',
    budgeroNote: 'Full categories, transactions, history',
    ynabNote: null,
  },
  {
    feature: 'Self-host option',
    budgero: true,
    ynab: false,
    budgeroNote: 'Docker, your own server',
    ynabNote: null,
  },
];

const faqs = [
  {
    q: 'Does YNAB still work in the UK?',
    a: "Sort of. YNAB officially withdrew from the UK in 2022, then returned in 2024–25 via Plaid's Open Banking integration. Coverage is selective — Monzo, Revolut, Nationwide, NatWest, HSBC and American Express are supported, but many UK banks still aren't. Billing remains in USD, there's no multi-currency support, and your transaction data routes through Plaid as a third party.",
  },
  {
    q: 'Does Budgero work with UK banks like Monzo and Starling?',
    a: 'Yes — with every UK bank, because Budgero is deliberately manual-first. You import a CSV export (every UK bank offers one, and Monzo/Starling exports are excellent) or enter transactions yourself. No Open Banking connection means no aggregator middleman, no broken sync, and no bank credentials shared with anyone.',
  },
  {
    q: 'Can I budget in GBP and EUR at the same time?',
    a: 'Yes. Budgero supports 168 currencies in one budget with live exchange rates. Hold GBP and EUR accounts side by side and see everything rolled up in pounds. If you work with EU clients, split time across the Channel, or just holiday in euros, it all lands in one unified picture.',
  },
  {
    q: 'How much does Budgero cost in pounds?',
    a: `Budgero Cloud is ${pricing.monthly}/month or ${pricing.yearly}/year — roughly half of YNAB's $109/year (~£85 once FX fees hit your card). Billing is handled by Stripe and charges cleanly in GBP, so there are no foreign-transaction surprises. Budgero Self-Host is free forever on your own server.`,
  },
  {
    q: 'Can I import my YNAB budget?',
    a: 'Yes. Budgero imports YNAB export files directly — categories, transactions, budget groups, and accounts come across intact in about 5 minutes. Export from YNAB before your subscription lapses, because YNAB cuts off export access when you stop paying.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In Finland, in the EU, under EU jurisdiction — not on US servers. And before it gets there, your data is encrypted on your device with a key we never see, so we cannot read it regardless. No telemetry or usage analytics run unless you explicitly opt in. If you want full control, self-host on your own UK server.',
  },
  {
    q: 'Is there a free version?',
    a: 'Yes — Budgero Self-Host is completely free with the full feature set; you run it with Docker on your own server, NAS, or Raspberry Pi. Budgero Cloud has a 35-day free trial, no card required.',
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

export default function YnabAlternativeUkPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Budgero',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
        url: 'https://budgero.app/ynab-alternative-uk',
        description:
          'YNAB alternative for the UK — zero-based budgeting in GBP and 168 currencies, works with every UK bank via CSV, end-to-end encrypted, data hosted in the EU.',
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
            name: 'Budgero Cloud (monthly)',
            price: pricing.monthly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Budgero Cloud (yearly)',
            price: pricing.yearly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
        ],
        featureList: [
          'Zero-based budgeting',
          'GBP-first budgeting with 168 currencies',
          'Zero-knowledge encryption (AES-256-GCM)',
          'Works with every UK bank via CSV',
          'GBP billing',
          'Data hosted in Finland (EU)',
          'No telemetry unless explicitly enabled',
          'Offline support',
          'YNAB import',
          'Self-host option',
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
            name: 'YNAB Alternative for the UK',
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
                  <span>Built for the UK — billed in GBP</span>
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  The YNAB Alternative for the UK
                  <span className="block text-2xl md:text-3xl mt-3 text-foreground/70 font-medium">
                    GBP budgeting that works with every UK bank — not just the ones Plaid covers.
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  YNAB left the UK in 2022 and came back half-way: select banks, USD billing, no
                  multi-currency. Budgero is zero-based budgeting built to work properly here —
                  GBP-first, end-to-end encrypted, at roughly half the price.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-uk&utm_content=hero">
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
                    <a href="#comparison">See the UK Comparison</a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  35 days free, no card needed. Works with Monzo, Starling, and every other UK bank.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why UK YNAB users are leaving */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why UK YNAB Users Are Switching
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  YNAB&apos;s relationship with the UK has been complicated. It pulled out in 2022,
                  citing the cost of UK-specific features. It returned in 2024–25 through
                  Plaid&apos;s Open Banking integration — but for many UK households, the product
                  still doesn&apos;t fit.
                </p>

                <div className="space-y-4">
                  <p>
                    <strong className="text-foreground">Bank coverage is selective.</strong> Monzo,
                    Revolut, Nationwide, NatWest, HSBC and Amex sync; plenty of other UK banks and
                    building societies don&apos;t. If your bank isn&apos;t on Plaid&apos;s list,
                    you&apos;re doing CSV imports anyway — in an app priced as if sync works.
                  </p>
                  <p>
                    <strong className="text-foreground">You pay in dollars.</strong> $109/year
                    lands as roughly £85 on your card, plus whatever foreign-transaction fee your
                    bank adds. There is no GBP billing and no VAT invoice.
                  </p>
                  <p>
                    <strong className="text-foreground">No multi-currency.</strong> If you hold
                    EUR for work, travel, or family across the Channel, YNAB gives you one currency
                    per budget and manual exchange-rate maths.
                  </p>
                  <p>
                    <strong className="text-foreground">Your data crosses the Atlantic.</strong>{' '}
                    YNAB stores budgets in plaintext on US servers under US data law, and bank
                    connections route through Plaid. Budgero&apos;s data lives encrypted in
                    Finland, under EU jurisdiction, and the app sends no telemetry unless you
                    explicitly allow it.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section id="comparison" className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs. YNAB — The UK View
                </h2>
                <p className="text-lg text-foreground/70">
                  Where it actually matters for UK households and freelancers.
                </p>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                        Feature
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Budgero
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
                    Start 35-Day Free Trial
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <span className="text-sm text-foreground/60">
                  No card · GBP billing · Works with every UK bank
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* UK banking reality */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Works With Monzo, Starling, and the Bank Plaid Forgot
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Budgero skips the bank-aggregator middleman entirely. Instead of hoping your bank
                  is on a sync provider&apos;s coverage list, you export a CSV — something every UK
                  bank offers, and which app-first banks like Monzo and Starling make excellent —
                  and import it in seconds. Or enter transactions as you spend, which is the habit
                  that made YNAB work in the first place.
                </p>
                <p>
                  The upside of doing it this way: no broken sync connections to babysit, no
                  re-authentication every 90 days, and your banking credentials are never shared
                  with anyone — not with us, not with Plaid, not with anyone else.
                </p>
                <p>
                  And if you earn or spend in euros too, Budgero budgets{' '}
                  <Link
                    href="/multi-currency-budgeting"
                    className="underline hover:text-foreground"
                  >
                    GBP and EUR side by side
                  </Link>{' '}
                  with live exchange rates — something YNAB has never offered.
                </p>
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
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
                >
                  <Download className="w-3.5 h-3.5 mr-2" />
                  35 days free, no card
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Budget in pounds. Privately. Without the workarounds.
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Start your 35-day Budgero Cloud trial and import your YNAB budget in minutes. Or
                  self-host for free on your own server. Your data stays yours either way.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-uk&utm_content=final">
                      Start Free Trial
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <Link href="/self-hosted-ynab-alternative">Prefer to self-host?</Link>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Also see:{' '}
                  <Link href="/best-ynab-alternatives" className="underline hover:text-foreground">
                    Best YNAB alternatives in 2026
                  </Link>{' '}
                  ·{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    YNAB alternative for Europe
                  </Link>{' '}
                  ·{' '}
                  <Link href="/vs-ynab" className="underline hover:text-foreground">
                    Full Budgero vs YNAB comparison
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
