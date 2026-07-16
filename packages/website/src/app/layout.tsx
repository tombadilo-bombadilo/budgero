import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Poppins } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://budgero.app'),
  title: 'Budgero - Zero-Knowledge Budget App with End-to-End Encryption',
  description:
    "Privacy-first budgeting app with zero-knowledge encryption, offline support, and YNAB import. Your financial data stays encrypted - we can't see it. Try zero-based budgeting with AES-256-GCM encryption.",
  keywords: [
    'budgeting app',
    'zero-knowledge encryption',
    'privacy budget app',
    'YNAB alternative',
    'offline budget app',
    'zero-based budgeting',
    'encrypted finance app',
    'personal finance privacy',
    'budget tracking',
    'expense tracking',
  ],
  authors: [{ name: 'Budgero' }],
  robots: { index: true, follow: true },
  alternates: {
    canonical: 'https://budgero.app/',
    types: {
      'application/rss+xml': 'https://budgero.app/feed.xml',
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/logo_192.png', sizes: '192x192', type: 'image/png' },
      { url: '/logo_512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/logo_192.png', sizes: '192x192', type: 'image/png' },
      { url: '/logo_512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  applicationName: 'Budgero',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Budgero' },
  openGraph: {
    type: 'website',
    url: 'https://budgero.app/',
    siteName: 'Budgero',
    title: 'Budgero - Zero-Knowledge Budget App with End-to-End Encryption',
    description:
      "Privacy-first budgeting app with zero-knowledge encryption, offline support, and YNAB import. Your financial data stays encrypted - we can't see it.",
    // Image is auto-emitted by the `opengraph-image.tsx` file convention at the app root
    // (renders a 1200x630 PNG at /opengraph-image). Per-page overrides can drop a sibling
    // opengraph-image.tsx in the route folder, or set openGraph.images explicitly.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Budgero - Zero-Knowledge Budget App with End-to-End Encryption',
    description:
      "Privacy-first budgeting app with zero-knowledge encryption, offline support, and YNAB import. Your financial data stays encrypted - we can't see it.",
    // Twitter image is auto-emitted by `opengraph-image.tsx` (Next 15 reuses it for Twitter).
  },
};

export const viewport: Viewport = {
  themeColor: '#111827',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${poppins.variable} ${ibmPlexMono.variable} font-sans antialiased`}>
        {/* Umami — cookieless, self-hosted, no consent required (no device
            storage). Proxied through /stats (see next.config.ts rewrites) so
            adblockers don't filter the third-party hostname. data-domains
            keeps localhost/preview traffic out of production stats. */}
        <Script
          src="/stats/script.js"
          data-website-id="76a1a09b-2dbc-4291-9c0b-d3f4e9eb2caa"
          data-domains="budgero.app"
          strategy="afterInteractive"
        />
        <Providers>
          <SiteHeader />
          {children}
          <SiteFooter />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Budgero',
              url: 'https://budgero.app/',
              logo: {
                '@type': 'ImageObject',
                url: 'https://budgero.app/logo_512.png',
                width: 512,
                height: 512,
              },
            }) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'Budgero',
              url: 'https://budgero.app/',
              potentialAction: {
                '@type': 'SearchAction',
                target: 'https://budgero.app/?q={search_term_string}',
                'query-input': 'required name=search_term_string',
              },
            }) }}
          />
        </Providers>
      </body>
    </html>
  );
}
