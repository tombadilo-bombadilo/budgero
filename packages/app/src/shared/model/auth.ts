export type OnboardingStatus = 'pending' | 'snoozed' | 'dismissed' | 'completed';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset = 'default' | 'phosphor' | 'mesa' | 'obsidian' | 'paper';
export type ClassicFontPreference =
  | 'fira-code'
  | 'montserrat'
  | 'exo-2'
  | 'azeret'
  | 'inter'
  | 'roboto'
  | 'poppins'
  | 'ibm-plex-mono';
export type HomePagePreference = 'dashboard' | 'planning' | 'accounts' | 'analytics';
export type BudgetLayoutPreference = 'cards' | 'compact' | 'table';

export type MasterPasswordStorageMode = 'memory' | 'session';

export interface UserPreferences {
  theme_mode: ThemeMode;
  theme_preset: ThemePreset;
  classic_font: ClassicFontPreference;
  home_page: HomePagePreference;
  desktop_budget_layout: BudgetLayoutPreference;
  compact_mobile_layout: boolean;
  mobile_budget_layout: BudgetLayoutPreference;
  master_password_storage_mode: MasterPasswordStorageMode;
  master_password_storage_days: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  is_master_password_set: boolean;
  current_db_hash: string;
  sync_version: number;
  created_at: string;
  subscription_status:
    | 'trialing'
    | 'on_trial'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'cancelled'
    | 'expired'
    | 'inactive'
    | 'paused'
    | 'lifetime';
  subscription_id?: string;
  customer_id?: string;
  variant_id?: string;
  subscription_ends_at?: string;
  trial_ends_at?: string;
  current_period_end?: string;
  has_beta_access: boolean;
  beta_expires_at?: string;
  is_founding_member: boolean;
  has_collaboration_access: boolean;
  last_user_db_backup?: string | null;
  backup_reminder_frequency_days?: number;
  primary_space_id?: string | null;
  access_level?:
    | 'admin'
    | 'founding_member'
    | 'beta'
    | 'trial'
    | 'subscriber'
    | 'collaborator'
    | 'none';
  can_access_owned_workspaces?: boolean;
  can_access_shared_workspaces?: boolean;
  can_create_workspace?: boolean;
  has_accessible_workspace?: boolean;
  has_locked_shared_workspace?: boolean;
  // Admin flag (computed on server response)
  is_admin?: boolean;
  is_blocked?: boolean;
  onboarding_status?: OnboardingStatus;
  onboarding_completed_at?: string;
  onboarding_snoozed_until?: string;
  /** How the user said they discovered Budgero (onboarding referral step). */
  where_heard_about?: string;
  // Analytics consent — opt-in, disabled by default (SaaS only)
  is_analytics_disabled?: boolean;
  // Trial-reward signal opt-out — on by default, decoupled from analytics (SaaS only)
  is_trial_signals_disabled?: boolean;
  preferences?: UserPreferences;
}

export interface AppConfig {
  early_access_mode: boolean;
  early_access_message: string;
}
