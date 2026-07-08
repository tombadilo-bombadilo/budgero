import {
  User,
  CreditCard,
  Sparkles,
  Shield,
  Users,
  Inbox,
  Tag,
  History,
  Database,
  SlidersHorizontal,
  Coins,
  Layers,
  Clock,
  Plug,
  Bot,
  Palette,
  Info,
  FileText,
  TrendingUp,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react';

export interface NavRouteItem {
  to: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
  selfHostHidden?: boolean;
  devOnly?: boolean;
}

/** Reports submenu links (all indented `ml-4 mr-2`). */
export const NAV_REPORTS: NavRouteItem[] = [
  { to: '/reports/prebuilt', icon: FileText, label: 'Prebuilt Reports' },
  { to: '/reports/explorer', icon: TrendingUp, label: 'Explorer' },
  { to: '/reports/dashboards', icon: LayoutGrid, label: 'Custom Dashboards', exact: false },
];

/** Settings → Account & Access links (only shown when not a self-hostable build). */
export const NAV_SETTINGS_ACCOUNT: NavRouteItem[] = [
  { to: '/settings/account', icon: User, label: 'Account' },
  { to: '/settings/subscription', icon: CreditCard, label: 'Subscription' },
  { to: '/rewards', icon: Sparkles, label: 'Trial rewards' },
  { to: '/settings/security', icon: Shield, label: 'Security & Privacy' },
];

/** Settings → Budgets & Data links. */
export const NAV_SETTINGS_DATA: NavRouteItem[] = [
  { to: '/settings/workspaces', icon: Users, label: 'Workspaces' },
  { to: '/settings/imports', icon: Inbox, label: 'Imports' },
  { to: '/settings/payees', icon: User, label: 'Payees' },
  { to: '/settings/labels', icon: Tag, label: 'Labels' },
  { to: '/settings/audit-log', icon: History, label: 'Audit Log' },
  { to: '/settings/data', icon: Database, label: 'Data Management' },
  { to: '/settings/budget', icon: SlidersHorizontal, label: 'Budget Settings' },
  { to: '/settings/currencies', icon: Coins, label: 'Currencies' },
];

/** Settings → Automation & Integrations links. */
export const NAV_SETTINGS_AUTOMATION: NavRouteItem[] = [
  { to: '/settings/rules', icon: Layers, label: 'Rules' },
  { to: '/settings/recurring', icon: Clock, label: 'Recurring' },
  { to: '/settings/api', icon: Plug, label: 'Push API' },
  { to: '/settings/ai', icon: Bot, label: 'AI Assistant' },
];

/** Settings → Preferences links. */
export const NAV_SETTINGS_PREFERENCES: NavRouteItem[] = [
  { to: '/settings/appearance', icon: Palette, label: 'Appearance' },
  { to: '/settings/about', icon: Info, label: 'About' },
];
