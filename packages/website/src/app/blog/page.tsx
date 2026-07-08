import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { PenLine, Sparkles, SquareLibrary } from 'lucide-react';
import { allPosts } from 'contentlayer/generated';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Articles and updates from Budgero.',
};

export default function BlogPage() {
  const posts = allPosts
    .filter((p) => !p.draft && p.published !== false)
    .sort((a, b) => Number(new Date(b.date)) - Number(new Date(a.date)));

  const heroHighlights = [
    { icon: Sparkles, label: 'Product updates' },
    { icon: PenLine, label: 'Budgeting wisdom' },
    { icon: SquareLibrary, label: 'Behind the scenes' },
  ] as const;

  return (
    <main className="bg-background text-foreground">
      <section className="border-b border-border/60 bg-muted/20 pt-24 sm:pt-28">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
            Budgero blog
          </Badge>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Insights & updates
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Follow along as we ship new budgeting tools, share privacy-first finance tips, and
            unpack the thinking behind Budgero&apos;s roadmap.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {heroHighlights.map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 py-2"
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-4xl px-4 py-12 sm:py-16 lg:py-20">
        {posts.length === 0 ? (
          <Card className="border-dashed border-border/60 bg-background/50 text-center">
            <CardHeader>
              <CardTitle className="text-2xl font-semibold text-foreground">
                No posts just yet
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              We&apos;re drafting the first story. Check back soon or explore the docs to see
              what&apos;s new in Budgero.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {posts.map((post) => (
              <article key={post._id} className="group">
                <Card className="h-full overflow-hidden border-border/70 bg-background/70 transition hover:border-border hover:shadow-lg hover:shadow-black/5">
                  {post.image || post.cover ? (
                    <Link href={post.url} className="block">
                      <Image
                        src={(post.image || post.cover) as string}
                        alt={post.title}
                        width={1200}
                        height={630}
                        className="h-auto w-full border-b border-border object-cover transition group-hover:brightness-[0.98]"
                        priority={false}
                      />
                    </Link>
                  ) : null}
                  <CardHeader>
                    <CardTitle className="text-2xl font-semibold">
                      <Link href={post.url} className="transition hover:text-primary">
                        {post.title}
                      </Link>
                    </CardTitle>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {new Date(post.date).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                      })}
                      {typeof post.readingTimeMinutes === 'number'
                        ? ` • ${post.readingTimeMinutes} min read`
                        : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-muted-foreground">{post.description}</p>
                    {post.tags?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {post.tags.map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className="rounded-full px-2.5 py-1 text-xs"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
