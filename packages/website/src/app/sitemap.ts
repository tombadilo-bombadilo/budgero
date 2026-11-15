import type { MetadataRoute } from 'next';
import { allGuides, allPosts } from 'contentlayer/generated';

import { changelogPageCount, changelogPath } from '@/lib/changelog-pagination';
import { changelogEntries } from '@/lib/changelog-data';
import { guideSitemap, localizedRouteSitemap, postSitemap } from '@/lib/content-sitemap';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://budgero.app';

  // Only include lastModified when we have an editorial date. Filesystem mtimes
  // and the build time change on deployment even when the content does not.
  const routes: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${base}/self-hostable`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/monarch-money-alternative`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${base}/vs-ynab`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/ynab-alternative-europe`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/ynab-alternative-uk`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/ynab-alternative-australia`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/monarch-money-multi-currency`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/firefly-iii-alternative`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/self-hosted-ynab-alternative`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/monarch-money-europe-alternative`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/best-ynab-alternatives`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/encrypted-budgeting`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/multi-currency-budgeting`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/zero-based-budgeting`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${base}/everydollar-alternative`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/goodbudget-alternative`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/pocketguard-alternative`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/quicken-simplifi-alternative`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/docs`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${base}/blog`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${base}/donate`,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
  ];

  const latestChangelogDate = changelogEntries
    // Changelog dates are written as "September 4, 2026" without a time zone.
    // Interpret them as UTC so deployment environments produce the same date.
    .map((entry) => new Date(`${entry.date} UTC`))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const changelogLastModified = latestChangelogDate?.toISOString();
  const changelogRoute: MetadataRoute.Sitemap = Array.from(
    { length: changelogPageCount },
    (_, index) => ({
      url: `${base}${changelogPath(index + 1)}`,
      lastModified: changelogLastModified,
      changeFrequency: 'weekly',
      priority: index === 0 ? 0.5 : 0.3,
    })
  );

  return [
    ...localizedRouteSitemap([...routes, ...changelogRoute]),
    ...postSitemap(allPosts),
    ...guideSitemap(allGuides),
    // This comparison is an independent English page, not a translation group.
    { url: `${base}/actual-budget-alternative`, changeFrequency: 'monthly', priority: 0.8 },
    // English only until the translations are approved.
    {
      url: `${base}/best-self-hosted-budgeting-apps`,
      lastModified: '2026-11-15',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/maybe-finance-alternative`,
      lastModified: '2026-11-15',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/ynab-alternative-canada`,
      lastModified: '2026-11-15',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    // English only until translated; other locales redirect to it.
    { url: `${base}/tools/debt-payoff-calculator`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/fire-calculator`, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
