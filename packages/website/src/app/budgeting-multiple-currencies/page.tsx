import type { Metadata } from 'next';
import { ArrowRight, Globe, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'How to Budget with Multiple Currencies | Budgero',
  description:
    'A practical guide to budgeting across multiple currencies. Learn approaches for expats, digital nomads, and anyone managing money in more than one currency.',
  keywords: [
    'how to budget multiple currencies',
    'budgeting as an expat',
    'multi currency budgeting',
    'expat budgeting',
    'digital nomad budgeting',
    'budgeting in two currencies',
    'managing money abroad',
    'foreign currency budgeting',
  ],
  alternates: { canonical: 'https://budgero.app/budgeting-multiple-currencies' },
  openGraph: {
    title: 'How to Budget with Multiple Currencies | Budgero',
    description:
      'A practical guide to budgeting across multiple currencies for expats, nomads, and global earners.',
    url: 'https://budgero.app/budgeting-multiple-currencies',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How to Budget with Multiple Currencies | Budgero',
    description: 'Practical guide to multi-currency budgeting for expats and digital nomads.',
  },
};

const approaches = [
  {
    title: 'The Spreadsheet',
    description:
      'Convert everything to one base currency manually. Update rates weekly. Look up FX rates on Google and type them in.',
    pros: 'Free and flexible.',
    cons: 'Tedious, error-prone, and you will stop doing it within a month.',
  },
  {
    title: 'Separate Budgets',
    description:
      'One budget per currency. Track each independently. Review them side by side.',
    pros: 'Simple per budget.',
    cons: 'No unified view. Cannot see total spending across currencies. Category splits are awkward.',
  },
  {
    title: 'A Multi-Currency App',
    description:
      'Use a budgeting app that handles currencies natively. Accounts in any currency, live FX rates, unified reporting in your base currency.',
    pros: 'Accurate, automatic, and sustainable.',
    cons: 'Fewer app options. Most budgeting apps do not support this properly.',
  },
];

const checklist = [
  'Native currency support per account, not just conversion',
  'Live exchange rates updated automatically',
  'Reporting that converts to your display currency',
  'Ability to budget in your base currency while spending in others',
  'Support for 50+ currencies minimum',
  'Clear handling of transfers between currencies',
];

const tips = [
  {
    title: 'Pick a base currency',
    description:
      'Choose the currency you think in. Usually where you pay rent. All your budgeting targets should be in this currency.',
  },
  {
    title: 'Do not convert manually',
    description:
      'Manual FX conversion is the fastest way to burn out on budgeting. Use a tool that does it for you.',
  },
  {
    title: 'Budget for FX fluctuations',
    description:
      'Add a 3-5% buffer to categories affected by currency swings. This prevents your budget from breaking when rates move.',
  },
  {
    title: 'Review in one currency',
    description:
      'Your spending reports should roll up to one display currency so you can see the real picture. Looking at separate currency totals is misleading.',
  },
  {
    title: 'Track transfers separately',
    description:
      'Moving money between currencies is not spending. Make sure your tool does not count FX transfers as expenses.',
  },
];

export default function BudgetingMultipleCurrenciesPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How to Budget with Multiple Currencies',
    author: { '@type': 'Organization', name: 'Budgero' },
    datePublished: '2026-04-11',
    description:
      'A practical guide to budgeting across multiple currencies for expats, digital nomads, and global earners.',
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
                <Badge variant="outline" className="mb-6 px-4 py-1.5 text-sm font-medium border-border/50">
                  <Globe className="w-3.5 h-3.5 mr-2" />
                  Practical Guide
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  How to Budget with Multiple Currencies
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    A practical guide for expats, nomads, and global earners
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  If you earn in one currency and spend in another, you already know that most
                  budgeting advice does not apply to you. Standard tools assume one currency. Your
                  life uses two or three. Here is how to handle it.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* The Challenge */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">The Challenge</h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Exchange rates fluctuate. Your budget in EUR might be fine today but 3% short next
                  month because the rate moved. Different accounts in different currencies make it
                  hard to see your total financial picture.
                </p>
                <p>
                  Category tracking gets complicated. Did you overspend on groceries, or did the
                  currency just shift? Most budgeting apps either ignore the problem entirely or
                  suggest creating separate budgets per currency, which defeats the purpose of
                  having a budget in the first place.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Three Approaches */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Three Approaches
                </h2>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {approaches.map((approach) => (
                  <div
                    key={approach.title}
                    className="bg-card rounded-xl p-6 border border-border/70"
                  >
                    <h3 className="font-semibold text-foreground mb-3 text-lg">
                      {approach.title}
                    </h3>
                    <p className="text-foreground/70 text-sm mb-4">{approach.description}</p>
                    <p className="text-xs text-foreground/55 mb-1">
                      <strong className="text-green-600">Pros:</strong> {approach.pros}
                    </p>
                    <p className="text-xs text-foreground/55">
                      <strong className="text-red-500">Cons:</strong> {approach.cons}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* What to Look For */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                What to Look For in a Multi-Currency Budget App
              </h2>
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <ul className="space-y-3">
                  {checklist.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-foreground/75">
                      <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Practical Tips */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Practical Tips
              </h2>
              <div className="space-y-6">
                {tips.map((tip, index) => (
                  <div key={tip.title} className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-sm font-bold text-foreground">{index + 1}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{tip.title}</h3>
                      <p className="text-foreground/70">{tip.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Soft Budgero Mention */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-card rounded-2xl p-8 border border-border/70">
                <p className="text-foreground/75 mb-6">
                  Budgero supports 100+ currencies with live exchange rates, zero-based budgeting,
                  and zero-knowledge encryption. Accounts in any currency, one unified budget,
                  reports in your base currency. Built by an expat who needed exactly this.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup">
                    Try Budgero Free
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </a>
                </Button>
                <p className="mt-4 text-sm text-foreground/55">
                  35-day trial. {pricing.yearly}/yr. No credit card required.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
