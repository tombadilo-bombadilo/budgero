import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  sidebarPinMinWidth,
} from '@shared/ui/sidebar';
import { TEXT_SIZE_SCALE } from '@shared/lib/text-size/text-size';
import { BudgetSwitcher } from '@features/budget-management/ui/BudgetSwitcher';
import logoImg from '/logo_144.png';
import { useUiStore } from '@shared/store/useUiStore';
import { useDesktopShellState } from './useDesktopShellState';
import { SidebarNav } from './SidebarNav';
import { SidebarFooterContent } from './SidebarFooterContent';
import { HeaderBar } from './HeaderBar';
import { SidebarPinToggle } from './SidebarPinToggle';
import type { DesktopShellProps } from './types';

export function DesktopShell({ children }: DesktopShellProps) {
  const { t } = useLingui();

  const { breadcrumbs, logout } = useDesktopShellState();
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const textSize = useUiStore((state) => state.textSize);

  return (
    <SidebarProvider
      pinned={sidebarPinned}
      pinMinWidth={sidebarPinMinWidth(TEXT_SIZE_SCALE[textSize])}
    >
      <Sidebar data-testid="sidebar">
        <SidebarHeader className="p-2">
          <div className="flex items-center justify-between gap-2 px-2">
            <Link to="/dashboard" className="flex items-center gap-2">
              <img src={logoImg} alt={t`Budgero`} className="h-8 w-8 rounded-lg shadow-sm" />
              <span className="font-semibold">
                <Trans>Budgero</Trans>
              </span>
            </Link>
            <SidebarPinToggle />
          </div>
        </SidebarHeader>
        <SidebarContent className="overflow-y-auto overflow-x-hidden flex-1">
          <BudgetSwitcher />
          <div className="px-2">
            <SidebarNav />
          </div>
        </SidebarContent>
        <SidebarFooter className="p-2">
          <SidebarFooterContent logout={logout} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0">
        <div className="flex min-h-0 flex-1 flex-col">
          <HeaderBar breadcrumbs={breadcrumbs} />
          <div className="flex-1 min-h-0">{children ?? <Outlet />}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
