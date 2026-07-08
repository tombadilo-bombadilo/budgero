import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Globe, Shield, Euro, DollarSign, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Monarch Money Alternative for Europe — Multi-Currency Budgeting | Budgero',
  description:
    'Monarch Money is US and Canada only. Budgero is the Monarch alternative for Europe — multi-currency, GDPR-compliant, encrypted, and built for EUR, GBP, CHF, and 165 more. 35-day free trial.',
  keywords: [
    'monarch money europe',
    'monarch money europe alternative',
    'monarch money uk',
    'monarch money eu',
    'monarch alternative europe',
    'monarch alternative uk',
    'monarch money germany',
    'monarch money netherlands',
    'european budgeting app',
    'monarch money international',
    'monarch money outside us',
    'budgeting app europe monarch',
    'monarch money multi currency',
  ],
  alternates: { canonical: 'https://budgero.app/monarch-money-europe-alternative' },
  openGraph: {
    title: 'Monarch Money Alternative for Europe — Multi-Currency Budgeting | Budgero',
    description:
      'Monarch Money is US and Canada only. Budgero is the Monarch alternative for Europe — multi-currency, GDPR-compliant, and built for EUR, GBP, CHF, and more.',
    url: 'https://budgero.app/monarch-money-europe-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Monarch Money Alternative for Europe — Multi-Currency Budgeting | Budgero',
    description:
      'Monarch is US/Canada only. Budgero works across Europe with 168 currencies and zero-knowledge encryption.',
  },
};

const comparisonData = [
  {
    feature: 'Available in Europe',
    budgero: true,
    monarch: false,
    budgeroNote: 'Every EU country + UK + CH',
    monarchNote: 'US and Canada only',
  },
  {
    feature: 'Multi-currency support',
    budgero: '168 currencies',
    monarch: 'USD only',
    budgeroNote: 'EUR, GBP, CHF, PLN, SEK + live FX',
    monarchNote: 'Foreign currency shown as $',
  },
  {
    feature: 'Billing currency',
    budgero: 'EUR, GBP, USD, etc.',
    monarch: 'USD only',
    budgeroNote: 'VAT invoices included',
    monarchNote: 'FX fees on every charge',
  },
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    monarch: '$99.99/year',
    budgeroNote: 'Or free with Self-Host',
    monarchNote: null,
  },
  {
    feature: 'GDPR-compliant by design',
    budgero: true,
    monarch: false,
    budgeroNote: 'Zero-knowledge architecture',
    monarchNote: 'US-based data storage',
  },
  {
    feature: 'Zero-knowledge encryption',
    budgero: true,
    monarch: false,
    budgeroNote: 'We cannot decrypt your data',
    monarchNote: 'Bank-level, but not zero-knowledge',
  },
  {
    feature: 'Works offline',
    budgero: true,
    monarch: false,
    budgeroNote: 'PWA, full offline',
    monarchNote: 'Cloud-only',
  },
  {
    feature: 'Bank sync for European banks',
    budgero: 'CSV / manual',
    monarch: false,
    budgeroNote: 'Import from any EU bank',
    monarchNote: 'No EU banks supported',
  },
  {
    feature: 'Investment tracking',
    budgero: 'Manual',
    monarch: 'Automatic (US brokers)',
    budgeroNote: 'Track any asset manually',
    monarchNote: 'US brokers only',
  },
  {
    feature: 'Self-host option',
    budgero: true,
    monarch: false,
    budgeroNote: 'Docker on EU server',
    monarchNote: null,
  },
  {
    feature: 'Mobile app in EU App Store',
    budgero: 'PWA (works everywhere)',
    monarch: false,
    budgeroNote: null,
    monarchNote: 'iOS: US store only',
  },
];

const euBankingExamples = [
  {
    country: 'Germany',
    flag: '🇩🇪',
    note: 'N26, DKB, Deutsche Bank — none connect to Monarch.',
  },
  {
    country: 'United Kingdom',
    flag: '🇬🇧',
    note: 'Monzo, Revolut, Starling — not available.',
  },
  {
    country: 'France',
    flag: '🇫🇷',
    note: 'BNP Paribas, Crédit Agricole, Société Générale — no integration.',
  },
  {
    country: 'Netherlands',
    flag: '🇳🇱',
    note: 'ING, ABN AMRO, Bunq — unsupported.',
  },
  {
    country: 'Spain',
    flag: '🇪🇸',
    note: 'Santander, BBVA, CaixaBank — not available.',
  },
  {
    country: 'Switzerland',
    flag: '🇨🇭',
    note: 'UBS, Raiffeisen, PostFinance — no CHF support.',
  },
];

const faqs = [
  {
    q: 'Why is Monarch Money not available in Europe?',
    a: 'Monarch Money was built for the US market and relies on US bank-sync providers like Plaid to work. They have announced Canadian support, but no European expansion. You cannot download the iOS app in the UK, EU, or Switzerland App Stores, and even if you use the web app, there is no way to connect European banks, hold non-USD accounts, or be billed in EUR or GBP. Monarch is unusable for European households as of 2026.',
  },
  {
    q: 'What is the best Monarch Money alternative for Europe?',
    a: 'Budgero. It is the budgeting app most European users switch to when they realise Monarch is not an option. Budgero supports 168 currencies natively (including EUR, GBP, CHF, PLN, SEK, and every other European currency), it is GDPR-compliant by design through zero-knowledge encryption, and it bills in your local currency with proper VAT invoices. You can use Budgero Cloud from anywhere, or self-host on your own EU server.',
  },
  {
    q: 'Can I hold accounts in EUR and GBP in Budgero?',
    a: 'Yes, in the same budget. Pick a home currency (say, EUR). Hold any number of accounts in any supported currency. Every transaction is automatically converted at live exchange rates, and your net worth rolls up in your home currency. Cross-border households, expats, and freelancers with multi-currency income are the single biggest group of Budgero users.',
  },
  {
    q: 'Does Budgero connect to European banks?',
    a: "No, and this is by design. Bank sync requires sharing your credentials with a third-party aggregator — which in Europe means Tink, GoCardless, or Plaid's limited European footprint. Budgero is manual-first: you enter transactions yourself or import CSVs from your bank. Every EU bank exports CSVs. This keeps your credentials under your control and is part of why Budgero can offer true end-to-end encryption.",
  },
  {
    q: 'Is Budgero GDPR-compliant?',
    a: "Yes. Because Budgero uses zero-knowledge encryption, your financial data is encrypted on your device before it ever reaches our servers. We literally cannot decrypt it. That makes Budgero one of the most GDPR-compliant budgeting apps available — there is no sensitive personal data for us to expose, lose, or be compelled to hand over. If full EU data sovereignty matters to you, you can also self-host on your own infrastructure.",
  },
  {
    q: 'Does Budgero have investment tracking like Monarch?',
    a: "Budgero supports manual investment tracking — you can record any asset, any currency, at any value. For European users this is usually preferable anyway, since Monarch's automatic brokerage sync does not work with European brokers (Interactive Brokers, Trading 212, DEGIRO, etc.). Manual tracking also means your portfolio stays encrypted and private.",
  },
  {
    q: 'How does Budgero bill customers in Europe?',
    a: "Via Stripe. We charge in EUR, GBP, or your local currency as appropriate, and every payment produces a VAT-compliant invoice downloadable from your account. For freelancers and small businesses across the EU, that means Budgero is properly deductible as a business expense. Monarch charges in USD with no local currency or VAT support.",
  },
  {
    q: 'Is Budgero cheaper than Monarch?',
    a: `Yes. Budgero Cloud is ${pricing.monthly}/month or ${pricing.yearly}/year, versus Monarch at $14.99/month or $99.99/year. That is roughly half the price, without the USD FX fees that European Monarch customers would incur. And if you prefer to not pay anything, Budgero Self-Host is free forever on your own Docker server.`,
  },
  {
    q: 'Can I import my Monarch Money data?',
    a: 'Yes. Budgero imports CSV exports from Monarch (and from most other budgeting apps). Categories, transactions, and account balances come across. The import tool gives you a preview before confirming, so nothing is ever overwritten unexpectedly.',
  },
  {
    q: 'Does Budgero work offline?',
    a: "Yes. Budgero is a Progressive Web App with full offline support. Add transactions on a flight, review your budget on a train with no signal, or keep your financial data off the network entirely. Everything syncs automatically when you reconnect. Monarch is cloud-only.",
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

const MONARCH_YEARLY_USD = 99.99;

export default function MonarchMoneyEuropeAlternativePage() {
  const budgeroYearly = parseFloat(pricing.yearly.replace(/[^0-9.]/g, ''));
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
        url: 'https://budgero.app/monarch-money-europe-alternative',
        description:
          'Monarch Money alternative for Europe — multi-currency budgeting in EUR, GBP, CHF, PLN and 168 currencies, with GDPR-compliant zero-knowledge encryption.',
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
          'Available across Europe',
          'Multi-currency (168 currencies) with live FX',
          'GDPR-compliant zero-knowledge encryption',
          'VAT-compliant billing in local currency',
          'Offline support',
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
            name: 'Monarch Money Alternative for Europe',
            item: 'https://budgero.app/monarch-money-europe-alternative',
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
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-red-500/30 text-red-700 dark:text-red-400 bg-red-500/10"
                >
                  <Ban className="w-3.5 h-3.5 mr-2" />
                  Monarch Money isn&apos;t available in Europe
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  The Monarch Money Alternative for Europe
                  <span className="block text-2xl md:text-3xl mt-3 text-foreground/70 font-medium">
                    Because Monarch literally doesn&apos;t work here.
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Monarch Money is a US and Canada product. No European bank integrations. No
                  non-USD currencies. No EU App Store listing. Budgero is the privacy-first
                  alternative built for EUR, GBP, CHF, and the other 165 currencies — plus
                  GDPR-compliant zero-knowledge encryption.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-money-europe-alternative&utm_content=hero">
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
                    <a href="#why-not-monarch">Why Monarch doesn&apos;t work in Europe</a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  35 days free, no card needed. Works in every European country, in your currency.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why Monarch doesn't work */}
            <section id="why-not-monarch" className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why Monarch Money Doesn&apos;t Work in Europe
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Monarch Money is a genuinely good product. It just isn&apos;t built for anyone
                  outside North America, and the gap is wider than most people expect.
                </p>

                <div className="space-y-4">
                  <p>
                    <strong className="text-foreground">No European banks.</strong> Monarch&apos;s
                    bank sync is powered by Plaid, MX, and Finicity — US-centric aggregators. No
                    N26, no Revolut EU, no Monzo, no ING, no Santander, no BNP Paribas, no HSBC UK.
                    You cannot connect a single European bank to Monarch.
                  </p>
                  <p>
                    <strong className="text-foreground">No non-USD currencies.</strong> Monarch
                    displays every transaction with a &ldquo;$&rdquo; symbol regardless of the
                    underlying currency. A €1,000 grocery bill shows as &ldquo;$1,000&rdquo;. A
                    £50 coffee shows as &ldquo;$50&rdquo;. There is no conversion, no multi-currency
                    awareness, and no way to set EUR, GBP, or CHF as your home currency.
                  </p>
                  <p>
                    <strong className="text-foreground">USD billing only.</strong> Monarch charges
                    in USD through the US App Store. European users pay FX fees on every renewal.
                    No VAT invoice is issued, which is a problem if you want to expense it as a
                    freelancer.
                  </p>
                  <p>
                    <strong className="text-foreground">iOS app not in European stores.</strong>{' '}
                    The Monarch iOS app is listed in the US App Store. European users have to use
                    the web app or maintain a US Apple ID.
                  </p>
                  <p>
                    <strong className="text-foreground">Data stored under US law.</strong>{' '}
                    Monarch&apos;s servers are in the US. Your financial data is subject to US data
                    legislation, which for many European users is a meaningful privacy concern
                    compared to an EU-hosted or zero-knowledge alternative.
                  </p>
                </div>

                <p className="pt-4">
                  The short version: Monarch is a US-first product that has not meaningfully
                  invested in internationalisation. If you live in Europe, you are not the customer
                  Monarch was built for.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* EU Banking Examples */}
            <section className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Not a Single European Bank Connects to Monarch
                </h2>
                <p className="text-lg text-foreground/70 max-w-3xl mx-auto">
                  Here are the common banks across major European countries. Monarch supports none
                  of them. Budgero works the same way with all of them — CSV import or manual
                  entry, every bank, every currency.
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
                    <p className="text-sm text-foreground/70">{c.note}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Key Advantages */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Why European Households Choose Budgero
                </h2>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dfe4ec] flex items-center justify-center mb-4">
                    <Globe className="w-6 h-6 text-[#314258]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Actually Works in Europe
                  </h3>
                  <p className="text-foreground/70">
                    Every EU country, the UK, Switzerland, Norway. CSV imports from any bank, every
                    currency, any account type.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dde9df] flex items-center justify-center mb-4">
                    <Euro className="w-6 h-6 text-[#2f6246]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Billed in Your Currency
                  </h3>
                  <p className="text-foreground/70">
                    Pay in EUR, GBP, or whichever currency you use. No USD FX fees. Proper
                    VAT-compliant invoice on every payment.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#e4dff0] flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-[#564176]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    GDPR by Design
                  </h3>
                  <p className="text-foreground/70">
                    Zero-knowledge encryption means we cannot see your data. Even a server breach
                    yields encrypted blobs, not your financial history.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#efe4d8] flex items-center justify-center mb-4">
                    <DollarSign className="w-6 h-6 text-[#8a5730]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    {percentCheaper}% Cheaper
                  </h3>
                  <p className="text-foreground/70">
                    Monarch costs $99.99/year. Budgero Cloud is {pricing.yearly}/year — save
                    ~${yearlySavings}/year. Or{' '}
                    <Link href="/self-hostable" className="underline hover:text-foreground">
                      self-host
                    </Link>{' '}
                    on your own EU server for free.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs. Monarch Money — The European View
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
                        Budgero
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Monarch Money
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
                          {renderCellValue(row.monarch, row.monarchNote, false)}
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
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-money-europe-alternative&utm_content=mid-table">
                    Start 35-Day Free Trial
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <span className="text-sm text-foreground/60">
                  No card · EUR/GBP billing · 168 currencies
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Who This Is For */}
            <section className="py-16 max-w-4xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Who This Is For
              </h2>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-[#e8f0e8] rounded-2xl p-8 border border-[#bfd7c2]">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <Check className="w-6 h-6 text-green-600" />
                    You&apos;re a great fit if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/80">
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Live in the EU, UK, Switzerland, or the Nordics</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Tried Monarch and discovered it doesn&apos;t work here</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Earn or spend in more than one European currency</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want GDPR-grade privacy with zero-knowledge encryption</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        Are a freelancer or small business needing VAT-compliant invoicing
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want the option to self-host on your own EU infrastructure</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Stick with Monarch if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>Are based in the US or Canada and bank there</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Need automatic investment sync from a US broker (Fidelity, Schwab, etc.)
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>Only budget in USD and never touch a foreign currency</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Prefer fully hands-off bank sync and are willing to share bank credentials
                        with Plaid
                      </span>
                    </li>
                  </ul>
                  <p className="mt-6 text-sm text-foreground/55">
                    Monarch is a solid app for US households. We are honest about that.
                  </p>
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
                  A budgeting app that actually works in Europe.
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Start your 35-day Budgero trial. Billed in EUR or GBP. Works with every European
                  bank via CSV. Zero-knowledge encryption, GDPR by design, and about half the price
                  of Monarch.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=monarch-money-europe-alternative&utm_content=final">
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
                    <Link href="/self-hosted-ynab-alternative">Self-host for free</Link>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Also see:{' '}
                  <Link
                    href="/monarch-money-alternative"
                    className="underline hover:text-foreground"
                  >
                    Full Budgero vs Monarch
                  </Link>{' '}
                  ·{' '}
                  <Link
                    href="/ynab-alternative-europe"
                    className="underline hover:text-foreground"
                  >
                    YNAB alternative for Europe
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
