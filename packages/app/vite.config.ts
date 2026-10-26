import { defineConfig, loadEnv, normalizePath, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
import { VitePWA } from 'vite-plugin-pwa';
import { createRequire } from 'module';
import { execFileSync, execSync } from 'child_process';

const require = createRequire(import.meta.url);

function compileCatalogs(): void {
  // Invoke the installed CLI with Node, without relying on a package-manager
  // lifecycle hook (direct Vite and container builds bypass those hooks).
  const cli = path.join(path.dirname(require.resolve('@lingui/cli')), 'lingui.js');
  execFileSync(process.execPath, [cli, 'compile', '--strict'], {
    cwd: __dirname,
    stdio: 'inherit',
  });
}

function watchCatalogs(): Plugin {
  const catalogRoot = `${normalizePath(path.join(__dirname, 'src/locales'))}/`;
  return {
    name: 'budgero-lingui-catalogs',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(catalogRoot) || !file.endsWith('.po')) return;
      compileCatalogs();
      // Lingui loads catalogs into its own runtime state, so reload that state
      // after compiling instead of only replacing the generated JS module.
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

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

export default defineConfig(({ mode, isPreview }) => {
  // Catalogs are intentionally gitignored. Generate them before Vite scans the
  // dynamic imports, including the first run in a fresh checkout.
  if (!isPreview) compileCatalogs();
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = (
    env.VITE_ALLOWED_HOSTS?.split(',')
      .map((host) => host.trim())
      .filter(Boolean) ?? []
  ).concat(['.ts.net']);
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
    watchCatalogs(),
    react({
      babel: {
        // Lingui macros must expand before React Compiler sees the tree.
        plugins: [
          '@lingui/babel-plugin-lingui-macro',
          ['babel-plugin-react-compiler', ReactCompilerConfig],
        ],
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
        // Localized artwork is cached as viewed, rather than downloading every language.
        // Screenshots are only for install UX and do not need offline precache.
        globIgnores: ['**/screenshots/*', '**/*_original.png', '**/onboarding/*/*.png'],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(?!__).*/], // Allow all routes starting with / except /__*
        navigateFallbackDenylist: [/^\/api\//], // Never fallback navigations hitting /api
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /^\/onboarding\/(de|fr|es|nl)\/[^/]+\.png$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'onboarding-localized-images',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 28, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
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
      // Dev-server bind address override (e.g. 127.0.0.1 when a local HTTPS
      // proxy like tailscale serve dials IPv4 and the default binds ::1 only).
      host: env.VITE_DEV_HOST || undefined,
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
      // Release builds set APP_SOURCEMAPS=hidden: maps without a
      // sourceMappingURL, uploaded to PostHog and deleted before the image is
      // built (app.Dockerfile). They are never served.
      sourcemap: env.APP_SOURCEMAPS === 'hidden' ? 'hidden' : false,
      emptyOutDir: true,
    },
    optimizeDeps: {
      // Lingui macros are compile-time only — the babel plugin removes them.
      // Pre-bundling them ships a module whose body throws on import, which
      // surfaces as a confusing runtime error if anything ever requests it.
      exclude: ['@sqlite.org/sqlite-wasm', '@lingui/react/macro', '@lingui/core/macro'],
    },
    assetsInclude: ['**/*.wasm'],
  };
});
