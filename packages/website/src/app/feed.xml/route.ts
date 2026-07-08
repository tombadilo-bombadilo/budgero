import { allPosts } from 'contentlayer/generated';

export async function GET() {
  const site = 'https://budgero.app';
  const posts = allPosts
    .filter((p) => !p.draft)
    .sort((a, b) => Number(new Date(b.date)) - Number(new Date(a.date)));

  const items = posts
    .map((post) => {
      const url = `${site}${post.url}`;
      const pubDate = new Date(post.date).toUTCString();
      return `
      <item>
        <title><![CDATA[${post.title}]]></title>
        <link>${url}</link>
        <guid>${url}</guid>
        <pubDate>${pubDate}</pubDate>
        <description><![CDATA[${post.description}]]></description>
      </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0">
    <channel>
      <title>Budgero Blog</title>
      <link>${site}</link>
      <description>Articles and updates from Budgero</description>
      <language>en-us</language>
      ${items}
    </channel>
  </rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
}
