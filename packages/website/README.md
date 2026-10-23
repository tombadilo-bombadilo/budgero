# `@budgero/website`

Marketing website for Budgero — a Next.js 15 static site with blog, docs, and landing pages.

> Part of the Budgero monorepo. **Open source** under [AGPL-3.0](../../LICENSE).

## Stack

- **Framework**: Next.js 15 (App Router)
- **Content**: MDX blog posts and guides via Contentlayer
- **Styling**: TailwindCSS
- **Deployment**: Static export

## Content

| Type | Location |
|---|---|
| Blog posts | `content/blog/*.mdx` |
| Docs/guides | `content/docs/*.mdx` |
| Changelog | `src/lib/changelog-data.ts` |
| Landing pages | `src/app/*/page.tsx` |

## Development

```bash
# From repo root
pnpm run dev:website    # Next.js dev server (port 3000)
pnpm run build:website  # Static export
```

## Homepage Trial Funnel

The homepage implementation is labeled `trial-focused-v1`. In Umami, use the
ordered events `Homepage Viewed` → `Trial CTA Clicked` → `Signup Viewed` →
`Trial Started`. Homepage and CTA events include the variant; CTA events also
include placement. Signup includes only allowlisted homepage campaign query values.
Existing `CTA Clicked - Cloud` and `Cloud Trial - Header` events remain for
historical comparisons.

The report gallery records `Report Preview Selected` and `Report Preview Enlarged`
with a public report ID and the homepage variant. Its trial link uses the `reports`
placement, which the Cloud signup event also preserves. Gallery events measure
interest in the product examples; they are not steps in the trial funnel.

The website and Cloud app use the same Umami website ID and `/stats/api/send`
proxy. After deploying both, verify a signup journey in Umami before relying on
cross-domain funnel percentages. IP/browser changes and session expiry can split a
journey. PostHog receives the same event names, cookieless (memory persistence, a
fresh anonymous id per page load) and not at all when the browser sends GPC/DNT.
Production-host checks exclude local Umami funnel events and website custom events.

The `/stats` proxy forwards the visitor's Cloudflare headers (`cf-connecting-ip`,
`cf-ipcountry`) to Umami, which uses them for the IP hash and country. Its upstream
must therefore not be behind Cloudflare itself — a second Cloudflare hop rewrites
those headers to the web server's own IP, and every visitor shows up in the
server's country. Production builds set the `UMAMI_ORIGIN` build arg to Umami's
internal address (e.g. `http://umami:3000` on the shared `dokploy-network`);
without it the proxy falls back to `https://stats.budgero.app`.

`Trial Started` retains its existing meaning: a newly created backend account
observed during app startup within 15 minutes of account creation, deduplicated
per device. It does not mean the user created or funded a budget. Compare equal
date windows and homepage cohorts; total sitewide trials divided by homepage CTA
clicks is not a valid conversion rate.

Run `pnpm run test:analytics` for delayed-tracker, queue-limit, and provider-failure
checks. App funnel URL filtering has separate tests in
`packages/app/src/shared/lib/analytics/umami.test.ts`.

## Publishing Content

### Blog Posts

1. Create `content/blog/my-post.mdx` with frontmatter:
   ```yaml
   ---
   title: "My Post"
   date: "2026-05-28"
   author: "Your Name"
   ---
   ```
2. Add an excerpt to `src/lib/blog-data.ts`
3. Build — the post auto-generates at `/blog/my-post`

### Docs/Guides

1. Create `content/docs/my-guide.mdx` with frontmatter:
   ```yaml
   ---
   title: "My Guide"
   section: "getting-started"
   topicId: "my-guide"
   takeaways:
     - "Key point 1"
     - "Key point 2"
   published: true
   ---
   ```
2. Build — the guide auto-generates at `/docs/my-guide`

## Adding Changelog Entries

Edit `src/lib/changelog-data.ts` and add a new `ChangelogEntry`:

```ts
{
  version: 'v1.X.Y',
  date: 'Month D, YYYY',
  summary: 'Short description of the release.',
  isLatest: true,  // unset isLatest on previous entry
  items: [
    { type: 'new', title: 'Feature name', description: '...' },
    { type: 'fixed', title: 'Bug fix', description: '...' },
  ],
}
```
