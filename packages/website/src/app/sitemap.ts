import type { MetadataRoute } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGuides, allPosts } from 'contentlayer/generated';

import { changelogEntries } from '@/lib/changelog-data';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(appDir, '..', '..');

function getFileLastModified(relativePath: string, fallbackIso: string): string {
  try {
    const fullPath = path.resolve(websiteRoot, relativePath);
    return fs.statSync(fullPath).mtime.toISOString();
  } catch {
    return fallbackIso;
  }
}

function normalizeDate(value: string | Date, fallbackIso: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString();
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://budgero.app';
  const now = new Date();
  const nowIso = now.toISOString();

  const publishedGuides = allGuides.filter((guide) => guide.published !== false);

  const routes: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: getFileLastModified('src/app/page.tsx', nowIso),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${base}/self-hostable`,
      lastModified: getFileLastModified('src/app/self-hostable/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/monarch-money-alternative`,
      lastModified: getFileLastModified('src/app/monarch-money-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/privacy`,
      lastModified: getFileLastModified('src/app/privacy/page.tsx', nowIso),
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${base}/vs-ynab`,
      lastModified: getFileLastModified('src/app/vs-ynab/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/ynab-alternative-europe`,
      lastModified: getFileLastModified('src/app/ynab-alternative-europe/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/ynab-alternative-uk`,
      lastModified: getFileLastModified('src/app/ynab-alternative-uk/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/ynab-alternative-australia`,
      lastModified: getFileLastModified('src/app/ynab-alternative-australia/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/monarch-money-multi-currency`,
      lastModified: getFileLastModified('src/app/monarch-money-multi-currency/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/firefly-iii-alternative`,
      lastModified: getFileLastModified('src/app/firefly-iii-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/self-hosted-ynab-alternative`,
      lastModified: getFileLastModified('src/app/self-hosted-ynab-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/monarch-money-europe-alternative`,
      lastModified: getFileLastModified('src/app/monarch-money-europe-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/best-ynab-alternatives`,
      lastModified: getFileLastModified('src/app/best-ynab-alternatives/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/encrypted-budgeting`,
      lastModified: getFileLastModified('src/app/encrypted-budgeting/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/multi-currency-budgeting`,
      lastModified: getFileLastModified('src/app/multi-currency-budgeting/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/zero-based-budgeting`,
      lastModified: getFileLastModified('src/app/zero-based-budgeting/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${base}/everydollar-alternative`,
      lastModified: getFileLastModified('src/app/everydollar-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/goodbudget-alternative`,
      lastModified: getFileLastModified('src/app/goodbudget-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/pocketguard-alternative`,
      lastModified: getFileLastModified('src/app/pocketguard-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/quicken-simplifi-alternative`,
      lastModified: getFileLastModified('src/app/quicken-simplifi-alternative/page.tsx', nowIso),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/docs`,
      lastModified: getFileLastModified('src/app/docs/page.tsx', nowIso),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
  ];

  const posts: MetadataRoute.Sitemap = allPosts
    .filter((post) => !post.draft && post.published !== false)
    .map((post) => ({
      url: `${base}${post.url}`,
      lastModified: normalizeDate(post.updated || post.date, nowIso),
      changeFrequency: 'monthly',
      priority: 0.6,
    }));

  const guides: MetadataRoute.Sitemap = publishedGuides.map((guide) => ({
    url: `${base}${guide.url}`,
    lastModified: getFileLastModified(`content/docs/${guide.slug}.mdx`, nowIso),
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const latestChangelogDate = changelogEntries
    .map((entry) => new Date(entry.date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const changelogLastModified = latestChangelogDate?.toISOString() ?? nowIso;
  const changelogRoute: MetadataRoute.Sitemap = [
    {
      url: `${base}/changelog`,
      lastModified: changelogLastModified,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
  ];

  return [...routes, ...posts, ...guides, ...changelogRoute];
}
