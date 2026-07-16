'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowRight, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const GITHUB_REPO_URL = 'https://github.com/tombadilo-bombadilo/budgero';

/** GitHub mark (octicon). Inline SVG so it follows currentColor across themes. */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const isOverlay = pathname === '/' || pathname.startsWith('/privacy');

  const headerClasses = isOverlay
    ? 'mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-10 xl:px-12 2xl:px-16 py-6'
    : 'container mx-auto px-4 py-6';

  return (
    <div
      id="site-header"
      className={cn(isOverlay ? 'absolute inset-x-0 top-0 z-30' : 'relative z-20')}
    >
      <header className={headerClasses}>
        <nav className="flex items-center justify-between gap-2 sm:gap-3 flex-nowrap whitespace-nowrap">
          <Link
            href="/"
            className="flex items-center space-x-2 sm:space-x-3 min-w-0 overflow-hidden"
          >
            <Image
              src="/logo_144.png"
              alt="Budgero logo"
              width={48}
              height={48}
              className="h-10 w-10 rounded-xl"
              priority
            />
            <span className="text-xl sm:text-2xl font-bold tracking-tight truncate max-w-[40vw]">
              Budgero
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Desktop links */}
            <div className="hidden sm:flex items-center gap-6 text-sm">
              <Link
                href="/docs"
                className="font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                Docs
              </Link>
              <Link
                href="/blog"
                className="font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                Blog
              </Link>
              <Link
                href="/changelog"
                className="font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                Changelog
              </Link>
              <a
                href="https://feedback.budgero.app"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Feedback Clicked - Desktop Header')}
                className="font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                Feedback
              </a>
              <a
                href="https://discord.gg/ZgWnzaPqae"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Community Clicked - Discord (Desktop Header)')}
                className="inline-flex items-center gap-2 font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                <Image src="/Discord-Symbol-Blurple.svg" alt="" width={16} height={16} aria-hidden="true" />
                Join Discord
              </a>
              <a
                href="https://www.reddit.com/r/budgero/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Community Clicked - Reddit (Desktop Header)')}
                className="inline-flex items-center gap-2 font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                <Image src="/Reddit_Logo.webp" alt="" width={16} height={16} aria-hidden="true" />
                Join Reddit
              </a>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Community Clicked - GitHub (Desktop Header)')}
                aria-label="View source on GitHub"
                className="inline-flex items-center gap-2 font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                <GitHubIcon />
                <span className="hidden lg:inline">GitHub</span>
              </a>
            </div>
            {/* Mobile community icons */}
            <div className="sm:hidden flex items-center gap-1">
              <a
                href="https://discord.gg/ZgWnzaPqae"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Community Clicked - Discord (Mobile Header)')}
                aria-label="Join Discord community"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 hover:text-foreground transition-colors"
              >
                <Image src="/Discord-Symbol-Blurple.svg" alt="" width={16} height={16} aria-hidden="true" />
              </a>
              <a
                href="https://www.reddit.com/r/budgero/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Community Clicked - Reddit (Mobile Header)')}
                aria-label="Join Reddit community"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 hover:text-foreground transition-colors"
              >
                <Image src="/Reddit_Logo.webp" alt="" width={16} height={16} aria-hidden="true" />
              </a>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('Community Clicked - GitHub (Mobile Header)')}
                aria-label="View source on GitHub"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 hover:text-foreground transition-colors"
              >
                <GitHubIcon />
              </a>
            </div>
            {/* Mobile menu */}
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open menu"
                    className="text-foreground/70 hover:text-foreground"
                  >
                    <Menu className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover border-border text-popover-foreground">
                  <DropdownMenuItem
                    asChild
                    className="focus:bg-accent focus:text-accent-foreground"
                  >
                    <Link href="/docs">Docs</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="focus:bg-accent focus:text-accent-foreground"
                  >
                    <Link href="/blog">Blog</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="focus:bg-accent focus:text-accent-foreground"
                  >
                    <Link href="/changelog">Changelog</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="focus:bg-accent focus:text-accent-foreground"
                  >
                    <a
                      href="https://feedback.budgero.app"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track('Feedback Clicked - Mobile Header')}
                    >
                      Feedback
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Prominent CTA (hidden on mobile) */}
            <div className="hidden sm:block">
              <Button
                asChild
                className="h-9 px-3 sm:px-4 text-sm bg-[#111c34] text-[#f8fafc] hover:bg-[#1e293b] transition-colors font-medium"
              >
                <a
                  href="https://my.budgero.app/auth?mode=signup&utm_source=website&utm_medium=cta&utm_campaign=header&utm_content=start-trial"
                  className="inline-flex items-center"
                >
                  Start free trial
                  <ArrowRight className="ml-2 w-4 h-4" />
                </a>
              </Button>
            </div>
          </div>
        </nav>
      </header>
    </div>
  );
}
