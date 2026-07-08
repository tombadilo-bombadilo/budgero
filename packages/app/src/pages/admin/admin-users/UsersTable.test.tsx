import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { User } from '@features/admin/model/admin-users';
import { UsersTable } from './UsersTable';

const baseUser: User = {
  id: 'user_12345678',
  email: 'test@example.com',
  name: 'Test User',
  created_at: '2026-03-01T12:00:00Z',
  subscription_status: 'active',
  is_admin: false,
  is_founding_member: false,
  has_beta_access: false,
  has_collaboration_access: false,
};

describe('UsersTable', () => {
  it('renders the View Details CTA instead of the last login header', async () => {
    const onViewDetails = vi.fn();
    const user = userEvent.setup();

    render(
      <UsersTable
        users={[baseUser]}
        loading={false}
        onViewDetails={onViewDetails}
        onAction={vi.fn()}
        onCopyId={vi.fn()}
      />
    );

    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.queryByText('Last Login')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View Details' }));
    expect(onViewDetails).toHaveBeenCalledWith(baseUser);
  });
});
