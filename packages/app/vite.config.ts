import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
import { VitePWA } from 'vite-plugin-pwa';
import { createRequire } from 'module';
import { execSync } from 'child_process';

function resolveBuildSha(envSha?: string): string {
  if (envSha) return envSha.trim();
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

const ReactCompilerConfig = {
  // Add any specific configuration for React Compiler here
  // For now, we'll use the default configuration
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = (
    env.VITE_ALLOWED_HOSTS?.split(',')
      .map((host) => host.trim())
      .filter(Boolean) ?? []
  ).concat(['.ts.net']);
  const require = createRequire(import.meta.url);
  const rootPkg = require('../../package.json');
  const baseVersion = env.APP_VERSION || rootPkg.version || '0.0.0';
  const buildSha = resolveBuildSha(env.APP_BUILD_SHA);
  // Image tags stay semver; the SHA rides along in the bundle so the About
  // page and feedback reports pin the exact commit a build came from.
  const appVersion = `${baseVersion}+${buildSha}`;
  const serverHeaders = {
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
  } as const;
  const serverProxy: Record<string, string | ProxyOptions> = {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
  };
  const plugins = [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ];

  const baseManifest = {
    name: 'Budgero - Privacy-First Zero Based Budget Manager',
    short_name: 'Budgero',
    description:
      'Access Budgero securely. Manage your zero-based budget with private, encrypted sync or work offline with Core.',
    theme_color: '#2563eb',
    background_color: '#ffffff',
    display: 'standalone' as const,
    orientation: 'portrait' as const,
    // Use a relative scope/start_url so the PWA
    // automatically matches whatever path the manifest
    // is served from (e.g. "/", "/app/", etc.).
    scope: './',
    start_url: './',
    // Legacy Chromium fallback for launch behavior.
    // launch_handler is the modern field; keep both for wider compatibility.
    capture_links: 'existing-client-navigate' as const,
    launch_handler: {
      client_mode: ['focus-existing' as const, 'navigate-existing' as const, 'auto' as const],
    },
    categories: ['finance', 'productivity', 'utilities'],
    icons: [
      {
        src: 'logo_48.png',
        sizes: '48x48',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_72.png',
        sizes: '72x72',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_96.png',
        sizes: '96x96',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_128.png',
        sizes: '128x128',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_144.png',
        sizes: '144x144',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_384.png',
        sizes: '384x384',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'logo_512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    screenshots: [
      {
        src: '/screenshots/desktop.png',
        sizes: '1920x1080',
        type: 'image/png',
        form_factor: 'wide' as const,
        label: 'Budgero Core Dashboard',
      },
      {
        src: '/screenshots/mobile.png',
        sizes: '1442x3202',
        type: 'image/png',
        form_factor: 'narrow' as const,
        label: 'Budgero Mobile Login',
      },
    ],
    shortcuts: [
      {
        name: 'Add Transaction',
        short_name: 'New transaction',
        description: 'Quickly add a new transaction',
        url: './?intent=new-transaction',
        icons: [
          {
            src: 'shortcut-add-transaction.svg',
            sizes: '96x96',
            type: 'image/svg+xml',
          },
        ],
      },
      {
        name: 'Open Budget',
        short_name: 'Budget',
        description: 'Jump straight to budget planning',
        url: './?intent=open-budget',
        icons: [
          {
            src: 'shortcut-budget.svg',
            sizes: '96x96',
            type: 'image/svg+xml',
          },
        ],
      },
      {
        name: 'View Accounts',
        short_name: 'Accounts',
        description: 'Open your accounts list',
        url: './?intent=open-accounts',
        icons: [
          {
            src: 'shortcut-accounts.svg',
            sizes: '96x96',
            type: 'image/svg+xml',
          },
        ],
      },
    ],
  };
  const manifest = {
    ...baseManifest,
    id: '/',
    scope: '/',
    start_url: '/',
    shortcuts: baseManifest.shortcuts?.map((s) => ({
      ...s,
      url: s.url.replace('./', '/'),
    })),
  };

  plugins.push(
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.png', 'logo_512.png'],
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest,
      workbox: {
        // Keep install/update lightweight. Large WASM assets are cached on-demand.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Screenshots are only for install UX and do not need offline precache.
        globIgnores: ['**/screenshots/*', '**/*_original.png'],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(?!__).*/], // Allow all routes starting with / except /__*
        navigateFallbackDenylist: [/^\/api\//], // Never fallback navigations hitting /api
        runtimeCaching: [
          // Never cache API calls, regardless of origin
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-runtime-assets',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },
    })
  );

  return {
    base: '/',
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_SHA__: JSON.stringify(buildSha),
    },
    publicDir: 'public',
    resolve: {
      alias: {
        '@budgero/core/browser': path.resolve(__dirname, '../core/dist/browser.js'),
        '@budgero/core/types': path.resolve(__dirname, '../core/dist/types'),
        // FSD layer aliases (feature-sliced.design). Order matters:
        // more specific '@layer' entries must precede the catch-all '@'.
        '@app': path.resolve(__dirname, './src/app'),
        '@pages': path.resolve(__dirname, './src/pages'),
        '@widgets': path.resolve(__dirname, './src/widgets'),
        '@features': path.resolve(__dirname, './src/features'),
        '@entities': path.resolve(__dirname, './src/entities'),
        '@shared': path.resolve(__dirname, './src/shared'),
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: serverProxy,
      headers: serverHeaders,
      allowedHosts,
    },
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
      legalComments: 'none',
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'],
    },
    assetsInclude: ['**/*.wasm'],
  };
});
