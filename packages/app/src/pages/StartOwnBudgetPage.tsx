import { useCallback, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import OnboardingFlow from '@pages/onboarding/OnboardingFlow';
import { useDemoSpaceStatus } from '@features/demo-budget/lib/useIsDemoSpace';
import { useActiveSpaceId, useAvailableSpaces } from '@shared/runtime/runtime-provider';

/**
 * "Start my own budget" from the demo: the budget part of onboarding (the
 * master password is already set), then the demo workspace is deleted. Only
 * reachable while the open workspace is the demo and it still exists.
 */
export default function StartOwnBudgetPage() {
  const navigate = useNavigate();
  const activeSpaceId = useActiveSpaceId();
  const spaces = useAvailableSpaces();
  const { isDemo, checking } = useDemoSpaceStatus();
  const onComplete = useCallback(() => {
    void navigate('/budgeting', { replace: true });
  }, [navigate]);

  const allowed =
    isDemo && Boolean(activeSpaceId && spaces.some((s) => s.space_id === activeSpaceId));
  // Once in, stay: setting up switches to the new workspace before it is done.
  const [entered, setEntered] = useState(false);
  if (allowed && !entered) setEntered(true);

  if (!entered && !allowed) {
    return checking ? null : <Navigate to="/budgeting" replace />;
  }
  return <OnboardingFlow mode="from_demo" onComplete={onComplete} />;
}
