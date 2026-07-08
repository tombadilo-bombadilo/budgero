# `@budgero/website`

Marketing website for Budgero — a Next.js 15 static site with blog, docs, and landing pages.

> Part of the Budgero monorepo. **Source-available** under [FSL-1.1-ALv2](../../LICENSE).

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
