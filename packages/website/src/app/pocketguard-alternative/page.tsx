import type { Metadata } from 'next';
import { ArrowRight, Check, X, Shield, Lock, Target, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'PocketGuard Alternative - Budget Without Bank Connections | Budgero',
  description:
    'Looking for a PocketGuard alternative that doesn\'t require bank connections? Budgero offers zero-based budgeting with zero-knowledge encryption and multi-currency support.',
  keywords: [
    'pocketguard alternative',
    'pocketguard replacement',
    'budgeting app without bank connection',
    'pocketguard vs budgero',
    'private budget app',
    'budget app no plaid',
  ],
  alternates: { canonical: 'https://budgero.app/pocketguard-alternative' },
  openGraph: {
    title: 'PocketGuard Alternative - Budget Without Bank Connections | Budgero',
    description:
      'Looking for a PocketGuard alternative that doesn\'t require bank connections? Budgero offers zero-based budgeting with zero-knowledge encryption and multi-currency support.',
    url: 'https://budgero.app/pocketguard-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PocketGuard Alternative - Budget Without Bank Connections | Budgero',
    description:
      'Looking for a PocketGuard alternative that doesn\'t require bank connections? Budgero offers zero-based budgeting with zero-knowledge encryption and multi-currency support.',
  },
};

const comparisonData = [
  {
    feature: 'Annual price',
    budgero: `${pricing.yearly}/year`,
    pocketguard: '$34.99/year',
    budgeroNote: 'Or free with Self-Host',
    pocketguardNote: '$7.99/mo if monthly',
  },
  {
    feature: 'Budgeting method',
    budgero: 'Zero-based',
    pocketguard: 'Spending tracker',
    budgeroNote: 'Every dollar gets a job',
    pocketguardNote: '"In My Pocket" after bills',
  },
  {
    feature: 'Zero-knowledge encryption',
    budgero: true,
    pocketguard: false,
    budgeroNote: 'We cannot see your data',
    pocketguardNote: 'Standard server-side encryption',
  },
  {
    feature: 'Bank sync required',
    budgero: false,
    pocketguard: true,
    budgeroNote: 'Manual-first, works without it',
    pocketguardNote: 'Core functionality depends on it',
  },
  {
    feature: 'Multi-currency support',
    budgero: true,
    pocketguard: false,
    budgeroNote: '168 currencies, live FX rates',
    pocketguardNote: 'USD only',
  },
  {
    feature: 'Works offline',
    budgero: true,
    pocketguard: false,
    budgeroNote: null,
    pocketguardNote: 'Requires internet for sync',
  },
  {
    feature: 'Shared budgets',
    budgero: true,
    pocketguard: false,
    budgeroNote: '5 seats included',
    pocketguardNote: 'Single-user only',
  },
  {
    feature: 'Self-host option',
    budgero: true,
    pocketguard: false,
    budgeroNote: 'Free forever, full features',
    pocketguardNote: null,
  },
  {
    feature: 'Data export',
    budgero: true,
    pocketguard: true,
    budgeroNote: 'CSV export',
    pocketguardNote: 'CSV export',
  },
  {
    feature: 'Works worldwide',
    budgero: true,
    pocketguard: false,
    budgeroNote: '168 currencies, any country',
    pocketguardNote: 'US and Canada focused',
  },
];

export default function PocketGuardAlternativePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    image: 'https://budgero.app/logo_512.png',
    name: 'Budgero',
    applicationCategory: 'FinanceApplication',
    operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
    url: 'https://budgero.app/pocketguard-alternative',
    description:
      'PocketGuard alternative with zero-based budgeting, zero-knowledge encryption, multi-currency support, and no bank connection required.',
    offers: {
      '@type': 'Offer',
      price: pricing.yearly.replace(/[^0-9.]/g, ''),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    featureList: [
      'Zero-based budgeting',
      'Zero-knowledge encryption',
      'No bank connection required',
      'Multi-currency with live exchange rates',
      'Offline support',
      'Works worldwide',
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
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-600/30 text-green-700 bg-green-50"
                >
                  <Shield className="w-3.5 h-3.5 mr-2" />
                  No Bank Connection Required
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  PocketGuard Alternative
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    Budget without handing your bank credentials to a third party
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  PocketGuard requires Plaid to connect your bank accounts and track spending.
                  Budgero takes a fundamentally different approach: manual-first, zero-knowledge
                  encrypted, with no aggregators touching your data.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=pocketguard-alternative&utm_content=hero">
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
                  Why Switch from PocketGuard?
                </h2>
                <p className="text-lg text-foreground/70">
                  PocketGuard tracks spending after the fact. Budgero helps you plan every dollar
                  before you spend it.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dde9df] flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-[#2f6246]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    No Bank Credentials Shared
                  </h3>
                  <p className="text-foreground/70">
                    PocketGuard requires Plaid to access your bank accounts. Budgero never asks for
                    your bank login. You enter transactions manually or import them from CSV/PDF
                    files you download yourself.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#e4dff0] flex items-center justify-center mb-4">
                    <Lock className="w-6 h-6 text-[#564176]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Zero-Knowledge Encryption
                  </h3>
                  <p className="text-foreground/70">
                    PocketGuard stores your financial data on their servers with standard encryption.
                    Budgero encrypts everything client-side with AES-256-GCM before it leaves your
                    device. We literally cannot see your finances.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#dfe4ec] flex items-center justify-center mb-4">
                    <Target className="w-6 h-6 text-[#314258]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Zero-Based Method
                  </h3>
                  <p className="text-foreground/70">
                    PocketGuard tracks spending after the fact and shows what&apos;s left &quot;in
                    your pocket.&quot; Budgero uses zero-based budgeting: every dollar gets a job
                    before you spend it, giving you full control over your money.
                  </p>
                </div>

                <div className="bg-card rounded-xl p-6 border border-border/70">
                  <div className="w-12 h-12 rounded-full bg-[#efe4d8] flex items-center justify-center mb-4">
                    <Globe className="w-6 h-6 text-[#8a5730]" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">
                    Works Worldwide
                  </h3>
                  <p className="text-foreground/70">
                    PocketGuard is focused on the US and Canada with limited international support.
                    Budgero works in 168 currencies with live exchange rates and automatic
                    conversion, so you can budget from anywhere in the world.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero vs PocketGuard
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
                        PocketGuard
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
                          {typeof row.pocketguard === 'boolean' ? (
                            <div className="flex flex-col items-center gap-1">
                              {row.pocketguard ? (
                                <Check className="w-5 h-5 text-green-600" />
                              ) : (
                                <X className="w-5 h-5 text-foreground/35" />
                              )}
                              {row.pocketguardNote && (
                                <span className="text-xs text-foreground/55">{row.pocketguardNote}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm text-foreground/65">
                                {row.pocketguard}
                              </span>
                              {row.pocketguardNote && (
                                <span className="text-xs text-foreground/55">{row.pocketguardNote}</span>
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

            {/* Where PocketGuard Wins */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                  Where PocketGuard Wins
                </h2>
                <p className="text-lg text-foreground/75 mb-6">
                  PocketGuard is a solid app for people who want hands-off spending tracking. Here
                  is where it genuinely does better:
                </p>
                <ul className="space-y-4 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Automatic spending tracking:</strong>{' '}
                      If you are OK with bank sync, PocketGuard pulls transactions automatically and
                      categorizes them. No manual entry needed.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">
                        &quot;In My Pocket&quot; feature:
                      </strong>{' '}
                      PocketGuard&apos;s signature feature shows you exactly how much you can safely
                      spend after accounting for bills, goals, and necessities. It is genuinely
                      useful for quick spending decisions.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">
                        Simpler for passive users:
                      </strong>{' '}
                      If you do not want to enter transactions or assign categories manually,
                      PocketGuard&apos;s automated approach requires less effort. Budgero is built
                      for people who want active control over their budget.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Switch / Stick Grid */}
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
                      <span>You do not want to share bank credentials with third parties</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You want zero-knowledge encryption for your financial data</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You prefer proactive budgeting over passive spending tracking</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You manage money in multiple currencies or live outside the US</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>You need shared budgets for your household</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>
                        You want a{' '}
                        <a href="/self-hostable" className="underline">
                          self-host option
                        </a>{' '}
                        with full features for free
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Stick with PocketGuard if:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You prefer fully automatic bank sync over manual transaction entry</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        You rely on the &quot;In My Pocket&quot; feature for quick spending
                        decisions
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You only use USD and live in the US or Canada</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>You want a passive spending tracker rather than a proactive budgeting tool</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            <TestimonialsSection />

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Final CTA */}
            <section className="py-20 text-center">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Ready to switch from PocketGuard?
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Try Budgero free for 35 days. Zero-based budgeting, zero-knowledge encryption, and
                  no bank connection required.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=pocketguard-alternative&utm_content=final">
                      Start Free Trial
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  No credit card required. Want all features for free?{' '}
                  <a
                    href="/self-hostable"
                    className="underline hover:text-foreground"
                  >
                    Self-host Budgero
                  </a>{' '}
                  on your own infrastructure.
                </p>
                <p className="mt-3 text-sm text-foreground/60">
                  Weighing your options? Compare the{' '}
                  <a
                    href="/best-ynab-alternatives"
                    className="underline hover:text-foreground"
                  >
                    top budgeting apps
                  </a>{' '}
                  side by side.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
