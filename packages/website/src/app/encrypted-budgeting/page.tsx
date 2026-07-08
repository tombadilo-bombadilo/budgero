import type { Metadata } from 'next';
import { ArrowRight, Check, X, Lock, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Zero-Knowledge Encrypted Budgeting App | Budgero',
  description:
    'Budgero encrypts your financial data on your device before sync using AES-256-GCM. We cannot read your budget. Zero-knowledge privacy by design.',
  keywords: [
    'encrypted budgeting app',
    'private budgeting app',
    'zero knowledge budgeting',
    'budgeting app privacy',
    'secure budget app',
    'encrypted finance app',
    'private finance tracker',
    'zero knowledge encryption budget',
  ],
  alternates: { canonical: 'https://budgero.app/encrypted-budgeting' },
  openGraph: {
    title: 'Zero-Knowledge Encrypted Budgeting App | Budgero',
    description:
      'Budgero encrypts your financial data on your device before sync using AES-256-GCM. We cannot read your budget.',
    url: 'https://budgero.app/encrypted-budgeting',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zero-Knowledge Encrypted Budgeting App | Budgero',
    description: 'Your budget is encrypted before it leaves your device. We cannot read it.',
  },
};

const privacyComparison = [
  {
    feature: 'Data encrypted at rest on server',
    budgero: 'Zero-knowledge',
    ynab: 'Standard',
    monarch: 'Standard',
  },
  {
    feature: 'Provider can read your data',
    budgero: false,
    ynab: true,
    monarch: true,
  },
  {
    feature: 'Encryption method',
    budgero: 'AES-256-GCM (client-side)',
    ynab: 'TLS + server-side',
    monarch: 'TLS + server-side',
  },
  {
    feature: 'Bank connection required',
    budgero: false,
    ynab: false,
    monarch: true,
    budgeroNote: 'By design',
    ynabNote: 'Optional',
  },
  {
    feature: 'Self-host option',
    budgero: true,
    ynab: false,
    monarch: false,
  },
];

export default function EncryptedBudgetingPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    image: 'https://budgero.app/logo_512.png',
    name: 'Budgero',
    applicationCategory: 'FinanceApplication',
    operatingSystem: ['Web', 'Windows', 'macOS', 'Linux'],
    url: 'https://budgero.app/encrypted-budgeting',
    description:
      'Zero-knowledge encrypted budgeting app. Data is encrypted on-device with AES-256-GCM before sync.',
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
        name: 'Budgero Cloud (yearly)',
        price: pricing.yearly.replace(/[^0-9.]/g, ''),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
    ],
    featureList: [
      'Zero-knowledge encryption (AES-256-GCM)',
      'Client-side encryption before sync',
      'Self-host option',
      'No bank connections required',
      'Multi-currency support',
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
                  <Lock className="w-3.5 h-3.5 mr-2" />
                  Zero-Knowledge Encryption
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  Your Budget is None of Our Business
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    Zero-knowledge encrypted budgeting
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Most encrypted budgeting apps store your data in plaintext on their servers.
                  Budgero encrypts everything on your device before it ever leaves. We cannot read
                  your budget, your transactions, or your account names.
                </p>

                <Button
                  asChild
                  size="lg"
                  className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=encrypted-budgeting&utm_content=hero">
                    Start Free Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                </Button>

                <p className="mt-4 text-sm text-foreground/60">
                  35 days free. No credit card. Encrypted from day one.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* What Zero-Knowledge Means */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                  What Zero-Knowledge Means
                </h2>
                <ul className="space-y-4 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Your data is encrypted with a key derived from your master password. We never
                      see this password.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Encryption happens in your browser or app before data is sent to our servers.
                      We receive ciphertext, not your finances.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      We store encrypted blobs. We cannot decrypt them. We do not have your key. Our
                      engineers cannot look up your transactions.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>
                      If you forget your master password, we cannot recover your data. That is the
                      trade-off, and it is intentional.
                    </span>
                  </li>
                </ul>
                <p className="mt-6 text-sm text-foreground/55">
                  This is not marketing speak. This is how the system is architected.
                </p>
                <p className="mt-4 text-sm text-foreground/55">
                  One honest carve-out: during your 35-day trial we record event-kind counters
                  (e.g., that you reconciled an account today) to power the rewards system. No
                  amounts, payees, or category names — just the kind of action and the day it
                  happened. Turn it off any time in Settings → Privacy.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* How It Works */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  How It Works
                </h2>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="bg-card rounded-xl p-6 border border-border/70 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <span className="text-xl font-bold text-foreground">1</span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">You Enter Data</h3>
                  <p className="text-sm text-foreground/70">
                    Transactions, accounts, budgets. All entered in your browser or app on your
                    device.
                  </p>
                </div>
                <div className="bg-card rounded-xl p-6 border border-border/70 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <span className="text-xl font-bold text-foreground">2</span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Your Device Encrypts</h3>
                  <p className="text-sm text-foreground/70">
                    AES-256-GCM encryption runs client-side using a key derived from your master
                    password. Data is encrypted before it touches the network.
                  </p>
                </div>
                <div className="bg-card rounded-xl p-6 border border-border/70 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <span className="text-xl font-bold text-foreground">3</span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">We Store Ciphertext</h3>
                  <p className="text-sm text-foreground/70">
                    Our servers receive and store encrypted blobs. We sync them across your devices.
                    We cannot read them.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why This Matters */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why This Matters
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Your budget contains some of the most sensitive data about your life. Income,
                  spending habits, debts, savings goals. It paints a complete picture of your
                  financial situation, your priorities, and your vulnerabilities.
                </p>
                <p>
                  Most budgeting apps can access this data. They use it for features like AI
                  categorization and analytics. Some share anonymized data with partners. Even apps
                  that advertise &quot;bank-level encryption&quot; encrypt data in transit but store
                  it decrypted on their servers. Their employees can access it. A breach exposes
                  everything.
                </p>
                <p>
                  Zero-knowledge encryption means there is nothing useful to breach. Even if our
                  servers were compromised, attackers would get encrypted data they cannot read
                  without your master password. The encryption key never leaves your device.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Privacy Comparison */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Privacy Compared
                </h2>
                <p className="text-lg text-foreground/70">
                  How budgeting apps handle your data
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
                        Budgero
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        YNAB
                      </th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                        Monarch
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {privacyComparison.map((row, index) => (
                      <tr
                        key={row.feature}
                        className={index % 2 === 0 ? 'bg-transparent' : 'bg-muted/25'}
                      >
                        <td className="px-4 py-4 text-sm font-medium text-foreground">
                          {row.feature}
                        </td>
                        {(['budgero', 'ynab', 'monarch'] as const).map((col) => {
                          const val = row[col];
                          const note = (row as Record<string, unknown>)[`${col}Note`] as
                            | string
                            | undefined;
                          return (
                            <td key={col} className="px-4 py-4 text-center">
                              {typeof val === 'boolean' ? (
                                <div className="flex flex-col items-center gap-1">
                                  {val ? (
                                    <Check className="w-5 h-5 text-green-600" />
                                  ) : (
                                    <X className="w-5 h-5 text-foreground/35" />
                                  )}
                                  {note && (
                                    <span className="text-xs text-foreground/55">{note}</span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <span
                                    className={`text-sm ${col === 'budgero' ? 'font-medium text-[#2f6246]' : 'text-foreground/65'}`}
                                  >
                                    {val}
                                  </span>
                                  {note && (
                                    <span className="text-xs text-foreground/55">{note}</span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* The Trade-off */}
            <section className="py-16 max-w-3xl mx-auto">
              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
                  The Trade-off
                </h2>
                <p className="text-lg text-foreground/75 mb-6">
                  Zero-knowledge encryption is not free. Here&apos;s what you give up.
                </p>
                <ul className="space-y-4 text-foreground/75">
                  <li className="flex items-start gap-3">
                    <EyeOff className="w-5 h-5 text-foreground/45 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">No automatic bank sync.</strong> Your bank
                      would need to send data through us, which would break zero-knowledge.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <EyeOff className="w-5 h-5 text-foreground/45 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">
                        No server-side AI categorization.
                      </strong>{' '}
                      We cannot read your transactions to categorize them. Budgero uses local
                      autofill rules and smart payees instead.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <EyeOff className="w-5 h-5 text-foreground/45 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Password recovery is impossible.</strong>{' '}
                      We do not have your encryption key. If you lose your master password, your data
                      is gone.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <EyeOff className="w-5 h-5 text-foreground/45 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong className="text-foreground">Manual entry required.</strong> Budgero has
                      autofill rules and smart payees to make this fast, but you do enter
                      transactions yourself.
                    </span>
                  </li>
                </ul>
                <p className="mt-6 text-sm text-foreground/55">
                  These are intentional design decisions, not missing features. Every budgeting app
                  chooses a point on the convenience-privacy spectrum. Budgero sits at the privacy
                  end.
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            <TestimonialsSection />

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Final CTA */}
            <section className="py-20 text-center">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Try zero-knowledge budgeting free for 35 days
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  No credit card required. Your data is encrypted from the moment you create your
                  first transaction.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                >
                  <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=encrypted-budgeting&utm_content=final">
                    Start Free Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                </Button>
                <p className="mt-6 text-sm text-foreground/60">
                  Want full control?{' '}
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
