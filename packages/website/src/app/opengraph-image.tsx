import { ImageResponse } from 'next/og';

// Site-wide default OG image. Next 15 file-convention: this auto-emits a 1200x630 PNG
// at /opengraph-image and is wired into the metadata of every page that doesn't override.
// Per-page override: drop a sibling opengraph-image.tsx in the route folder (or set
// `openGraph.images` explicitly in that page's metadata).

export const runtime = 'edge';
export const alt = 'Budgero — Private budgeting without bank connections.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Brand palette (sourced from src/app/globals.css)
const COLORS = {
  background: '#fbf7eb', // --background (warm cream)
  foreground: '#141414', // --foreground (near-black)
  accent: '#ebe7dc', // --accent (deeper cream, for subtle dividers)
  muted: '#3f4756', // muted body text
  subtle: '#5a6373', // metadata text
  divider: '#9ca3af',
  ctaBg: '#111c34', // brand navy used for buttons
  ctaText: '#fbf7eb',
};

export default async function OgImage() {
  // Embed the real logo asset — packages/website/public/logo_512.png (512×512 logomark)
  const logoData = await fetch(
    new URL('../../public/logo_512.png', import.meta.url)
  ).then((res) => res.arrayBuffer());
  const logoSrc = `data:image/png;base64,${Buffer.from(logoData).toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          background: COLORS.background,
          color: COLORS.foreground,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Top: brand lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={64} height={64} alt="" style={{ display: 'block' }} />
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: -0.5,
              color: COLORS.foreground,
            }}
          >
            Budgero
          </div>
        </div>

        {/* Center: exact homepage H1 + subhead */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.06,
              letterSpacing: -1.6,
              color: COLORS.foreground,
              maxWidth: 980,
            }}
          >
            Private budgeting without bank connections.
          </div>
          <div
            style={{
              fontSize: 26,
              color: COLORS.muted,
              lineHeight: 1.4,
              maxWidth: 920,
            }}
          >
            Zero-knowledge encryption · 168 currencies · 35-day cardless trial — or self-host
            for free.
          </div>
        </div>

        {/* Bottom row: meta + CTA pill */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 20,
            color: COLORS.subtle,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontWeight: 600 }}>budgero.app</span>
            <span style={{ color: COLORS.divider }}>·</span>
            <span>YNAB &amp; Monarch alternative</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 22px',
              borderRadius: 999,
              background: COLORS.ctaBg,
              color: COLORS.ctaText,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Try free for 35 days →
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
