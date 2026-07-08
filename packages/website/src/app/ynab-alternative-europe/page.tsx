import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Download, Globe, Shield, Euro } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'YNAB Alternative for Europe — Hosted in Finland | Budgero',
  description: `The YNAB alternative built for Europe. EUR, GBP, CHF, PLN and 168 currencies in one budget, end-to-end encrypted, data hosted in Finland, and no telemetry unless you allow it. From ${pricing.monthly}/mo. 35-day free trial.`,
  keywords: [
    'ynab alternative europe',
    'ynab alternative eu',
    'ynab europe',
    'ynab uk alternative',
    'ynab germany',
    'ynab netherlands',
    'ynab spain',
    'ynab multi currency europe',
    'european budgeting app',
    'eu budgeting app',
    'gdpr budgeting app',
    'budgeting app europe',
    'ynab alternative gdpr',
    'best budgeting app europe',
  ],
  alternates: { canonical: 'https://budgero.app/ynab-alternative-europe' },
  openGraph: {
    title: 'YNAB Alternative for Europe — Hosted in Finland | Budgero',
    description:
      'The YNAB alternative built for Europe. EUR, GBP, CHF, PLN and 168 currencies in one budget, end-to-end encrypted, data hosted in Finland, no telemetry unless you allow it.',
    url: 'https://budgero.app/ynab-alternative-europe',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'YNAB Alternative for Europe — Hosted in Finland | Budgero',
    description:
      'EUR, GBP, CHF and 168 currencies in one budget. End-to-end encrypted, hosted in Finland, no telemetry by default.',
  },
};

const comparisonData = [
  {
    feature: 'Works across Europe',
    budgero: true,
    ynab: 'Partial',
    budgeroNote: 'Every country, every currency',
    ynabNote: 'UK/EU bank sync via Plaid only (select banks)',
  },
  {
    feature: 'Multi-currency in one budget',
    budgero: '168 currencies',
    ynab: false,
    budgeroNote: 'EUR, GBP, CHF, PLN, SEK, NOK + live FX',
    ynabNote: 'One currency per budget, no conversion',
  },
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    ynab: '$109/year (~€100)',
    budgeroNote: 'Or free with Self-Host',
    ynabNote: null,
  },
  {
    feature: 'Where your data lives',
    budgero: 'Finland 🇫🇮',
    ynab: 'United States',
    budgeroNote: 'EU jurisdiction, zero-knowledge encrypted',
    ynabNote: 'US servers, subject to US data law',
  },
  {
    feature: 'Telemetry & tracking',
    budgero: 'Opt-in only',
    ynab: true,
    budgeroNote: 'No telemetry unless you explicitly allow it',
    ynabNote: 'Third-party analytics by default',
  },
  {
    feature: 'End-to-end encryption',
    budgero: true,
    ynab: false,
    budgeroNote: 'AES-256-GCM, zero-knowledge',
    ynabNote: 'Plaintext on their servers',
  },
  {
    feature: 'Offline mode',
    budgero: true,
    ynab: false,
    budgeroNote: 'PWA works fully offline',
    ynabNote: 'Requires internet',
  },
  {
    feature: 'Billing in your currency',
    budgero: true,
    ynab: false,
    budgeroNote: 'VAT-compliant EU invoicing',
    ynabNote: 'USD-only charges',
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
    budgeroNote: 'Docker, your EU server',
    ynabNote: null,
  },
];

const euBankingExamples = [
  {
    country: 'Germany',
    flag: '🇩🇪',
    banks: 'N26, DKB, Deutsche Bank, ING, Commerzbank',
    pain: 'YNAB\u2019s Plaid sync covers only select German banks — N26, DKB, and regional Sparkassen still mean manual CSV.',
  },
  {
    country: 'United Kingdom',
    flag: '🇬🇧',
    banks: 'Monzo, Revolut, Starling, HSBC, Lloyds',
    pain: 'YNAB returned in 2024–25 via Plaid, but Starling and Lloyds are still outside coverage — and billing stays in USD.',
  },
  {
    country: 'Netherlands',
    flag: '🇳🇱',
    banks: 'ING, ABN AMRO, Rabobank, Bunq',
    pain: 'Plaid coverage is spotty and iDEAL-linked transfers rarely show up correctly.',
  },
  {
    country: 'Switzerland',
    flag: '🇨🇭',
    banks: 'UBS, Raiffeisen, PostFinance, Revolut CH',
    pain: 'CHF is not a first-class citizen in YNAB. Manual FX conversion every time.',
  },
  {
    country: 'Nordics',
    flag: '🇸🇪',
    banks: 'Swedbank, Nordea, SEB, DNB',
    pain: 'SEK and NOK are not supported as budget currencies alongside EUR.',
  },
  {
    country: 'Central Europe',
    flag: '🇵🇱',
    banks: 'mBank, PKO BP, Revolut, ING PL',
    pain: 'PLN, CZK, HUF are second-class currencies in most US-built apps.',
  },
];

const faqs = [
  {
    q: 'Does Budgero work across Europe?',
    a: "Yes. Budgero works in every EU country plus the UK, Switzerland, Norway, and Iceland. The app, billing, onboarding, and support are all built without US-centric assumptions. Our users are concentrated across Germany, the UK, the Netherlands, France, Spain, Poland, and Sweden.",
  },
  {
    q: 'Is Budgero GDPR-compliant?',
    a: "Yes — structurally, not just on paper. Your data is hosted in Finland under EU jurisdiction, and it is encrypted on your device before it ever reaches our servers, so we literally cannot decrypt it. There is no sensitive personal data for us to expose, lose, or be compelled to hand over, and no telemetry runs unless you explicitly enable it. You can also self-host on your own EU infrastructure if you prefer full data sovereignty.",
  },
  {
    q: 'What happened to YNAB in the UK and Europe?',
    a: "YNAB officially withdrew from the UK in 2022, citing the cost of maintaining UK-specific features. In 2024\u201325 it returned via Plaid's Open Banking integration — UK users can now link select banks (Revolut, Monzo, Nationwide, NatWest, HSBC, American Express and others) and import transactions directly. Coverage is real but selective: many UK and EU banks are still outside Plaid's supported list, billing remains in USD, there is still no multi-currency support, EU-specific flows like SEPA direct debits or iDEAL-linked transfers don't map cleanly, and VAT-compliant invoicing isn't offered. So YNAB works in the UK again, it just doesn't work the way most European households need it to.",
  },
  {
    q: 'Can I budget in EUR, GBP, and other European currencies?',
    a: `Yes. Budgero supports 168 currencies natively — EUR, GBP, CHF, PLN, SEK, NOK, DKK, CZK, HUF, RON, HRK, BGN and more. You can hold accounts in multiple currencies simultaneously, see your total net worth in your home currency, and assign budget amounts across currencies. Live exchange rates update automatically.`,
  },
  {
    q: 'How much does Budgero cost in euros?',
    a: `Budgero Cloud is ${pricing.monthly}/month or ${pricing.yearly}/year. At current rates that is roughly €6–€7/month or €55/year — about half of what YNAB charges. We accept EUR, GBP, and other European currencies via Stripe, and we issue proper VAT-compliant invoices for freelancers and businesses. If you prefer to not pay anything, Budgero Self-Host is free forever on your own server.`,
  },
  {
    q: 'Can I get a VAT invoice?',
    a: "Yes. Every payment generates a VAT-compliant invoice downloadable from your account. For freelancers and small businesses across the EU, this means Budgero is properly deductible as a business expense. YNAB does not issue VAT invoices by default.",
  },
  {
    q: 'Can I import my YNAB budget?',
    a: 'Yes. Budgero imports YNAB export files directly. Categories, transactions, budget groups, and accounts come across intact. The process takes about 5 minutes. Your years of YNAB history are preserved.',
  },
  {
    q: 'Does Budgero connect to European banks?',
    a: "No, and that is deliberate. Automatic bank sync requires sharing your banking credentials with a third-party aggregator like Plaid or Tink. Budgero is manual-first: you either enter transactions yourself or import a CSV from your bank. This keeps your credentials under your control and is part of why Budgero can offer true end-to-end encryption. If automatic bank sync is a dealbreaker, Budgero is not the right choice.",
  },
  {
    q: 'Where is my data stored?',
    a: "In Finland. Budgero Cloud runs on EU infrastructure under EU jurisdiction — your encrypted data never sits on US servers. And because it is encrypted on your device with a key we never see, even we cannot read it where it sits. If you want full control over hosting location, Budgero Self-Host lets you run the same app on your own server with Docker in under an hour.",
  },
  {
    q: 'Does Budgero work offline?',
    a: "Yes. Budgero is a Progressive Web App with full offline support. Add transactions on a train without signal, review your budget on a flight, or keep your data off the network entirely. Everything syncs automatically when you reconnect.",
  },
  {
    q: 'Does Budgero collect telemetry or usage analytics?',
    a: 'Not unless you explicitly allow it. By default the app sends no telemetry, no usage tracking, and no analytics events. If you opt in, anonymized diagnostics help us fix bugs — and you can turn it off again at any time.',
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

export default function YnabAlternativeEuropePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Budgero',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
        url: 'https://budgero.app/ynab-alternative-europe',
        description:
          'YNAB alternative for Europe — zero-based budgeting in EUR, GBP, CHF, PLN and 168 currencies, with end-to-end encryption, data hosted in Finland, and VAT-compliant billing.',
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
          'Zero-knowledge encryption (AES-256-GCM)',
          'Multi-currency (168 currencies) with live FX rates',
          'Data hosted in Finland (EU)',
          'No telemetry unless explicitly enabled',
          'VAT-compliant invoicing',
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
            name: 'YNAB Alternative for Europe',
            item: 'https://budgero.app/ynab-alternative-europe',
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
                  <Globe className="w-3.5 h-3.5 mr-2 shrink-0" />
                  <span>Built for Europe — 168 currencies</span>
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  The YNAB Alternative for Europe
                  <span className="block text-2xl md:text-3xl mt-3 text-foreground/70 font-medium">
                    Multi-currency, data hosted in Finland, and built for how European households
                    actually earn and spend.
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  YNAB bills in USD, still doesn&apos;t do multi-currency, and sends your bank
                  data through Plaid. Budgero is a zero-based budgeting app built with EU-first
                  currencies, zero-knowledge privacy, and proper VAT invoicing — at roughly half
                  the price.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-europe&utm_content=hero">
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
                    <a href="#comparison">See the Europe Comparison</a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  No card. VAT-compliant invoicing. 168 currencies from day one.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why European YNAB users are leaving */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why European YNAB Users Are Leaving
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  YNAB is a great American app. The operative word is <em>American</em>. The
                  envelope-budgeting philosophy travels well. The actual product does not.
                </p>

                <div className="space-y-4">
                  <p>
                    <strong className="text-foreground">YNAB&apos;s UK return is via Plaid.</strong>{' '}
                    YNAB withdrew from the UK in 2022 and returned in 2024–25 through Plaid&apos;s
                    Open Banking integration. Coverage is real but selective — Revolut, Monzo,
                    Nationwide, NatWest, HSBC and American Express are in; many smaller UK
                    institutions still aren&apos;t. And every connection routes your transaction
                    data through Plaid as a third party.
                  </p>
                  <p>
                    <strong className="text-foreground">EU bank sync is uneven.</strong> YNAB&apos;s
                    direct import covers select EU banks via Plaid. If you bank with N26, Bunq,
                    Revolut EU, or any of hundreds of smaller regional banks outside Plaid&apos;s
                    coverage list, you&apos;re still on CSV exports.
                  </p>
                  <p>
                    <strong className="text-foreground">
                      Multi-currency is effectively not supported.
                    </strong>{' '}
                    YNAB treats each account as a single currency and offers no home-currency
                    rollup. Expats, cross-border households, freelancers invoicing abroad, and
                    anyone who lives between EUR and GBP hit the wall immediately.
                  </p>
                  <p>
                    <strong className="text-foreground">
                      No VAT-compliant invoicing for freelancers.
                    </strong>{' '}
                    YNAB does not issue proper VAT invoices. If you are a freelancer in Germany,
                    France, Italy, or Spain, that matters at tax time.
                  </p>
                  <p>
                    <strong className="text-foreground">Data lives under US law.</strong> YNAB
                    stores your budget on US servers, subject to US subpoenas and data legislation.
                    For Europeans who care about GDPR and data sovereignty, that is a real concern —
                    especially when the data is stored in plaintext.
                  </p>
                  <p>
                    <strong className="text-foreground">Billed in USD.</strong> YNAB is
                    $14.99/month or $109/year — roughly €100/year once you include FX fees. For
                    an app that still doesn&apos;t natively support your currency or your tax
                    regime, that&apos;s a hard sell in 2026.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section id="comparison" className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs. YNAB — The European View
                </h2>
                <p className="text-lg text-foreground/70">
                  Where it actually matters for households and freelancers on the continent.
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
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-europe&utm_content=mid-table">
                    Start 35-Day Free Trial
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <span className="text-sm text-foreground/60">
                  No card · 168 currencies · VAT-compliant
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* EU Banking Landscape */}
            <section className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero Understands the European Banking Landscape
                </h2>
                <p className="text-lg text-foreground/70 max-w-3xl mx-auto">
                  Plaid does not. Budgero skips the bank-aggregator middleman entirely — which means
                  it works the same everywhere, for every bank, with every currency.
                </p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {euBankingExamples.map((c) => (
                  <div
                    key={c.country}
                    className="bg-card rounded-xl p-6 border border-border/70"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{c.flag}</span>
                      <h3 className="font-semibold text-foreground text-lg">{c.country}</h3>
                    </div>
                    <p className="text-sm text-foreground/65 mb-3">
                      <strong className="text-foreground/85">Common banks:</strong> {c.banks}
                    </p>
                    <p className="text-sm text-foreground/70">
                      <strong className="text-foreground/85">YNAB problem:</strong> {c.pain}
                    </p>
                  </div>
                ))}
              </div>

              <p className="mt-8 text-center text-foreground/60 max-w-2xl mx-auto">
                In Budgero, it does not matter which bank you use. You import CSVs or enter
                transactions yourself, and every currency works the same way — whether it is EUR,
                GBP, CHF, PLN, SEK, or anything else.
              </p>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Multi-currency deep section */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Real Multi-Currency, Not &ldquo;One Currency Per Budget&rdquo;
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  A lot of European budgeters have one budget for EUR and another for GBP. That
                  works for exactly nobody. If rent goes out in GBP, groceries in EUR, and your
                  salary arrives in whichever of the two your employer decided, you need one unified
                  picture.
                </p>
                <p>
                  Budgero lets you hold accounts in any of{' '}
                  <Link
                    href="/multi-currency-budgeting"
                    className="underline hover:text-foreground"
                  >
                    168 currencies
                  </Link>{' '}
                  inside the same budget. Pick a home currency (say, EUR). Every transaction in GBP,
                  CHF, PLN, or SEK is automatically converted at the live exchange rate. Your net
                  worth rolls up in your home currency. Your budget envelopes work across currencies
                  transparently.
                </p>
                <p>
                  This is the number one reason Europeans switch. YNAB has never offered this
                  natively, and the community workarounds (multiple budgets, manual FX conversion)
                  break down within a month.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* GDPR and privacy */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-card rounded-2xl p-8 border border-border/70">
                <div className="flex items-center gap-3 mb-4">
                  <Shield className="w-8 h-8 text-[#2f6246]" />
                  <h2 className="text-2xl md:text-3xl font-bold text-foreground">
                    Your Data Lives in Finland — and We Can&apos;t Read It
                  </h2>
                </div>
                <p className="text-lg text-foreground/75 leading-relaxed mb-4">
                  Budgero Cloud is hosted in Finland, in the EU, under EU jurisdiction — not on US
                  servers subject to US data law. And before your data even gets there, it is
                  encrypted on your device with a key that never leaves it. We cannot decrypt your
                  budget — not for marketing, not for support, not for subpoenas.
                </p>
                <p className="text-lg text-foreground/75 leading-relaxed mb-4">
                  Concretely, that means:
                </p>
                <ul className="space-y-3 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      No telemetry, no usage tracking, no analytics — unless you explicitly turn
                      it on. The app does not phone home by default.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Your data export request is instant — we hand you your encrypted blob and
                      that is everything we have.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Right to be forgotten is mechanical — delete your account and your encrypted
                      blob is gone. There is no shadow copy in an analytics pipeline.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Data breach risk is minimized — even a full server compromise yields
                      encrypted gibberish, not your financial history.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Full data sovereignty is one Docker command away — run{' '}
                      <Link
                        href="/self-hostable"
                        className="underline hover:text-foreground"
                      >
                        Budgero Self-Host
                      </Link>{' '}
                      on your own EU server if you want total control.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Pricing in EUR context */}
            <section className="py-16 max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 mb-4">
                <Euro className="w-6 h-6 text-foreground/70" />
                <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                  Priced for Europe
                </h2>
              </div>
              <p className="text-lg text-foreground/75 leading-relaxed mb-6">
                Budgero Cloud is {pricing.monthly}/month or {pricing.yearly}/year — roughly €6–€7
                per month, or around €55 per year. That is about half of what YNAB charges. Payments
                are handled by Stripe, which bills cleanly in EUR, GBP, and dozens of other
                currencies, and every payment produces a VAT-compliant invoice that you can hand
                straight to your accountant.
              </p>
              <p className="text-lg text-foreground/75 leading-relaxed">
                If you would rather not pay at all, Budgero Self-Host is free forever. Full feature
                parity. Runs on a €5/month VPS in a data center of your choosing — which, for many
                European users, is itself the point.
              </p>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Who This Is For */}
            <section className="py-16 max-w-4xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Who Budgero Is Built For
              </h2>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-[#e8f0e8] rounded-2xl p-8 border border-[#bfd7c2]">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <Check className="w-6 h-6 text-green-600" />
                    You are a good fit if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/80">
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Live in the EU, UK, Switzerland, or the Nordics</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Earn or spend in more than one currency</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Are a freelancer who needs VAT-compliant invoices</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        Care that your financial data is not stored in plaintext on US servers
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want the option to self-host on EU infrastructure</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Already have a YNAB budget you want to bring across</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    You might be better off with YNAB if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Only use USD and are based in the US (Budgero works, but YNAB is optimized
                        for you)
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Need automatic bank sync and refuse to consider CSV imports or manual entry
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>Prefer native iOS and Android apps over a PWA</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Are not concerned about data sovereignty or encryption-at-rest guarantees
                      </span>
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
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
                >
                  <Download className="w-3.5 h-3.5 mr-2" />
                  35 days free, no card
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Budget in every currency. Privately. From Europe.
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Start your 35-day Budgero Cloud trial. Import your YNAB budget in minutes. Or
                  self-host for free on your own server. Your data stays yours either way.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=ynab-alternative-europe&utm_content=final">
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
                  <Link href="/ynab-alternative-uk" className="underline hover:text-foreground">
                    YNAB alternative for the UK
                  </Link>{' '}
                  ·{' '}
                  <Link href="/vs-ynab" className="underline hover:text-foreground">
                    Full Budgero vs YNAB comparison
                  </Link>{' '}
                  ·{' '}
                  <Link
                    href="/multi-currency-budgeting"
                    className="underline hover:text-foreground"
                  >
                    Multi-currency budgeting
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
