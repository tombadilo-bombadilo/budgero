import { PropsWithChildren } from 'react';

export type DesktopShellProps = PropsWithChildren;

export interface BreadcrumbItem {
  href: string;
  label: string;
  last: boolean;
}

export interface NavSectionState {
  accountsOpen: boolean;
  reportsOpen: boolean;
  settingsOpen: boolean;
  showAllAccounts: boolean;
}

export interface NavSectionHandlers {
  handleAccountsToggle: (open: boolean) => void;
  handleReportsToggle: (open: boolean) => void;
  handleSettingsToggle: (open: boolean) => void;
  toggleShowAllAccounts: () => void;
}
