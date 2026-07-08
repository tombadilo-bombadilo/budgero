import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SidebarMenuItem, SidebarMenuButton } from '@shared/ui/sidebar';
import { Badge } from '@shared/ui/badge';
import { cn } from '@shared/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface SidebarNavBadge {
  /** Badge text/content. */
  label: React.ReactNode;
  variant?: React.ComponentProps<typeof Badge>['variant'];
  className?: string;
}

export interface SidebarNavLinkProps {
  /** Target route. */
  to: string;
  /** Leading icon component (e.g. a lucide icon). */
  icon: LucideIcon;
  /** Visible link label. */
  label: string;
  /**
   * Active-match behavior:
   * - `'exact'` (default): active when `pathname === to`.
   * - `'startsWith'`: active when `pathname.startsWith(to)`.
   * - a string: active when `pathname.startsWith(value)`.
   */
  match?: 'exact' | 'startsWith' | string;
  /**
   * Whether this is a top-level link (wrapped in `SidebarMenuItem`, with
   * `min-w-0` on the link and `font-medium` on the label) or an indented
   * submenu link (wrapped in an indentation `<div>`).
   */
  topLevel?: boolean;
  /**
   * Indentation wrapper classes for submenu links (ignored when `topLevel`).
   * Defaults to the common `'ml-4 mr-2'`.
   */
  indentClassName?: string;
  /** Optional trailing badge rendered inside the link. */
  badge?: SidebarNavBadge;
  /** Optional `data-testid` forwarded to the NavLink. */
  testId?: string;
}

/**
 * Single sidebar navigation link. Reproduces the exact markup/classes used
 * throughout `SidebarNav` for both top-level and indented submenu links.
 */
export function SidebarNavLink({
  to,
  icon: Icon,
  label,
  match = 'exact',
  topLevel = false,
  indentClassName = 'ml-4 mr-2',
  badge,
  testId,
}: SidebarNavLinkProps) {
  const location = useLocation();

  const isActive =
    match === 'exact'
      ? location.pathname === to
      : location.pathname.startsWith(match === 'startsWith' ? to : match);

  const link = (
    <SidebarMenuButton asChild isActive={isActive}>
      <NavLink
        to={to}
        className={cn('flex items-center gap-3 px-3 py-2 transition-colors', topLevel && 'min-w-0')}
        data-testid={testId}
      >
        <Icon className="h-4 w-4" />
        <span className={topLevel ? 'font-medium' : undefined}>{label}</span>
        {badge && (
          <Badge variant={badge.variant} className={badge.className}>
            {badge.label}
          </Badge>
        )}
      </NavLink>
    </SidebarMenuButton>
  );

  if (topLevel) {
    return <SidebarMenuItem>{link}</SidebarMenuItem>;
  }

  return <div className={indentClassName}>{link}</div>;
}
