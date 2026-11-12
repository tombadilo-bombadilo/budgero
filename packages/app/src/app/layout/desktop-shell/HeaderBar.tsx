import { Trans, useLingui } from '@lingui/react/macro';
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
import { PageGuideButton } from '@features/page-guides';
import { useShowFirstStepsMenuItems } from '@features/first-steps';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { getKeyboardShortcutLabels } from '@shared/lib/keyboard-shortcuts';

import { useUiStore } from '@shared/store/useUiStore';
import { triggerAddTransaction, triggerCommandPalette } from './desktop-shell.utils';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import type { BreadcrumbItem as BreadcrumbItemType } from './types';

interface HeaderBarProps {
  breadcrumbs: BreadcrumbItemType[];
}

export const HeaderBar = React.memo(function HeaderBar({ breadcrumbs }: HeaderBarProps) {
  const { t } = useLingui();
  const firstStepsItems = useShowFirstStepsMenuItems();

  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const togglePrivacyMaskNumbers = useUiStore((state) => state.togglePrivacyMaskNumbers);
  const feedbackEnabled = !IS_SELF_HOSTABLE_BUILD;
  const shortcuts = getKeyboardShortcutLabels();

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
                    <span>
                      <Trans>Home</Trans>
                    </span>
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
          <PageGuideButton className="h-7 px-2" extraItems={firstStepsItems} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-2"
            onClick={triggerAddTransaction}
            title={t`Add transaction (${shortcuts.addTransaction})`}
            aria-label={t`Add transaction`}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden lg:inline">
              <Trans>Add Transaction</Trans>
            </span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-primary-foreground/30 px-1.5 font-mono text-[10px] font-medium opacity-80 lg:flex">
              {shortcuts.addTransaction}
            </kbd>
          </Button>
          <Button
            variant={privacyMaskNumbers ? 'default' : 'outline'}
            size="sm"
            className="gap-2"
            onClick={togglePrivacyMaskNumbers}
            title={privacyMaskNumbers ? t`Disable privacy mode` : t`Enable privacy mode`}
            aria-label={privacyMaskNumbers ? t`Disable privacy mode` : t`Enable privacy mode`}
          >
            {privacyMaskNumbers ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden lg:inline">
              <Trans>Privacy</Trans>
            </span>
          </Button>
          {feedbackEnabled && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={openQuackback}
              title={t`Send feedback`}
              aria-label={t`Send feedback`}
            >
              <FeedbackIcon className="h-4 w-4" />
              <span className="hidden lg:inline">
                <Trans>Feedback</Trans>
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={triggerCommandPalette}
            title={t`Search (${shortcuts.search})`}
          >
            <Search className="h-4 w-4" />
            <span className="hidden lg:inline">
              <Trans>Search</Trans>
            </span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
              {shortcuts.search}
            </kbd>
          </Button>
          <KeyboardShortcutsDialog />
          <ConnectivityStatus />
        </div>
      </div>
    </div>
  );
});
