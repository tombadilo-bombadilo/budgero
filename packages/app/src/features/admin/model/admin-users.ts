export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_login?: string;
  subscription_status: string;
  subscription_id?: string;
  is_admin: boolean;
  is_blocked?: boolean;
  is_founding_member: boolean;
  has_beta_access: boolean;
  has_collaboration_access: boolean;
  beta_expires_at?: string;
  subscription_ends_at?: string;
  trial_ends_at?: string;
  current_period_end?: string;
  customer_id?: string;
  variant_id?: string;
  is_master_password_set?: boolean;
}

export interface AdminDayCount {
  day: string;
  count: number;
}

export interface AdminMutationSummary {
  id: string;
  spaceId: string;
  op: string;
  version: number;
  timestamp: string;
}

export interface AdminUserActivity {
  windowDays: number;
  totalSessions: number;
  activeDays: number;
  lastActiveAt?: string;
  days: AdminDayCount[];
}

export interface AdminUserAppActivity {
  windowDays: number;
  totalHeartbeats: number;
  activeDays: number;
  lastSeenAt?: string;
  days: AdminDayCount[];
}

export interface AdminUserMutationStats {
  totalMutations: number;
  lastMutation?: AdminMutationSummary;
  activeDays: number;
  avgPerActiveDay: number;
  days: AdminDayCount[];
}

export interface AdminWorkspaceItem {
  spaceId: string;
  displayName: string;
  ownerUserId: string;
  role: string;
  invitationStatus: string;
  createdAt: string;
}

export interface AdminUserWorkspaceStats {
  ownedShareSeatsUsed: number;
  ownedShareSeatsLimit: number;
  ownedWorkspaceCount: number;
  collaboratorWorkspaceCount: number;
  items: AdminWorkspaceItem[];
}

export interface AdminSubscriptionTransaction {
  id: string;
  status: string;
  statusFormatted: string;
  billingReason: string;
  totalCents: number;
  totalFormatted: string;
  currency: string;
  invoiceUrl: string;
  createdAt: string;
  refunded: boolean;
  refundedAt?: string;
}

export interface AdminUserSubscriptionStats {
  planName: string;
  status: string;
  variantName?: string;
  productName?: string;
  priceFormatted?: string;
  intervalLabel?: string;
  ltvCents: number;
  ltvFormatted: string;
  transactions: AdminSubscriptionTransaction[];
}

export interface AdminUserDetails {
  user: User;
  appActivity?: AdminUserAppActivity;
  activity?: AdminUserActivity;
  mutations: AdminUserMutationStats;
  workspaces: AdminUserWorkspaceStats;
  subscription?: AdminUserSubscriptionStats;
  sectionErrors?: Partial<
    Record<'appActivity' | 'activity' | 'mutations' | 'workspaces' | 'subscription', string>
  >;
}

export type ActionType =
  | 'grant_founding'
  | 'grant_beta'
  | 'revoke_access'
  | 'reset_data'
  | 'make_admin'
  | 'block'
  | 'unblock'
  | null;

export interface ActionDialogState {
  open: boolean;
  type: ActionType;
  user: User | null;
}
