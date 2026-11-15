import { locales, type Locale } from '../i18n/routing.ts';

export interface PublishedContent {
  published?: boolean;
  draft?: boolean;
}

export interface LocalizedPost extends PublishedContent {
  locale: string;
  slugAsParams: string;
  url: string;
}

/** Native articles have their own slug; existing root-level files remain English. */
export function postPath(flattenedPath: string) {
  const parts = flattenedPath.replace(/^blog\//, '').split('/');
  const first = parts[0];
  const hasLocale = locales.some((locale) => locale === first);
  const locale = (hasLocale ? parts.shift() : 'en') as Locale;
  const slugAsParams = parts.join('/');
  const pathname = `/blog/${slugAsParams}`;
  return { locale, slugAsParams, pathname, url: localizedPath(locale, pathname) };
}

export function localizedPath(locale: string, pathname: string) {
  return locale === 'en' ? pathname : `/${locale}${pathname === '/' ? '' : pathname}`;
}

export function isPublished(content: PublishedContent) {
  return !content.draft && content.published !== false;
}

export function postsForLocale<T extends LocalizedPost>(posts: T[], locale: string) {
  return posts.filter((post) => post.locale === locale && isPublished(post));
}

export function resolvePost<T extends LocalizedPost>(posts: T[], locale: string, slug: string) {
  const post = posts.find(
    (candidate) =>
      candidate.locale === locale && candidate.slugAsParams === slug && isPublished(candidate)
  );
  if (post) return { post, redirect: undefined };

  // Old translated shells served English posts under every locale. Preserve
  // those links by consolidating them onto the original article's English URL.
  const englishPost = posts.find(
    (candidate) =>
      candidate.locale === 'en' && candidate.slugAsParams === slug && isPublished(candidate)
  );
  return { post: undefined, redirect: locale !== 'en' ? englishPost?.url : undefined };
}

/** Pages that exist only in English; other locales redirect to the English URL. */
export const ENGLISH_ONLY_PATHS = new Set([
  '/actual-budget-alternative',
  '/best-self-hosted-budgeting-apps',
  '/maybe-finance-alternative',
  '/ynab-alternative-canada',
]);

export function localeSwitchPath(pathname: string, locale: string, search = '', hash = '') {
  // Independent articles are not translations. Another language's index is the
  // useful destination, and an article's query/fragment has no meaning there.
  if (pathname.startsWith('/blog/')) return localizedPath(locale, '/blog');
  if (ENGLISH_ONLY_PATHS.has(pathname)) return localizedPath(locale, '/');
  return `${localizedPath(locale, pathname)}${search}${hash}`;
}
