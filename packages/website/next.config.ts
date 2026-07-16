import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    // Serve the Umami tracker from our own origin so adblockers don't eat it.
    // Only the script and the ingest endpoint are proxied — never the
    // dashboard/login UI.
    return [
      {
        source: '/stats/script.js',
        destination: 'https://stats.budgero.app/script.js',
      },
      {
        source: '/stats/api/send',
        destination: 'https://stats.budgero.app/api/send',
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/free-ynab-alternative',
        destination: '/vs-ynab',
        permanent: true,
      },
      {
        source: '/budgeting-multiple-currencies',
        destination: '/multi-currency-budgeting',
        permanent: true,
      },
      {
        source: '/blog/budgero-vs-ynab',
        destination: '/vs-ynab',
        permanent: true,
      },
    ];
  },
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    // Silence workspace root warning by pinning root to package dir
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  eslint: {
    // Lint in CI if you want, but don't fail production builds
    ignoreDuringBuilds: true,
  },
  typescript: {
    // We run tsc separately in CI; don't fail Next build on TS issues
    ignoreBuildErrors: true,
  },
};
export default nextConfig;
