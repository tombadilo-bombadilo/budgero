'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useMDXComponent } from 'next-contentlayer2/hooks';
import { cn } from '@/lib/utils';
import { Callout } from '@/components/callout';
import { CodeBlock } from '@/components/mdx/code-block';
import { TrialCta } from '@/components/mdx/trial-cta';
import { pricing } from '@/lib/pricing';

const Prose = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'max-w-none leading-7 text-foreground',
      // Comfortable default rhythm for block elements
      '[&>*]:my-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
      // Headings and anchors
      '[&_:where(h1,h2,h3,h4)]:scroll-mt-24 [&_:where(h1,h2,h3,h4)]:tracking-tight',
      '[&_:where(h1,h2,h3,h4)]:font-semibold [&_:where(h1,h2,h3,h4)]:leading-tight',
      // Paragraphs and common blocks
      '[&_p]:my-6 [&_ul]:my-6 [&_ol]:my-6 [&_blockquote]:my-8',
      // Nested content in lists
      '[&_li>p]:my-2',
      // Links & media
      '[&_a]:text-gray-900 hover:[&_a]:underline dark:[&_a]:text-gray-100',
      '[&_img]:rounded-md',
      // Tables
      '[&_table]:border-collapse [&_table]:w-full [&_table]:text-sm',
      '[&_th]:border [&_th]:border-border [&_th]:bg-muted/35 [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
      '[&_td]:border [&_td]:border-border [&_td]:px-4 [&_td]:py-2',
      '[&_tr:nth-child(even)]:bg-muted/25',
      // Code blocks
      '[&_pre]:rounded-lg [&_pre]:shadow-sm',
      className
    )}
    {...props}
  />
);

function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="my-6 w-full overflow-y-auto">
      <table className={cn('w-full', className)} {...props} />
    </div>
  );
}

function CustomImage(props: React.ComponentProps<typeof Image>) {
  // Provide sensible defaults for blog images
  const { alt, className, ...rest } = props;
  return (
    <Image
      alt={alt || ''}
      className={cn('rounded-md border border-zinc-200 dark:border-zinc-800', className)}
      sizes="(max-width: 768px) 100vw, 768px"
      {...rest}
    />
  );
}

// Pricing components for use in MDX — keeps blog/docs prices env-driven
const MonthlyPrice = () => <>{pricing.monthly}</>;
const YearlyPrice = () => <>{pricing.yearly}</>;

const components = {
  // Support both MDX <Image /> and markdown ![]() via <img>
  Image: CustomImage,
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // Use native img for unknown sizes, add consistent styling.
    // Authors can switch to <Image> in MDX for optimized images.
    <img
      {...props}
      className={cn('my-4 rounded-md border border-border', props.className)}
      loading={props.loading ?? 'lazy'}
      alt={props.alt ?? ''}
    />
  ),
  a: (props: React.ComponentProps<typeof Link>) => <Link {...props} />,
  table: Table,
  Callout,
  TrialCta,
  MonthlyPrice,
  YearlyPrice,
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => <CodeBlock {...props} />,
} as const;

export function Mdx({ code }: { code: string }) {
  const Component = useMDXComponent(code);
  return (
    <Prose>
      <Component components={components} />
    </Prose>
  );
}
