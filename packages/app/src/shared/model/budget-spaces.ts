import type { BudgetSpaceSummary as RuntimeBudgetSpaceSummary } from '@budgero/runtime';

export interface BudgetSpaceSummary extends RuntimeBudgetSpaceSummary {
  updated_at?: string;
}

export interface BudgetSpaceMember {
  space_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
  encrypted_space_key: string;
  invitation_status: string;
  invited_at: string;
  accepted_at?: string | null;
}

export interface BudgetSpaceInvite {
  id: string;
  space_id: string;
  inviter_user_id: string;
  invitee_email?: string;
  invite_secret: string;
  encrypted_bundle: string;
  status: string;
  expires_at?: string;
  redeemed_at?: string;
  redeemed_by?: string;
  created_at: string;
}

export interface SpaceInviteInspection {
  id: string;
  space_id: string;
  space_display_name: string;
  inviter_user_id: string;
  encrypted_bundle: string;
  status: string;
  expires_at?: string;
}
