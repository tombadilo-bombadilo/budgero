import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, X, Server, Shield, Terminal, Download, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestimonialsSection } from '@/components/landing/Testimonials';
import { pricing } from '@/lib/pricing';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Self-Hosted YNAB Alternative — Docker, NAS, Free | Budgero',
  description:
    'The free, self-hosted YNAB alternative. Zero-based budgeting with 168 currencies and end-to-end encryption, running on your own Docker server. No subscription, no license keys, no feature gating, no telemetry.',
  keywords: [
    'self hosted ynab alternative',
    'self-hosted ynab alternative',
    'ynab alternative docker',
    'ynab alternative self hosted',
    'ynab replacement self hosted',
    'self hosted budgeting app',
    'docker budgeting app',
    'self host budgeting',
    'free ynab alternative',
    'ynab alternative no subscription',
    'ynab alternative no license',
    'ynab alternative no telemetry',
    'private ynab alternative',
  ],
  alternates: { canonical: 'https://budgero.app/self-hosted-ynab-alternative' },
  openGraph: {
    title: 'Self-Hosted YNAB Alternative — Docker, NAS, Free | Budgero',
    description:
      'The free, self-hosted YNAB alternative. Zero-based budgeting with multi-currency support, running on your own Docker server. No subscription, no license keys, no telemetry.',
    url: 'https://budgero.app/self-hosted-ynab-alternative',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Self-Hosted YNAB Alternative — Docker, NAS, Free | Budgero',
    description:
      'Zero-based budgeting. Multi-currency. Your server, your rules. Free forever with Docker.',
  },
};

const comparisonData = [
  {
    feature: 'Where your data lives',
    budgero: 'Your server',
    ynab: 'YNAB servers (US)',
    budgeroNote: 'You control backups, location, retention',
    ynabNote: 'US jurisdiction, their retention',
  },
  {
    feature: 'Price',
    budgero: 'Free forever',
    ynab: '$109/year',
    budgeroNote: 'Pay for your VPS (~€5/mo)',
    ynabNote: null,
  },
  {
    feature: 'Deployment',
    budgero: 'Docker / docker-compose',
    ynab: 'N/A (SaaS only)',
    budgeroNote: 'Single container, 5-minute setup',
    ynabNote: null,
  },
  {
    feature: 'Source code',
    budgero: 'Source-available',
    ynab: 'Closed-source',
    budgeroNote: 'Public source on GitHub (FSL license), free Docker image, no license keys',
    ynabNote: 'SaaS only, no binaries',
  },
  {
    feature: 'Zero-based budgeting',
    budgero: true,
    ynab: true,
    budgeroNote: null,
    ynabNote: null,
  },
  {
    feature: 'Multi-currency',
    budgero: '168 currencies',
    ynab: false,
    budgeroNote: 'Live FX rates, auto conversion',
    ynabNote: 'One currency per budget',
  },
  {
    feature: 'Offline mode',
    budgero: true,
    ynab: false,
    budgeroNote: 'PWA, full offline support',
    ynabNote: 'Requires internet',
  },
  {
    feature: 'End-to-end encryption',
    budgero: true,
    ynab: false,
    budgeroNote: 'Even on your own server',
    ynabNote: 'Plaintext',
  },
  {
    feature: 'YNAB data import',
    budgero: true,
    ynab: 'N/A',
    budgeroNote: 'Full transaction + category history',
    ynabNote: null,
  },
  {
    feature: 'Account ownership when you stop paying',
    budgero: 'N/A — no subscription',
    ynab: false,
    budgeroNote: 'Always yours',
    ynabNote: 'Lose access',
  },
  {
    feature: 'Multi-user / shared budget',
    budgero: true,
    ynab: true,
    budgeroNote: 'Up to 5 users on shared server',
    ynabNote: 'Up to 6 users',
  },
  {
    feature: 'Update cadence',
    budgero: 'You decide',
    ynab: 'YNAB decides',
    budgeroNote: 'docker pull when ready',
    ynabNote: 'Forced updates',
  },
];

const faqs = [
  {
    q: 'Is Budgero open source?',
    a: 'Budgero is source-available, not OSI open source. The full source code is public in a read-only GitHub mirror under the Functional Source License (FSL-1.1-Apache-2.0): you can read, audit, modify, and self-host it — you just can\'t offer it as a competing hosted service, and each release converts to Apache 2.0 two years after publication. Self-hosters get a free Docker image with the full feature set, no license keys, and no feature gating, running on your own infrastructure under your control. Between the public source and the automatic Apache 2.0 conversion, what you run today keeps working regardless of what happens to the company.',
  },
  {
    q: 'How do I self-host Budgero?',
    a: 'Pull the Docker image, copy the example docker-compose.yml, set a few environment variables (database URL, JWT secret, base URL), and docker compose up. Typical setup is under 10 minutes on a fresh VPS. There is a full walkthrough in the self-host documentation.',
  },
  {
    q: 'What hardware do I need to self-host?',
    a: 'Very little. Budgero runs comfortably on any VPS with 1 vCPU and 1 GB of RAM. A €4–€6/month DigitalOcean, Hetzner, or OVH droplet is more than enough for a household. Raspberry Pi 4 also works.',
  },
  {
    q: 'Is the self-hosted version as fully-featured as Cloud?',
    a: 'Yes. Self-host is the same codebase as Cloud. You get zero-based budgeting, 168-currency multi-currency support, end-to-end encryption, offline PWA, YNAB import, shared budgets, AI-powered categorization (bring your own LLM or local Ollama), the push API, and everything else. The only difference is we do not manage the hosting, updates, or backups for you.',
  },
  {
    q: 'What if I want to stop self-hosting later?',
    a: 'Export your data from self-hosted Budgero, then import it directly into Budgero Cloud. There is no lock-in in either direction. Your encrypted SQLite database is yours, in a standard format.',
  },
  {
    q: 'How do backups work?',
    a: "Self-host backups are your responsibility. Budgero's database is a single SQLite file (encrypted end-to-end with your key), so backup is as simple as scheduling a nightly copy to S3, Backblaze B2, or another server. The documentation includes a sample backup script. Because data is encrypted client-side, your backup storage provider cannot see your financial data even if they wanted to.",
  },
  {
    q: 'Can I use a custom domain?',
    a: "Yes. Point your domain at your server, put a reverse proxy (Caddy, Traefik, nginx) in front of Budgero, and you get a TLS-terminated, custom-domain deployment. The documentation has reference configs for Caddy and Traefik.",
  },
  {
    q: 'Will there be updates and new features?',
    a: "Yes. We ship new features continuously to the main branch, and tag stable Docker images. Self-hosters pull the latest image on their own schedule. You will never be forced to update, but you also will not miss out on improvements if you want them.",
  },
  {
    q: 'Can I import my YNAB budget into self-hosted Budgero?',
    a: 'Yes. Budgero ingests YNAB export files directly — categories, transactions, budget groups, accounts, history. Same import flow as Cloud. Takes about 5 minutes.',
  },
  {
    q: 'How does self-hosted Budgero compare to Actual Budget?',
    a: "Actual Budget is the other major self-hosted, open-source YNAB-style app. We like Actual and think it is a great project. The differences most people care about: Budgero supports 168 currencies natively in a single budget with live FX rates (Actual is largely single-currency). Budgero includes end-to-end encryption with zero-knowledge server architecture. Budgero ships a fully managed Cloud option if you ever stop wanting to run servers yourself. If you only need single-currency budgeting on your own box, Actual is a fine choice. If you need multi-currency or want a Cloud fallback, Budgero is the better fit.",
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

export default function SelfHostedYnabAlternativePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        image: 'https://budgero.app/logo_512.png',
        name: 'Budgero Self-Host',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Linux', 'Docker', 'Web'],
        url: 'https://budgero.app/self-hosted-ynab-alternative',
        description:
          'Self-hosted YNAB alternative. Zero-based budgeting with 168-currency multi-currency support and end-to-end encryption, deployed via Docker to your own server. Free forever.',
        offers: [
          {
            '@type': 'Offer',
            name: 'Budgero Self-Host',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            description: 'Run Budgero on your own server with Docker. No subscription.',
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
          'Self-hosted with Docker',
          'Zero-based budgeting',
          '168-currency multi-currency support',
          'End-to-end encryption (AES-256-GCM)',
          'Offline PWA',
          'YNAB import',
          'Shared budgets',
          'Custom-domain deployment',
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
            name: 'Self-Hosted YNAB Alternative',
            item: 'https://budgero.app/self-hosted-ynab-alternative',
          },
        ],
      },
    ],
  };

  const composeSnippet = `services:
  budgero:
    image: ghcr.io/budgero/budgero:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: file:/data/budgero.db
      JWT_SECRET: \${JWT_SECRET}
      PUBLIC_URL: https://budgero.yourdomain.com
    volumes:
      - budgero-data:/data
    restart: unless-stopped

volumes:
  budgero-data:`;

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
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-[#564176]/30 text-[#564176] dark:text-purple-300 bg-[#564176]/10"
                >
                  <Server className="w-3.5 h-3.5 mr-2" />
                  Self-Hosted · Docker · Free Forever
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  The Self-Hosted YNAB Alternative
                  <span className="block text-2xl md:text-3xl mt-3 text-foreground/70 font-medium">
                    Your server. Your data. Zero subscription.
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-8 max-w-2xl mx-auto leading-relaxed">
                  Budgero is a zero-based budgeting app with multi-currency support and end-to-end
                  encryption — available as a single Docker container you run on your own hardware.
                  No subscription. No vendor lock-in. Your financial data never touches a
                  third-party server.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <a href="#deploy">
                      Deploy in 5 Minutes
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=self-hosted-ynab-alternative&utm_content=hero-cloud">
                      Try Cloud First
                    </a>
                  </Button>
                </div>

                <p className="mt-4 text-sm text-foreground/60">
                  Free, forever · Docker · Single container · Import your YNAB budget
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why self-host */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why Self-Host a Budgeting App in 2026?
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  Your budget is one of the most sensitive datasets you have. Every salary, every
                  expense, every debt — a near-complete picture of your life in numbers. Handing
                  that to a SaaS vendor is a decision. Self-hosting is the option to not make it.
                </p>

                <div className="space-y-4">
                  <p>
                    <strong className="text-foreground">No vendor can raise your price.</strong>{' '}
                    YNAB has raised prices multiple times. Mint shut down entirely. Self-hosting is
                    immune to both.
                  </p>
                  <p>
                    <strong className="text-foreground">
                      No vendor can lose access to your budget.
                    </strong>{' '}
                    Cancel YNAB and you lose your data. Mint users got migrated to Credit Karma.
                    Self-hosted Budgero works identically whether we exist or not.
                  </p>
                  <p>
                    <strong className="text-foreground">
                      No vendor can be breached with your data.
                    </strong>{' '}
                    If your budget lives on your own server, a SaaS breach somewhere else does not
                    affect you. (And because Budgero encrypts data client-side, even a breach of
                    your own server yields encrypted blobs.)
                  </p>
                  <p>
                    <strong className="text-foreground">
                      No vendor decides your feature roadmap.
                    </strong>{' '}
                    You update when you want to. You skip features you do not want. You can even
                    fork the code if something really matters to you.
                  </p>
                  <p>
                    <strong className="text-foreground">No ongoing subscription.</strong> You pay
                    for the VPS or hardware. That is it. For many households, self-hosted Budgero
                    costs less than a single month of YNAB — and keeps running forever.
                  </p>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Deploy Section */}
            <section id="deploy" className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <Badge className="mb-4 bg-[#111c34]/10 text-[#111c34] dark:text-slate-200 border-[#111c34]/30">
                  <Terminal className="w-3.5 h-3.5 mr-2" />
                  5-Minute Deploy
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Deploy Budgero in 5 Minutes
                </h2>
                <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
                  If you can run a Docker container, you can self-host Budgero. Here is the whole
                  process.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-lg font-bold text-foreground">1</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1 text-lg">
                      Spin up a server
                    </h3>
                    <p className="text-foreground/70">
                      Any Linux VPS with Docker installed works. A €5/month droplet at Hetzner,
                      DigitalOcean, OVH, or an old Raspberry Pi is plenty.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-lg font-bold text-foreground">2</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1 text-lg">
                      Drop in docker-compose.yml
                    </h3>
                    <p className="text-foreground/70 mb-3">
                      A minimal compose file looks like this:
                    </p>
                    <pre className="bg-[#0f172a] text-[#e2e8f0] rounded-lg p-4 overflow-x-auto text-sm leading-relaxed">
                      <code>{composeSnippet}</code>
                    </pre>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-lg font-bold text-foreground">3</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1 text-lg">
                      Bring it up
                    </h3>
                    <p className="text-foreground/70 mb-3">
                      Run one command:
                    </p>
                    <pre className="bg-[#0f172a] text-[#e2e8f0] rounded-lg p-4 overflow-x-auto text-sm leading-relaxed">
                      <code>docker compose up -d</code>
                    </pre>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-lg font-bold text-foreground">4</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1 text-lg">
                      Point a domain, add TLS
                    </h3>
                    <p className="text-foreground/70">
                      Put Caddy or Traefik in front for automatic HTTPS. The self-host docs include
                      reference configs. This takes two or three minutes.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-lg font-bold text-foreground">5</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1 text-lg">
                      Import your YNAB data
                    </h3>
                    <p className="text-foreground/70">
                      Export your YNAB budget as a ZIP, drop it into the Budgero import dialog, and
                      your full history is now living on your own server. Categories, groups,
                      transactions, and account balances all come across intact.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-10 text-center">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-12 px-7 text-base border-border/80"
                >
                  <Link href="/self-hostable">
                    Read the Full Self-Host Guide
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Comparison Table */}
            <section className="py-16 max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Budgero Self-Host vs. YNAB
                </h2>
                <p className="text-lg text-foreground/70">
                  Feature-by-feature. The tradeoffs of self-hosting, honestly.
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
                  <Link href="/self-hostable">
                    Get the Self-Host Guide
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <span className="text-sm text-foreground/60">
                  Or{' '}
                  <a
                    href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=self-hosted-ynab-alternative&utm_content=mid-table"
                    className="underline hover:text-foreground"
                  >
                    try Cloud free for 35 days
                  </a>
                </span>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why Budgero specifically */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Why Budgero Over Other Self-Hosted Budgeting Apps
              </h2>
              <div className="space-y-6 text-lg text-foreground/75 leading-relaxed">
                <p>
                  If you have been researching self-hosted YNAB alternatives, you have probably
                  found Actual Budget, Firefly III, and a handful of smaller projects. They are
                  good in their own ways. Here is what makes Budgero different.
                </p>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <Package className="w-6 h-6 text-[#2f6246] flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1 text-lg">
                        Multi-currency done right
                      </h3>
                      <p className="text-foreground/75">
                        Most self-hosted budgeting apps are single-currency. Budgero handles 168
                        currencies with live FX rates and a unified home-currency rollup. For
                        expats and multi-country households this is the feature that matters.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <Shield className="w-6 h-6 text-[#2f6246] flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1 text-lg">
                        End-to-end encryption even on your own box
                      </h3>
                      <p className="text-foreground/75">
                        Budgero encrypts data client-side with AES-256-GCM regardless of where
                        the server runs. On your own VPS this means that server compromise or
                        backup leakage yields encrypted blobs, not your financial history.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <Server className="w-6 h-6 text-[#2f6246] flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1 text-lg">
                        Cloud fallback if you ever stop wanting to sysadmin
                      </h3>
                      <p className="text-foreground/75">
                        With Actual or Firefly, if you get tired of running a server, your options
                        are limited. With Budgero, export your data and import it into Budgero
                        Cloud for {pricing.monthly}/month. Same app, same features, fully managed.
                        No lock-in in either direction.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <Terminal className="w-6 h-6 text-[#2f6246] flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1 text-lg">
                        Genuinely simple deploy
                      </h3>
                      <p className="text-foreground/75">
                        Single Docker image. SQLite by default (no external Postgres required). One
                        volume. One port. The minimal docker-compose.yml is about 15 lines. You do
                        not need to understand anything about the app internals to run it.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Who This Is For */}
            <section className="py-16 max-w-4xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-8">
                Should You Self-Host Budgero?
              </h2>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-[#e8f0e8] rounded-2xl p-8 border border-[#bfd7c2]">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <Check className="w-6 h-6 text-green-600" />
                    Self-host if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/80">
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Already run a homelab or personal VPS</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want full control over where your budget data lives</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Prefer paying €5/month for a VPS than ${pricing.monthly.replace(/[^0-9.]/g, '')}/month for SaaS</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want the app to outlive any company</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Are comfortable running Docker and setting up a reverse proxy</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                      <span>Want to be responsible for your own backups</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <X className="w-6 h-6 text-foreground/35" />
                    Try Cloud instead if you:
                  </h3>
                  <ul className="space-y-3 text-foreground/70">
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>Do not want to run servers, period</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Want automated backups, updates, and uptime to be someone else&apos;s job
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Want to try Budgero for 35 days free before committing to anything
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <X className="w-4 h-4 text-foreground/35 mt-1 flex-shrink-0" />
                      <span>
                        Care less about ownership and more about just not having to think about
                        infrastructure
                      </span>
                    </li>
                  </ul>
                  <p className="mt-6 text-sm text-foreground/55">
                    Good news: the app is identical. You can switch between Cloud and Self-Host at
                    any point with a single export/import.
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
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
                >
                  <Download className="w-3.5 h-3.5 mr-2" />
                  Free forever, on your own server
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Budget on your own box.
                </h2>
                <p className="text-lg text-foreground/70 mb-8">
                  Pull the image, start the container, import your YNAB budget. The whole process
                  is under 10 minutes. Your data stays on your server, under your control, forever.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-14 px-8 text-lg bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
                  >
                    <Link href="/self-hostable">
                      Read the Self-Host Guide
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-8 text-lg border-border/80"
                  >
                    <a href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=self-hosted-ynab-alternative&utm_content=final-cloud">
                      Prefer Cloud? Try Free
                    </a>
                  </Button>
                </div>
                <p className="mt-6 text-sm text-foreground/60">
                  Also see:{' '}
                  <Link href="/vs-ynab" className="underline hover:text-foreground">
                    Full Budgero vs YNAB comparison
                  </Link>{' '}
                  ·{' '}
                  <Link
                    href="/ynab-alternative-europe"
                    className="underline hover:text-foreground"
                  >
                    YNAB alternative for Europe
                  </Link>{' '}
                  ·{' '}
                  <Link
                    href="/best-ynab-alternatives"
                    className="underline hover:text-foreground"
                  >
                    Best YNAB alternatives in 2026
                  </Link>{' '}
                  ·{' '}
                  <Link
                    href="/firefly-iii-alternative"
                    className="underline hover:text-foreground"
                  >
                    Firefly III alternative
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
