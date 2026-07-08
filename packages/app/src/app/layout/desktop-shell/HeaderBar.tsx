import React, { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Home, Plus, Search } from 'lucide-react';
import { FeedbackIcon } from '@shared/ui/icons/feedback-icon';
import { SidebarTrigger } from '@shared/ui/sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@shared/ui/breadcrumb';
import { Button } from '@shared/ui/button';
import { ConnectivityStatus } from '@widgets/sync-status/ConnectivityStatus';
import { openQuackback } from '@features/feedback';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

import { useUiStore } from '@shared/store/useUiStore';
import { triggerAddTransaction, triggerCommandPalette } from './desktop-shell.utils';
import type { BreadcrumbItem as BreadcrumbItemType } from './types';

interface HeaderBarProps {
  breadcrumbs: BreadcrumbItemType[];
}

export const HeaderBar = React.memo(function HeaderBar({ breadcrumbs }: HeaderBarProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const togglePrivacyMaskNumbers = useUiStore((state) => state.togglePrivacyMaskNumbers);
  const feedbackEnabled = !IS_SELF_HOSTABLE_BUILD;

  return (
    <div className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b">
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2">
          <SidebarTrigger />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/dashboard" className="inline-flex items-center gap-1">
                    <Home className="h-3.5 w-3.5" />
                    <span>Home</span>
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {breadcrumbs.map((c) => (
                <Fragment key={c.href}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {c.last ? (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={c.href}>{c.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-2"
            onClick={triggerAddTransaction}
            title="Add transaction (⌘⌥T)"
            aria-label="Add transaction"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden lg:inline">Add Transaction</span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-primary-foreground/30 px-1.5 font-mono text-[10px] font-medium opacity-80 lg:flex">
              <span className="text-xs">&#8997;</span>
              <span className="text-xs">&#8984;</span>T
            </kbd>
          </Button>
          <Button
            variant={privacyMaskNumbers ? 'default' : 'outline'}
            size="sm"
            className="gap-2"
            onClick={togglePrivacyMaskNumbers}
            title={privacyMaskNumbers ? 'Disable privacy mode' : 'Enable privacy mode'}
            aria-label={privacyMaskNumbers ? 'Disable privacy mode' : 'Enable privacy mode'}
          >
            {privacyMaskNumbers ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden lg:inline">Privacy</span>
          </Button>
          {feedbackEnabled && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={openQuackback}
              title="Send feedback"
              aria-label="Send feedback"
            >
              <FeedbackIcon className="h-4 w-4" />
              <span className="hidden lg:inline">Feedback</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={triggerCommandPalette}
          >
            <Search className="h-4 w-4" />
            <span className="hidden lg:inline">Search</span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
              <span className="text-xs">&#8984;</span>K
            </kbd>
          </Button>
          <ConnectivityStatus />
        </div>
      </div>
    </div>
  );
});
