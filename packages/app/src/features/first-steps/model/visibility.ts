import { useLingui } from '@lingui/react/macro';
import { useLocation } from 'react-router-dom';
import { useProfile } from '@entities/user/api/useAuth';
import {
  hideFirstSteps,
  isFirstStepsHidden as isHiddenFor,
  showFirstSteps as showFor,
} from '@shared/lib/first-steps/first-steps';
import { useFirstSteps } from '@shared/lib/first-steps/useFirstSteps';
import { getRuntime } from '@shared/runtime/global';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';

const getActiveSpaceId = (): string | null => getRuntime()?.getActiveSpaceId() ?? null;

/** Bring the open workspace's hidden first-steps list back (no-op without one). */
export function showFirstSteps(): void {
  const spaceId = getActiveSpaceId();
  if (spaceId) showFor(spaceId);
}

/** The signed-in user has a first-steps list in the open workspace and hid it. */
export function isFirstStepsHidden(): boolean {
  return isHiddenFor(getActiveSpaceId());
}

/**
 * The signed-in user's first-steps list in the open workspace, live (on any
 * of their devices). `available` is false until it is loaded and for a user
 * who never started one (demo, invited members, older budgets): nothing to
 * show or hide there.
 */
export function useFirstStepsVisibility() {
  const spaceId = useActiveSpaceId();
  const { data: profile } = useProfile();
  const steps = useFirstSteps(spaceId, profile?.id ?? null);
  return {
    available: steps !== null,
    hidden: steps?.dismissed ?? false,
    show: () => {
      if (spaceId) showFor(spaceId);
    },
    hide: () => {
      if (spaceId) hideFirstSteps(spaceId);
    },
  };
}

/**
 * The "Show first steps" entry for the Help (?) menu: one item on the Budget
 * page while the list is hidden, none otherwise. Shaped for PageGuideButton's
 * `extraItems`.
 */
export function useShowFirstStepsMenuItems(): {
  key: string;
  label: string;
  onSelect: () => void;
}[] {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const { hidden, show } = useFirstStepsVisibility();
  const onBudget = (pathname.replace(/\/+$/, '') || '/') === '/budgeting';
  return onBudget && hidden
    ? [{ key: 'first-steps', label: t`Show first steps`, onSelect: show }]
    : [];
}
