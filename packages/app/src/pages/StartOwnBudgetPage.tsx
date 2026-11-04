import { useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import OnboardingFlow from '@pages/onboarding/OnboardingFlow';
import { getDemoSpaceId } from '@shared/lib/demo-space';

/**
 * "Start my own budget" from the demo: the budget part of onboarding (the
 * master password is already set), then the demo workspace is deleted.
 */
export default function StartOwnBudgetPage() {
  const navigate = useNavigate();
  const onComplete = useCallback(() => {
    void navigate('/budgeting', { replace: true });
  }, [navigate]);

  if (!getDemoSpaceId()) return <Navigate to="/budgeting" replace />;
  return <OnboardingFlow mode="from_demo" onComplete={onComplete} />;
}
