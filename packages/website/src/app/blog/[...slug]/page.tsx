import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { allPosts } from 'contentlayer/generated';
import { Mdx } from '@/components/mdx-components';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Params {
  slug: string[];
}

export function generateStaticParams(): Params[] {
  return allPosts.filter((p) => !p.draft).map((post) => ({ slug: post.slugAsParams.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const slugStr = slug.join('/');
  const post = allPosts.find((p) => p.slugAsParams === slugStr);
  if (!post) return {};
  const images = post.image ? [post.image] : ['/logo_144.png'];
  const publishedTime = new Date(post.date).toISOString();
  const modifiedTime = post.updated ? new Date(post.updated).toISOString() : publishedTime;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `https://budgero.app${post.url}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url: post.url,
      images,
      publishedTime,
      modifiedTime,
      authors: ['Budgero'],
    },
    twitter: {
      title: post.title,
      description: post.description,
      images,
      card: 'summary_large_image',
    },
  } satisfies Metadata;
}

export default async function PostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const slugStr = slug.join('/');
  const post = allPosts.find((p) => p.slugAsParams === slugStr);
  if (!post || post.draft || post.published === false) return notFound();

  const formattedDate = new Date(post.date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
  });
  const readingTime =
    typeof post.readingTimeMinutes === 'number' ? `${post.readingTimeMinutes} min read` : null;

  const publishedTime = new Date(post.date).toISOString();
  const modifiedTime = post.updated ? new Date(post.updated).toISOString() : publishedTime;

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    image: post.image ? `https://budgero.app${post.image}` : 'https://budgero.app/logo_512.png',
    datePublished: publishedTime,
    dateModified: modifiedTime,
    author: {
      '@type': 'Organization',
      name: 'Budgero',
      url: 'https://budgero.app',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Budgero',
      logo: {
        '@type': 'ImageObject',
        url: 'https://budgero.app/logo_512.png',
        width: 512,
        height: 512,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://budgero.app${post.url}`,
    },
  };

  return (
    <article className="container mx-auto max-w-3xl px-4 pb-10 pt-24 sm:pt-28">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <header className="mb-8 space-y-3">
        <Link href="/blog" className="text-sm text-muted-foreground hover:underline">
          ← Back to blog
        </Link>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {post.title}
        </h1>
        <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
          <span>{formattedDate}</span>
          {readingTime ? (
            <>
              <span aria-hidden>•</span>
              <span>{readingTime}</span>
            </>
          ) : null}
        </div>
        {post.tags?.length ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {post.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="rounded-full px-2.5 py-1 text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
        {post.image || post.cover ? (
          <div className="mt-4">
            <Image
              src={(post.image || post.cover) as string}
              alt={post.title}
              width={1200}
              height={630}
              className="h-auto w-full rounded-md border border-border"
              priority
            />
          </div>
        ) : null}
        {post.description ? <p className="text-muted-foreground">{post.description}</p> : null}
      </header>

      <Mdx code={post.body.code} />

      <div className="mt-10">
        <Button asChild variant="outline">
          <Link href="/blog">← Back to Blog</Link>
        </Button>
      </div>
    </article>
  );
}
