import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Download, Import } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Budgero vs YNAB — The Free YNAB Alternative (2026)',
  description: `Budgero vs YNAB, compared feature by feature. The free YNAB alternative: self-host at no cost, or Cloud from ${pricing.monthly}/mo — half of YNAB's price. Import your YNAB budget in 5 minutes.`,
  keywords: [
    'free ynab alternative',
    'ynab free alternative',
    'ynab alternative free',
    'budgero vs ynab',
    'ynab vs budgero',
    'free alternative to ynab',
    'ynab free version',
    'apps like ynab but free',
    'switch from ynab',
    'ynab import',
    'ynab replacement',
    'ynab alternative encrypted',
  ],
  alternates: { canonical: 'https://budgero.app/vs-ynab' },
  openGraph: {
    title: 'Budgero vs YNAB — The Free YNAB Alternative (2026)',
    description:
      "Free to self-host, or Cloud at half YNAB's price. Zero-based budgeting in 168 currencies with end-to-end encryption. Import your YNAB budget in 5 minutes.",
    url: 'https://budgero.app/vs-ynab',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Budgero vs YNAB — The Free YNAB Alternative (2026)',
    description:
      "Free to self-host, or Cloud at half YNAB's price. Zero-based budgeting in 168 currencies, end-to-end encrypted.",
  },
};

const comparisonData = [
  { feature: 'Monthly price', cloud: `${pricing.monthly}/mo (${pricing.yearly}/yr)`, selfHost: 'Free forever', ynab: '$14.99/mo ($109/yr)' },
  { feature: 'Free trial', cloud: '35 days, no credit card', selfHost: 'N/A — always free', ynab: '34 days' },
  { feature: 'Trial Rewards (earn discounts on annual plan)', cloud: true, selfHost: 'N/A — already free', ynab: false, cloudNote: '10–35% off · 2 yrs · earned via real budgeting habits', ynabNote: 'Not offered' },
  { feature: 'Zero-based budgeting', cloud: true, selfHost: true, ynab: true },
  { feature: 'End-to-end encryption', cloud: 'AES-256-GCM, zero-knowledge', selfHost: 'Local encryption', ynab: false, ynabNote: 'Data stored in plaintext' },
  { feature: 'Offline mode', cloud: true, selfHost: true, ynab: false },
  { feature: 'Multi-currency support', cloud: '168 currencies', selfHost: '168 currencies', ynab: false, ynabNote: 'Manual workarounds only' },
  { feature: 'Bank sync', cloud: false, selfHost: false, ynab: true, cloudNote: 'Manual entry by design', ynabNote: 'US/Canada/EU via Plaid' },
  { feature: 'YNAB data import', cloud: true, selfHost: true, ynab: 'N/A' },
  { feature: 'Self-hosting option', cloud: false, selfHost: true, ynab: false, cloudNote: 'Use Self-Host edition' },
  { feature: 'Works if you cancel', cloud: 'Export anytime', selfHost: 'Your data, your server', ynab: false, ynabNote: 'Lose access to budgets' },
  { feature: 'Mobile app', cloud: 'PWA', selfHost: 'PWA', ynab: 'Native iOS & Android' },
  { feature: 'Shared budgets', cloud: true, selfHost: 'Via shared server', ynab: true, cloudNote: 'Encrypted shared workspaces', ynabNote: 'Up to 5 users' },
  { feature: 'AI categorization', cloud: true, selfHost: true, ynab: false, cloudNote: 'Local LLM, optional' },
  { feature: 'Receipt scanning', cloud: true, selfHost: true, ynab: false, cloudNote: 'AI-powered, privacy-first' },
  { feature: 'Reports & analytics', cloud: 'Modern dashboards', selfHost: 'Modern dashboards', ynab: 'Basic reports' },
  { feature: 'API access', cloud: true, selfHost: true, ynab: false, cloudNote: 'Push API' },
];

const faqs = [
  {
    q: 'Does Budgero work outside the US?',
    a: "Yes — that's a core reason people switch. Budgero works in every country, supports 168 currencies natively (with automatic conversion to your home currency), and the app, billing, and onboarding are all built to work without US-centric assumptions. Budgero is especially popular with users in Europe, the UK, Australia, and across Asia where YNAB's bank sync and pricing don't fit.",
  },
  {
    q: 'How is Budgero different from YNAB on multi-currency?',
    a: `YNAB treats each account as a single currency and has no native way to show a unified home-currency total across accounts in different currencies. Budgero is multi-currency from the ground up: hold accounts in EUR, USD, GBP, JPY, and 164 other currencies simultaneously, with live exchange rates and a consolidated dashboard in your home currency. It is the feature most European and expat users cite as the reason they left YNAB.`,
  },
  {
    q: 'Is there a free version of Budgero?',
    a: `Yes — Budgero Self-Host is completely free. You run it on your own server with Docker. No trial period, no feature gating. Budgero Cloud is the same app fully managed (we handle hosting, updates, and backups) for ${pricing.monthly}/month or ${pricing.yearly}/year. Both editions include the full feature set.`,
  },
  {
    q: 'Can I earn a discount on Budgero like YNAB student pricing?',
    a: 'Better — and not gamification. Budgero ties discounts to the habits that make manual budgeting work: log transactions on 7 of your first 10 days (Foundation, 10% off), reconcile an account and fund a goal (Discipline, 20% off), and budget across two calendar months (Persistence, 35% off). All discounts apply to the annual plan for two full years. The healthier your budget when the trial ends, the better your annual price. YNAB has no equivalent program — and unlike a student discount, this is earned, not granted.',
  },
  {
    q: 'Can I import my YNAB budget into Budgero?',
    a: 'Yes. Budgero imports YNAB export files and automatically maps your transactions, categories, groups, and accounts. The process takes about 5 minutes and preserves your full history.',
  },
  {
    q: 'Does Budgero connect to my bank?',
    a: "No, and that's intentional. Bank sync requires sharing your credentials with third-party aggregators like Plaid. Budgero is manual-first: you enter transactions yourself (or scan receipts), which means your bank credentials never leave your control.",
  },
  {
    q: 'How does Budgero keep my data private?',
    a: "Budgero uses end-to-end encryption (AES-256-GCM with PBKDF2-HMAC-SHA256 key derivation at 600,000 iterations). Your data is encrypted on your device before it's sent to our servers. We literally cannot read your budget. Even if someone breached our servers, they'd get encrypted gibberish.",
  },
  {
    q: 'Does Budgero work offline?',
    a: "Yes. Budgero is built as a Progressive Web App with full offline support. You can add transactions, review your budget, and make changes without an internet connection. Everything syncs automatically when you're back online.",
  },
  {
    q: 'Can I budget in multiple currencies?',
    a: 'Yes. Budgero supports 168 currencies with automatic exchange rates and a unified dashboard in your home currency. This is one of the most common reasons international users switch from YNAB.',
  },
  {
    q: 'What happens if I cancel Budgero Cloud?',
    a: 'Your data is yours. You can export it anytime. If you cancel Cloud, you can also switch to the free Self-Host edition and keep budgeting without interruption. Unlike YNAB, canceling does not mean losing access to your data.',
  },
];

function renderCellValue(val: unknown, note?: string, isHighlight?: boolean) {
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
      <span className={`text-sm ${isHighlight ? 'font-medium text-[#2f6246]' : 'text-foreground/65'}`}>
        {String(val)}
      </span>
      {note && <span className="text-xs text-foreground/55">{note}</span>}
    </div>
  );
}

export default function VsYnabPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        image: 'https://budgero.app/logo_512.png',
        name: 'Budgero',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
        url: 'https://budgero.app/vs-ynab',
        description:
          'The free YNAB alternative — zero-based budgeting in 168 currencies with end-to-end encryption and offline mode. Free self-host edition, Cloud at half YNAB\u2019s price.',
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
          'Zero-based budgeting',
          'Zero-knowledge encryption (AES-256-GCM)',
          'Multi-currency (168 currencies)',
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
          { '@type': 'ListItem', position: 2, name: 'Budgero vs YNAB', item: 'https://budgero.app/vs-ynab' },
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
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
                >
                  <Download className="w-3.5 h-3.5 mr-2" />
                  35-Day Free Trial, No Card Required
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  Budgero vs YNAB: The Free YNAB Alternative
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Everything YNAB does well — free if you self-host, half the price on Cloud.
                  Zero-based budgeting in 168 currencies, with end-to-end encryption and offline
                  mode. Import your YNAB budget in 5 minutes.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=vs-ynab&utm_content=hero">
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
                    <a href="#comparison">See How Budgero Compares</a>
                  </Button>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why People Switch */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why European & International YNAB Users Are Switching
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  YNAB pioneered zero-based budgeting and it changed the way a generation thinks
                  about money. But YNAB was built for the US market, and it shows. If you live in
                  Europe, the UK, Australia, Asia, or anywhere else outside North America — or if
                  you earn or spend in multiple currencies — YNAB leaves you with workarounds instead
                  of a product built for you.
                </p>

                <div className="space-y-4">
                  <p>
                    <strong className="text-foreground">
                      No native multi-currency support.
                    </strong>{' '}
                    YNAB has no concept of currencies beyond the account level — you cannot hold
                    accounts in EUR and GBP and see a unified picture in a single home currency.
                    Expats, freelancers invoicing abroad, and cross-border households all hit the
                    same wall.
                  </p>
                  <p>
                    <strong className="text-foreground">Bank sync is US-first.</strong> YNAB&apos;s
                    bank sync works well in the US and Canada, thinly in parts of Europe via Plaid,
                    and not at all in most of the world. Outside those regions you are paying full
                    US price for a feature you cannot use.
                  </p>
                  <p>
                    <strong className="text-foreground">Price keeps climbing.</strong> YNAB costs
                    $14.99/month or $109/year — roughly €100/year at current rates. For an app that
                    does not track investments, does not support multi-currency budgeting natively,
                    and stores all your financial data on their servers, that is a hard sell in
                    2026.
                  </p>
                  <p>
                    <strong className="text-foreground">Privacy concerns.</strong> YNAB stores your
                    budget data on their servers in plaintext. If you connect your bank, your
                    credentials flow through Plaid, a third-party data aggregator. You are trusting
                    two companies with your complete financial picture.
                  </p>
                  <p>
                    <strong className="text-foreground">No offline mode.</strong> YNAB is a web-first
                    app. If you are on a plane, in a rural area, or just prefer to budget without an
                    internet connection, you are out of luck.
                  </p>
                  <p>
                    <strong className="text-foreground">Vendor lock-in.</strong> Cancel your YNAB
                    subscription and you lose access to your data. Your budget history, your
                    categories, your years of careful tracking, gone unless you export before your
                    subscription lapses.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section id="comparison" className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs. YNAB — Feature-by-Feature Comparison
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
                        Budgero Cloud
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Budgero Self-Host
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
                          {renderCellValue(row.cloud, row.cloudNote, true)}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {renderCellValue(row.selfHost, undefined, true)}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {renderCellValue(row.ynab, row.ynabNote, false)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-6 text-foreground/60 text-sm max-w-3xl">
                <strong className="text-foreground">Key takeaway:</strong> Budgero Cloud gives you
                everything YNAB does for zero-based budgeting, plus encryption, offline mode,
                multi-currency, and AI features, at a lower price. The trade-off is no automatic bank
                sync: Budgero is manual-first by design, because that is how you keep your data truly
                private.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="h-12 px-7 text-base bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=vs-ynab&utm_content=mid-table">
                    Start 35-Day Free Trial
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <span className="text-sm text-foreground/60">
                  No card · 168 currencies · Import your YNAB budget
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Migration Walkthrough */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <Badge className="mb-4 bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30">
                  <Import className="w-3.5 h-3.5 mr-2" />
                  Seamless Migration
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  How to Switch from YNAB to Budgero in 5 Minutes
                </h2>
                <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
                  Switching does not mean starting over. Budgero imports your entire YNAB budget so
                  you can pick up exactly where you left off.
                </p>
              </div>

              <div className="space-y-6 max-w-3xl mx-auto">
                {[
                  {
                    step: '1',
                    title: 'Export Your YNAB Data',
                    text: 'Open YNAB, go to your budget settings, and click "Export Budget." YNAB will download a ZIP file containing your transactions, budget amounts, and account info.',
                    tip: 'Export before your subscription ends. Once your YNAB subscription lapses, you lose access to the export feature.',
                  },
                  {
                    step: '2',
                    title: 'Create Your Budgero Account',
                    text: 'Head to my.budgero.app and sign up for a free Cloud trial. No credit card required. You get 35 days to explore everything.',
                  },
                  {
                    step: '3',
                    title: 'Import Your YNAB File',
                    text: 'In Budgero, open Settings and click "Import." Drop in your YNAB export file. Budgero automatically maps your categories, groups, and accounts. You will see a preview of everything before confirming.',
                  },
                  {
                    step: '4',
                    title: 'Review and Adjust',
                    text: 'Take a few minutes to review your imported data. Budgero preserves your category structure, but you might want to tweak a few names or merge groups. Your full transaction history is there, ready to go.',
                  },
                  {
                    step: '5',
                    title: 'Start Budgeting',
                    text: 'That is it. Your entire YNAB workflow, categories, balances, transaction history, is now in Budgero with end-to-end encryption.',
                  },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-lg font-bold text-foreground">{item.step}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1 text-lg">{item.title}</h3>
                      <p className="text-foreground/70">{item.text}</p>
                      {item.tip && (
                        <p className="mt-2 text-sm text-foreground/55 italic">Tip: {item.tip}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-8 text-center text-foreground/60">
                The whole process takes about 5 minutes. No re-entering transactions. No rebuilding
                categories from scratch. No lost history.
              </p>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* What Makes Budgero Different */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-10">
                What You Get with Budgero That YNAB Does Not Offer
              </h2>

              <div className="space-y-10">
                <div>
                  <h3 className="text-xl font-bold text-foreground mb-3">
                    True Zero-Knowledge Privacy
                  </h3>
                  <p className="text-lg text-foreground/75 leading-relaxed">
                    Budgero encrypts your financial data on your device before it ever reaches our
                    servers. We use AES-256-GCM encryption with PBKDF2-HMAC-SHA256 key derivation, the same
                    cryptographic standards banks and security-critical applications rely on. The
                    difference: even Budgero&apos;s own team cannot read your budget. With YNAB, your
                    data sits on their servers in readable form.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground mb-3">
                    Works Everywhere, in Every Currency
                  </h3>
                  <p className="text-lg text-foreground/75 leading-relaxed">
                    YNAB was built for the US market. Budgero was built for the world. Track spending
                    in{' '}
                    <Link href="/multi-currency-budgeting" className="underline hover:text-foreground">
                      168 currencies
                    </Link>{' '}
                    with automatic conversion rates and a unified dashboard in your home currency.
                    Whether you are an expat in Singapore, a freelancer invoicing in euros, or a
                    family splitting time between two countries, Budgero handles it natively. No
                    workarounds, no manual exchange rate math.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground mb-3">
                    Offline-First Architecture
                  </h3>
                  <p className="text-lg text-foreground/75 leading-relaxed">
                    Budgero&apos;s Progressive Web App works fully offline. Add transactions on a
                    flight, review your budget at a cabin with no signal, or simply keep your
                    financial data off the network entirely. Everything syncs automatically when you
                    reconnect.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground mb-3">
                    AI That Respects Your Privacy
                  </h3>
                  <p className="text-lg text-foreground/75 leading-relaxed">
                    Budgero integrates with local LLMs to offer intelligent features without sending
                    your data to external AI services. Auto-categorize transactions based on your
                    patterns. Scan receipts and extract merchant, amount, and date. All processed
                    locally.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground mb-3">
                    You Own Your Data. Period.
                  </h3>
                  <p className="text-lg text-foreground/75 leading-relaxed">
                    Cancel Budgero Cloud and your data does not disappear. Export it anytime in
                    standard formats. Or go further: run{' '}
                    <Link href="/self-hostable" className="underline hover:text-foreground">
                      Budgero Self-Host
                    </Link>{' '}
                    on your own server with Docker, and your data never touches a third-party server
                    at all.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Who This Is For */}
            <section className="py-16 max-w-4xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Is Budgero the Right YNAB Alternative for You?
              </h2>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-[#e8f0e8] rounded-2xl p-8 border border-[#bfd7c2]">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <Check className="w-6 h-6 text-green-600" />
                    Budgero is a great fit if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/80">
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want zero-based budgeting without paying $109/year</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        Care about financial data privacy and do not want your budget stored in
                        plaintext
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        Live outside the US/Canada/EU where YNAB&apos;s bank sync does not work
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Budget in multiple currencies regularly</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Prefer manual transaction entry that keeps you aware of every dollar</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want an app that works offline</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Have years of YNAB data you do not want to lose</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Budgero might not be the right fit if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Need automatic bank sync and will not consider manual entry
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Want native iOS/Android apps (Budgero uses a PWA, works great but is not in
                        the App Store)
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Are happy with YNAB&apos;s pricing and privacy approach
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Need investment tracking in the same app (consider{' '}
                        <Link
                          href="/monarch-money-alternative"
                          className="underline hover:text-foreground"
                        >
                          Monarch Money
                        </Link>{' '}
                        for that)
                      </span>
                    </li>
                  </ul>
                  <p className="mt-6 text-sm text-foreground/55">
                    We would rather be honest about fit than over-promise. If bank sync is a
                    dealbreaker, Budgero is not for you, and that is OK.
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
                  Ready for a YNAB Alternative That Works Outside the US?
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Start your 35-day free trial of Budgero Cloud. Import your YNAB data in minutes,
                  budget in 168 currencies with end-to-end encryption, and see why international
                  users are making the switch.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=vs-ynab&utm_content=final">
                    Start Free Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                </Button>
                <p className="mt-6 text-sm text-foreground/60">
                  Prefer to self-host?{' '}
                  <Link href="/self-hosted-ynab-alternative" className="underline hover:text-foreground">
                    Run Budgero on your own server for free
                  </Link>
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Based in Europe? See the{' '}
                  <Link href="/ynab-alternative-europe" className="underline hover:text-foreground">
                    YNAB alternative for Europe
                  </Link>
                  .
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Comparing more apps? See the{' '}
                  <Link href="/best-ynab-alternatives" className="underline hover:text-foreground">
                    best YNAB alternatives in 2026
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
