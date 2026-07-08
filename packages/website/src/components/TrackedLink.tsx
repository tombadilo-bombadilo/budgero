'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { posthog } from '@/lib/posthog';

interface TrackedLinkProps {
  event: string;
  href: string;
  /** Render a raw <a> instead of next/link (use for external/cross-origin URLs). */
  external?: boolean;
  className?: string;
  children: ReactNode;
  target?: string;
  rel?: string;
  'aria-label'?: string;
}

/**
 * Anchor / Link wrapper that fires `posthog.capture(event)` on click.
 *
 * Why: server-rendered pages on the marketing site can't attach onClick
 * handlers, so we wrap the link in a small client component to keep the
 * tracking call site-local without converting the whole page to a client
 * component.
 */
export function TrackedLink({
  event,
  href,
  external,
  className,
  children,
  target,
  rel,
  'aria-label': ariaLabel,
}: TrackedLinkProps) {
  const onClick = () => {
    posthog.capture(event);
  };

  if (external) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={className}
        target={target}
        rel={rel}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
