// After /join bounces an unauthenticated visitor to /auth with the secret
// stashed in storage, this component picks up the trail once the visitor
// lands on any app route while signed in — and routes them back to /join
// so the redeem flow can run against their authenticated session.

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '@shared/model/auth';
import { readPendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';

export default function SpaceInviteRedirect({ user }: { user: User }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user?.id) return;
    if (location.pathname.startsWith('/join')) return;
    const pending = readPendingSpaceInvite();
    if (!pending) return;
    void navigate(`/join#code=${encodeURIComponent(pending)}`, { replace: true });
  }, [user?.id, location.pathname, navigate]);

  return null;
}
