'use client';

import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pricing } from '@/lib/pricing';

type TrialCtaProps = {
  /** Used as the utm_campaign for attribution in PostHog / GA. */
  campaign?: string;
  /** Used as the utm_content to distinguish CTAs on the same page. */
  location?: string;
  /** Override the primary headline. */
  heading?: string;
  /** Override the body text. */
  body?: string;
  /** Override the button label. */
  button?: string;
  /** Render the compact variant (inline, no large padding). */
  compact?: boolean;
  className?: string;
};

/**
 * Blog / MDX trial CTA.
 *
 * Drop into any MDX file:
 *
 *   <TrialCta campaign="vs-ynab-blog" location="mid-post" />
 *
 * UTM params are baked in so PostHog attribution works per-post.
 */
export function TrialCta({
  campaign = 'blog',
  location = 'inline',
  heading = 'Try Budgero free for 35 days',
  body,
  button = 'Start Free Trial',
  compact = false,
  className,
}: TrialCtaProps) {
  const href =
    `https://my.budgero.app/auth?mode=signup` +
    `&utm_source=website` +
    `&utm_medium=cta` +
    `&utm_campaign=${encodeURIComponent(campaign)}` +
    `&utm_content=${encodeURIComponent(location)}`;

  const defaultBody = `Zero-based budgeting with end-to-end encryption, 168 currencies, and offline mode. No credit card required. Cloud from ${pricing.monthly}/mo — or self-host for free.`;

  return (
    <aside
      className={cn(
        'not-prose my-10 rounded-2xl border border-border/70 bg-card',
        compact ? 'p-5' : 'p-7 sm:p-8',
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">{heading}</h3>
          <p className="text-sm sm:text-base text-foreground/70 leading-relaxed">
            {body ?? defaultBody}
          </p>
        </div>
        <a
          href={href}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-[#111c34] px-5 py-3 text-sm sm:text-base font-medium !text-[#f8fafc] shadow-sm transition-colors hover:bg-[#1e293b] hover:!text-[#f8fafc] !no-underline sm:self-center"
        >
          {button}
          <ArrowRight className="ml-2 h-4 w-4" />
        </a>
      </div>
    </aside>
  );
}

export default TrialCta;
