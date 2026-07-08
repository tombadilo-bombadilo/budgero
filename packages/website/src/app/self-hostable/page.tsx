import type { Metadata } from 'next';
import {
  Server,
  Shield,
  Lock,
  RefreshCw,
  CheckCircle2,
  ArrowRight,
  Cloud,
  Database,
  Globe,
  Key,
  BookOpen,
  Heart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SelfHostInstaller from '@/components/landing/SelfHostInstaller';
import { TrackedLink } from '@/components/TrackedLink';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Self-Hosted Budgeting App — Docker, NAS & Homelab | Budgero',
  description:
    'A self-hosted budgeting app you can run on your own server, NAS, Raspberry Pi, or homelab via Docker. Zero-knowledge encryption, 168 currencies, full feature set — free forever, no license, no feature gating.',
  keywords: [
    'self hosted budgeting app',
    'self hosted budget app',
    'self host budgeting software',
    'self hosted finance app',
    'self hosted budgero',
    'budget app docker',
    'budget app nas',
    'budget app synology',
    'budget app unraid',
    'budget app qnap',
    'budget app raspberry pi',
    'budget app home server',
    'budget app homelab',
    'run your own budget server',
    'privacy budget app',
    'no telemetry budget app',
    'no license budget app',
  ],
  alternates: { canonical: 'https://budgero.app/self-hostable' },
  openGraph: {
    title: 'Self-Hosted Budgeting App — Docker, NAS & Homelab | Budgero',
    description:
      'Run a self-hosted budgeting app on your own server, NAS, or homelab via Docker. Zero-knowledge encryption, 168 currencies, full feature set — free forever.',
    url: 'https://budgero.app/self-hostable',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Self-Hosted Budgeting App — Docker, NAS & Homelab | Budgero',
    description:
      'Run a self-hosted budgeting app on your own server, NAS, or homelab. Zero-knowledge encryption, 168 currencies, full feature set — free forever.',
  },
};

const features = [
  {
    icon: Server,
    title: 'Your Infrastructure',
    description:
      'Run Budgero on your own server, NAS, Raspberry Pi, or any cloud provider you trust.',
  },
  {
    icon: Shield,
    title: 'Zero-Knowledge Encryption',
    description:
      'Your data is encrypted with your master password. Even on your own server, data stays protected.',
  },
  {
    icon: Database,
    title: 'Own Your Data',
    description: 'Complete data ownership. Back up, migrate, or export anytime. No vendor lock-in.',
  },
  {
    icon: Globe,
    title: 'Access Anywhere',
    description: 'Access your budget from any device through your self-hosted instance.',
  },
  {
    icon: Lock,
    title: 'No Third Parties',
    description: 'Your financial data never touches external servers. Complete privacy by design.',
  },
  {
    icon: RefreshCw,
    title: 'Import from YNAB',
    description:
      'Easily import your existing YNAB budget. Keep your categories, transactions, and history.',
  },
];

const whySelfHost = [
  'Full feature parity with Budgero Cloud',
  'Run on your home server, NAS, or VPS',
  'Maximum control, zero vendor lock-in',
  'Air-gapped deployment option',
  'You manage updates and backups',
  'You handle security and uptime',
];

const faqs = [
  {
    q: 'What hardware do I need to self-host Budgero?',
    a: "Anything that runs Docker. A Raspberry Pi 4 (4GB+) is enough for a single user. A NAS, a small home server, or a $5/month VPS will comfortably handle a household. Budgero is a small Go binary and a SQLite-backed database — there is no Postgres, no Redis, no message queue, no Java. Resource use stays under 200MB of RAM in normal operation.",
  },
  {
    q: 'Can I run Budgero on a Synology, Unraid, or QNAP NAS?',
    a: "Yes. Synology DSM, Unraid, QNAP Container Station, and TrueNAS all run the official Budgero Docker image without modification. You point a single port at the container, mount a persistent volume for the SQLite database, and you are done. The full setup guide covers the NAS-specific paths.",
  },
  {
    q: 'Does self-hosted Budgero work on a Raspberry Pi?',
    a: "Yes — Budgero ships multi-arch Docker images (linux/amd64 and linux/arm64), so a Raspberry Pi 4 or 5 works out of the box. A Pi Zero 2 W will technically run it, but for responsiveness a Pi 4 is recommended.",
  },
  {
    q: 'Does Budgero need HTTPS?',
    a: "Yes — for any deployment beyond localhost, Budgero needs to be served over HTTPS. The zero-knowledge encryption runs in the browser via the Web Crypto API (window.crypto.subtle), which browsers only expose in secure contexts (HTTPS, or http://localhost). For LAN-wide or remote access the easiest path is a reverse proxy with automatic Let's Encrypt — Caddy is the simplest, Traefik and Nginx Proxy Manager also work well. If you'd rather skip certs entirely, Tailscale (HTTPS MagicDNS) and Cloudflare Tunnel both terminate TLS for you and require no port forwarding.",
  },
  {
    q: 'How do I back up my self-hosted Budgero data?',
    a: "All data lives in a single SQLite file inside the volume you mounted. Snapshot the volume, copy the file with `docker cp`, or use any standard SQLite backup tool. Because Budgero is end-to-end encrypted on the device, even if you store backups in third-party cloud storage, the contents stay encrypted under your master password.",
  },
  {
    q: 'How do updates work for self-hosted Budgero?',
    a: "Pull the latest Docker image and restart the container. Database migrations run automatically on startup. You decide when to upgrade — the running container will keep working on the version you deployed for as long as you want. The Self-Hostable changelog is published alongside Cloud releases.",
  },
  {
    q: 'Can I run Budgero air-gapped (fully offline)?',
    a: "Yes. Budgero does not phone home. There is no telemetry, no license check, no analytics. The only optional outbound calls are to currencylayer.com for currency exchange rates — you bring your own API key (free tier available) or disable FX entirely. You can run Budgero on a fully isolated network indefinitely.",
  },
  {
    q: 'How do I import my YNAB data into self-hosted Budgero?',
    a: "Export your YNAB budget as CSV and use the import flow inside Budgero. Categories, transactions, and account structure come across. The import preview lets you confirm before anything is written, so you can iterate until the mapping is right.",
  },
  {
    q: 'What about authentication and multi-user access?',
    a: "Self-hosted Budgero handles authentication locally. You create accounts directly on your instance, and each user has their own encrypted workspace. For households, you can run a shared instance and invite household members. There is no SSO out of the box, but the auth layer is designed so you can put it behind your own reverse proxy (Authelia, Authentik, Tailscale) if you want.",
  },
  {
    q: 'Is Budgero open source?',
    a: "No — Budgero is closed-source. We are a small commercial project funded by the Cloud edition. What self-hosters do get is a free Docker image with the full feature set, no license keys, no feature gating, and no telemetry. The binaries are free to use forever and you have full operational control over your instance. We have publicly committed to open-sourcing the codebase if Budgero ever shuts down, so your ability to keep running it doesn't depend on our continued operation.",
  },
];

export default function SelfHostablePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        image: 'https://budgero.app/logo_512.png',
        name: 'Budgero Self-Hosted',
        applicationCategory: 'FinanceApplication',
        operatingSystem: ['Windows', 'macOS', 'Linux', 'Docker'],
        url: 'https://budgero.app/self-hostable',
        downloadUrl: 'https://budgero.app/self-hostable',
        description:
          'Self-hosted budgeting application with zero-knowledge encryption. Run on your own infrastructure via Docker — NAS, Raspberry Pi, homelab, or VPS.',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          priceValidUntil: '2026-12-31',
        },
        featureList: [
          'Self-hosted deployment',
          'Zero-knowledge encryption',
          'Complete data ownership',
          'Docker support (linux/amd64, linux/arm64)',
          'NAS, Raspberry Pi, homelab, VPS friendly',
          'Air-gapped deployment',
          'YNAB import',
          'Multi-currency (168)',
          'Cross-platform (Windows, macOS, Linux)',
        ],
        softwareVersion: '1.4.11',
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
            name: 'Self-Hosted Budgeting App',
            item: 'https://budgero.app/self-hostable',
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
            {/* Hero Section */}
            <section className="pt-24 pb-16 md:pt-32 md:pb-20 text-center">
              <div className="max-w-4xl mx-auto">
                <Badge
                  variant="outline"
                  className="mb-6 px-4 py-1.5 text-sm font-medium border-[#111c34]/30 text-[#111c34] bg-[#111c34]/10"
                >
                  <Server className="w-3.5 h-3.5 mr-2" />
                  Self-Hostable
                </Badge>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                  The Self-Hosted Budgeting App
                  <span className="block text-2xl md:text-3xl mt-2 text-foreground/70 font-medium">
                    Run Budgero on your own server, NAS, or homelab. Free forever. No license,
                    no feature gating.
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-foreground/70 mb-6 max-w-2xl mx-auto leading-relaxed">
                  <strong>Same engine. Same features. Same sync.</strong>
                </p>

                <p className="text-base text-foreground/60 mb-10 max-w-xl mx-auto">
                  No telemetry. No data leaves your server.
                </p>

                {/* Install Command */}
                <SelfHostInstaller />

                {/* Setup Guide Link */}
                <p className="mt-6 text-sm text-foreground/60">
                  Need help?{' '}
                  <TrackedLink
                    href="/docs/self-hosting-guide"
                    event="Self-Host - Setup Guide (Hero)"
                    className="inline-flex items-center gap-1 text-foreground hover:underline font-medium"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Read the full setup guide
                  </TrackedLink>
                </p>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Why Self-Host Section */}
            <section className="py-16 max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Why Self-Host?
                </h2>
                <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
                  Maximum privacy and control over your financial data.
                </p>
              </div>

              <div className="bg-muted/25 rounded-2xl p-8 border border-border/70">
                <ul className="grid md:grid-cols-2 gap-4">
                  {whySelfHost.map((item, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-foreground/80">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Self-host vs Cloud comparison note */}
              <div className="mt-8 p-6 bg-muted/35 rounded-xl border border-border/70">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-[#d7dbe2] flex items-center justify-center flex-shrink-0">
                    <Key className="w-5 h-5 text-[#3f4756]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">
                      What You Take On
                    </h3>
                    <p className="text-sm text-foreground/70 mb-3">
                      Same product, different responsibilities:
                    </p>
                    <ul className="text-sm text-foreground/70 space-y-1">
                      <li>
                        &#8226; <strong>Authentication:</strong> You manage users locally
                      </li>
                      <li>
                        &#8226; <strong>Infrastructure:</strong> You handle servers, uptime, backups
                      </li>
                      <li>
                        &#8226; <strong>Updates:</strong> You apply security patches and upgrades
                      </li>
                      <li>
                        &#8226; <strong>API keys:</strong> You provide your own for currency
                        conversion
                      </li>
                    </ul>
                    <TrackedLink
                      href="/docs/self-hosting-guide"
                      event="Self-Host - Setup Guide (What You Take On)"
                      className="inline-flex items-center gap-1.5 mt-4 text-sm text-foreground hover:underline font-medium"
                    >
                      <BookOpen className="w-4 h-4" />
                      View the complete setup guide
                      <ArrowRight className="w-3 h-3" />
                    </TrackedLink>
                  </div>
                </div>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Features Grid */}
            <section className="py-16">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                  Full-Featured Self-Hosting
                </h2>
                <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
                  Everything from Budgero Cloud, running on your terms.
                </p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                {features.map((feature, index) => (
                  <div
                    key={index}
                    className="bg-card rounded-xl p-6 border border-border/70 hover:border-border transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#d7dbe2] flex items-center justify-center mb-4">
                      <feature.icon className="w-5 h-5 text-[#3f4756]" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-foreground/70 text-sm leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* FAQ */}
            <section className="py-16 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-10">
                Self-Hosting FAQ
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

            {/* Donations */}
            <section className="py-12 max-w-2xl mx-auto text-center">
              <div className="mx-auto mb-4 w-10 h-10 rounded-lg bg-[#d7dbe2] flex items-center justify-center">
                <Heart className="w-5 h-5 text-[#3f4756]" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
                Free forever — donations welcome
              </h2>
              <p className="text-foreground/70 mb-6 leading-relaxed">
                Self-Host has no license, no feature gates, and never will. If it earns a place
                in your homelab, you can support development with a one-time, pay-what-you-want
                donation.
              </p>
              <TrackedLink
                href="/donate"
                event="Self-Host - Donate"
                className="inline-flex items-center gap-2 font-medium text-foreground hover:underline"
              >
                <Heart className="w-4 h-4" />
                Support Budgero
                <ArrowRight className="w-3.5 h-3.5" />
              </TrackedLink>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Related comparisons — internal linking to consolidate topical authority */}
            <section className="py-16 max-w-4xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
                Related comparisons
              </h2>
              <p className="text-foreground/65 mb-8">
                If you're evaluating self-host because you outgrew another budgeting app, these
                comparisons might help.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <a
                  href="/self-hosted-ynab-alternative"
                  className="rounded-xl border border-border/70 bg-card p-5 hover:border-foreground/30 transition-colors"
                >
                  <h3 className="font-semibold text-foreground mb-1">Self-Hosted YNAB Alternative</h3>
                  <p className="text-sm text-foreground/65">
                    YNAB-specific comparison — feature parity, import path, and what you give up
                    by leaving the YNAB cloud.
                  </p>
                </a>
                <a
                  href="/vs-ynab"
                  className="rounded-xl border border-border/70 bg-card p-5 hover:border-foreground/30 transition-colors"
                >
                  <h3 className="font-semibold text-foreground mb-1">Budgero vs YNAB</h3>
                  <p className="text-sm text-foreground/65">
                    Side-by-side feature comparison: privacy, multi-currency, offline mode, and
                    pricing across both products.
                  </p>
                </a>
                <a
                  href="/monarch-money-alternative"
                  className="rounded-xl border border-border/70 bg-card p-5 hover:border-foreground/30 transition-colors"
                >
                  <h3 className="font-semibold text-foreground mb-1">Monarch Money Alternative</h3>
                  <p className="text-sm text-foreground/65">
                    For people leaving Monarch — multi-currency, works outside the US, and
                    zero-knowledge encryption that Monarch doesn&apos;t offer.
                  </p>
                </a>
                <a
                  href="/best-ynab-alternatives"
                  className="rounded-xl border border-border/70 bg-card p-5 hover:border-foreground/30 transition-colors"
                >
                  <h3 className="font-semibold text-foreground mb-1">Best YNAB Alternatives in 2026</h3>
                  <p className="text-sm text-foreground/65">
                    Six budgeting apps compared on price, privacy, multi-currency, and
                    self-hosting (including Actual Budget and Firefly III).
                  </p>
                </a>
              </div>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Browser Alternative Section */}
            <section className="py-16 max-w-3xl mx-auto text-center">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
                Prefer Managed Cloud?
              </h2>
              <p className="text-lg text-foreground/70 mb-8">
                If you prefer zero setup, start with Budgero Cloud and get encrypted sync right
                away.
              </p>
              <Button
                asChild
                size="lg"
                className="h-12 px-6 bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b]"
              >
                <TrackedLink
                  href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=self-hostable&utm_content=cloud-trial"
                  event="Self-Host - Cloud Trial"
                  external
                >
                  Start Cloud Trial
                  <ArrowRight className="w-4 h-4 ml-2" />
                </TrackedLink>
              </Button>
            </section>

            <div className="my-12 border-t border-border" aria-hidden />

            {/* Cloud Alternative - calm anchor */}
            <section className="py-12 max-w-2xl mx-auto text-center">
              <p className="text-foreground/70">
                Prefer zero setup?{' '}
                <TrackedLink
                  href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=self-hostable&utm_content=cloud-inline"
                  event="Self-Host - Cloud CTA"
                  external
                  className="text-foreground hover:underline font-medium"
                >
                  Budgero Cloud
                </TrackedLink>{' '}
                handles infrastructure, backups, and updates for you.
              </p>
              <p className="mt-4 text-sm text-foreground/60">
                Coming from YNAB?{' '}
                <a
                  href="/self-hosted-ynab-alternative"
                  className="underline hover:text-foreground"
                >
                  See the self-hosted YNAB alternative comparison
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
