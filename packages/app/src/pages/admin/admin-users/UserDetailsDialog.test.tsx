import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AdminUserDetails, User } from '@features/admin/model/admin-users';
import { UserDetailsDialog } from './UserDetailsDialog';

const user: User = {
  id: 'user_123',
  email: 'details@example.com',
  name: 'Details User',
  created_at: '2026-03-01T12:00:00Z',
  last_login: '2026-03-14T08:15:00Z',
  subscription_status: 'active',
  subscription_id: 'sub_123',
  customer_id: 'cust_123',
  is_admin: true,
  is_blocked: false,
  is_founding_member: false,
  has_beta_access: false,
  has_collaboration_access: true,
};

const details: AdminUserDetails = {
  user,
  appActivity: {
    windowDays: 365,
    totalHeartbeats: 12,
    activeDays: 6,
    lastSeenAt: '2026-03-14T09:00:00Z',
    days: [
      { day: '2026-03-12', count: 2 },
      { day: '2026-03-13', count: 0 },
      { day: '2026-03-14', count: 4 },
    ],
  },
  activity: {
    windowDays: 365,
    totalSessions: 7,
    activeDays: 4,
    lastActiveAt: '2026-03-14T08:15:00Z',
    days: [
      { day: '2026-03-12', count: 1 },
      { day: '2026-03-13', count: 0 },
      { day: '2026-03-14', count: 3 },
    ],
  },
  mutations: {
    totalMutations: 42,
    activeDays: 5,
    avgPerActiveDay: 3.5,
    lastMutation: {
      id: 'mut_1',
      spaceId: 'space_1',
      op: 'transactions.add',
      version: 12,
      timestamp: '2026-03-14T08:00:00Z',
    },
    days: [
      { day: '2026-03-12', count: 2 },
      { day: '2026-03-13', count: 0 },
      { day: '2026-03-14', count: 5 },
    ],
  },
  workspaces: {
    ownedShareSeatsUsed: 2,
    ownedShareSeatsLimit: 5,
    ownedWorkspaceCount: 1,
    collaboratorWorkspaceCount: 2,
    items: [
      {
        spaceId: 'space_1',
        displayName: 'Household',
        ownerUserId: 'user_123',
        role: 'owner',
        invitationStatus: 'accepted',
        createdAt: '2026-02-20T12:00:00Z',
      },
    ],
  },
  subscription: {
    planName: 'Cloud Pro',
    status: 'active',
    variantName: 'Monthly',
    productName: 'Budgero Cloud',
    priceFormatted: '$8.00',
    intervalLabel: 'Every month',
    ltvCents: 1600,
    ltvFormatted: '$16.00',
    transactions: [],
  },
  sectionErrors: {
    activity: 'Clerk request timed out',
  },
};

describe('UserDetailsDialog', () => {
  it('renders live detail sections and section errors', async () => {
    const userEventInstance = userEvent.setup();

    render(
      <UserDetailsDialog
        user={user}
        details={details}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onCopyId={vi.fn()}
      />
    );

    expect(screen.getByText('Recent App Activity Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Cloud Pro')).toBeInTheDocument();

    await userEventInstance.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText('App Activity')).toBeInTheDocument();
    expect(screen.getByText('Clerk Session Activity')).toBeInTheDocument();
    expect(screen.getByText('Clerk request timed out')).toBeInTheDocument();

    await userEventInstance.click(screen.getByRole('tab', { name: 'Workspaces' }));
    expect(screen.getByText('Household')).toBeInTheDocument();
  });
});
