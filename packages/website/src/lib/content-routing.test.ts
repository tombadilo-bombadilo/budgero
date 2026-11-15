import assert from 'node:assert/strict';
import test from 'node:test';
import { localeSwitchPath, postPath, postsForLocale, resolvePost } from './content-routing.ts';
import { guideSitemap, localizedRouteSitemap, postSitemap } from './content-sitemap.ts';
import { routing } from '../i18n/routing.ts';

const posts = [
  { ...postPath('blog/legacy-article'), date: '2026-09-01' },
  { ...postPath('blog/de/haushaltsbuch'), date: '2026-09-02' },
  { ...postPath('blog/fr/budget-personnel'), date: '2026-09-03' },
  { ...postPath('blog/de/draft'), date: '2026-09-04', draft: true },
  { ...postPath('blog/hidden'), date: '2026-09-05', published: false },
];

test('native posts retain their own language and slug while English URLs stay unchanged', () => {
  assert.deepEqual(postPath('blog/de/haushaltsbuch'), {
    locale: 'de',
    slugAsParams: 'haushaltsbuch',
    pathname: '/blog/haushaltsbuch',
    url: '/de/blog/haushaltsbuch',
  });
  assert.equal(postPath('blog/legacy-article').url, '/blog/legacy-article');
  assert.equal(postPath('blog/en/explicit-english').url, '/blog/explicit-english');
  assert.equal(postPath('blog/privacy/guide').url, '/blog/privacy/guide');
});

test('blog indexes and the English feed only include published articles in their language', () => {
  assert.deepEqual(
    postsForLocale(posts, 'en').map((post) => post.slugAsParams),
    ['legacy-article']
  );
  assert.deepEqual(
    postsForLocale(posts, 'de').map((post) => post.slugAsParams),
    ['haushaltsbuch']
  );
  assert.deepEqual(postsForLocale(posts, 'nl'), []);
});

test('the requested locale selects the article even when two languages share a slug', () => {
  const collision = [...posts, { ...postPath('blog/fr/haushaltsbuch'), date: '2026-09-06' }];
  assert.equal(resolvePost(collision, 'de', 'haushaltsbuch').post?.locale, 'de');
  assert.equal(resolvePost(collision, 'fr', 'haushaltsbuch').post?.locale, 'fr');
});

test('legacy English shells redirect to the canonical, but native posts never cross languages', () => {
  assert.equal(resolvePost(posts, 'de', 'legacy-article').redirect, '/blog/legacy-article');
  assert.deepEqual(resolvePost(posts, 'fr', 'haushaltsbuch'), {
    post: undefined,
    redirect: undefined,
  });
  assert.deepEqual(resolvePost(posts, 'de', 'draft'), { post: undefined, redirect: undefined });
  assert.deepEqual(resolvePost(posts, 'de', 'hidden'), { post: undefined, redirect: undefined });
});

test('article language switches lead to a useful index without stale fragments', () => {
  assert.equal(localeSwitchPath('/blog/haushaltsbuch', 'fr', '?ref=old', '#example'), '/fr/blog');
  assert.equal(localeSwitchPath('/actual-budget-alternative', 'de', '?ref=old', '#compare'), '/de');
  assert.equal(localeSwitchPath('/best-self-hosted-budgeting-apps', 'nl', '', '#sure'), '/nl');
  assert.equal(localeSwitchPath('/maybe-finance-alternative', 'es', '', '#move'), '/es');
  assert.equal(localeSwitchPath('/ynab-alternative-canada', 'fr', '?ref=x', '#faq'), '/fr');
  assert.equal(
    localeSwitchPath('/docs/offline', 'fr', '?view=all', '#sync'),
    '/fr/docs/offline?view=all#sync'
  );
  assert.equal(
    localeSwitchPath('/docs/offline', 'en', '?view=all', '#sync'),
    '/docs/offline?view=all#sync'
  );
});

test('canonical English URLs are not negotiated back to a different locale', () => {
  assert.equal(routing.localeDetection, false);
  assert.equal(routing.alternateLinks, false);
});

test('native post sitemap emits exactly the real published URLs without invented alternates', () => {
  const entries = postSitemap(posts);
  assert.deepEqual(
    entries.map((entry) => entry.url),
    [
      'https://budgero.app/blog/legacy-article',
      'https://budgero.app/de/blog/haushaltsbuch',
      'https://budgero.app/fr/blog/budget-personnel',
    ]
  );
  assert.ok(entries.every((entry) => !entry.alternates));
  assert.equal(entries[1].lastModified, '2026-09-02T00:00:00.000Z');
});

test('guide sitemap emits each real locale once and only advertises published variants', () => {
  const entries = guideSitemap([
    { locale: 'en', slug: 'offline', url: '/docs/offline' },
    { locale: 'de', slug: 'offline', url: '/de/docs/offline' },
    { locale: 'fr', slug: 'offline', url: '/fr/docs/offline', published: false },
    { locale: 'nl', slug: 'unique', url: '/nl/docs/unique' },
  ]);
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map((entry) => entry.url)).size, 3);
  assert.equal(entries[1].url, 'https://budgero.app/de/docs/offline');
  assert.deepEqual(entries[1].alternates?.languages, {
    en: 'https://budgero.app/docs/offline',
    de: 'https://budgero.app/de/docs/offline',
    'x-default': 'https://budgero.app/docs/offline',
  });
  assert.deepEqual(entries[2].alternates?.languages, { nl: 'https://budgero.app/nl/docs/unique' });
});

test('shared translated pages retain reciprocal real locale URLs', () => {
  const entries = localizedRouteSitemap([{ url: 'https://budgero.app/' }]);
  assert.equal(entries.length, 5);
  assert.equal(entries[0].url, 'https://budgero.app/');
  assert.equal(entries[1].url, 'https://budgero.app/de');
  assert.deepEqual(entries[0].alternates, entries[4].alternates);
});
