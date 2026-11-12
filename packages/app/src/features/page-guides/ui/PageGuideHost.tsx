import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useProfile } from '@entities/user/api/useAuth';
import { useDemoSpaceStatus } from '@features/demo-budget/lib/useIsDemoSpace';
import { track } from '@shared/lib/analytics/track';
import { useFirstSteps } from '@shared/lib/first-steps/first-steps';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { usePageGuidesSeen } from '../api/usePageGuidesSeen';
import {
  isNewForPageGuides,
  isOtherDialogOpen,
  pageGuideForPath,
  requestAutoPageGuide,
  usePageGuideStore,
  type PageGuideRequest,
} from '../model/page-guides';
import { PageGuideDialog, type PageGuideCloseReason } from './PageGuideDialog';

/** Let the page render and settle before a first-visit guide opens over it. */
const AUTO_DELAY_MS = 800;
const POLL_MS = 200;

/**
 * Mounted once in the app layout (never during onboarding or the
 * master-password screen, which replace the layout). Opens a page's guide on
 * a new user's first visit, and shows any guide asked for with
 * openPageGuide(). A guide waits until no other dialog is open.
 */
export function PageGuideHost() {
  const location = useLocation();
  const guideId = pageGuideForPath(location.pathname);
  const request = usePageGuideStore((state) => state.request);
  const closeRequest = usePageGuideStore((state) => state.close);
  const { data: profile } = useProfile();
  const userId = profile?.id ?? null;
  const spaceId = useActiveSpaceId();
  const firstSteps = useFirstSteps(spaceId);
  const demo = useDemoSpaceStatus();
  const isNew =
    !demo.checking &&
    isNewForPageGuides({
      signedUpAt: profile?.created_at,
      firstStepsStartedOn: firstSteps?.startedOn,
      isDemo: demo.isDemo,
    });
  // Seen guides sync through the workspace's encrypted database; never written
  // into the demo or before we know whether this is the demo.
  const seen = usePageGuidesSeen(userId, !demo.checking && !demo.isDemo);
  const { ready: seenReady, isSeen, markSeen } = seen;
  const markSeenRef = useRef(markSeen);
  useEffect(() => {
    markSeenRef.current = markSeen;
  }, [markSeen]);

  // First visit: at most one guide per page visit, and only one a user hasn't
  // seen here or on another device (so not before the synced state is loaded).
  useEffect(() => {
    if (!guideId || !userId || !isNew || !seenReady || isSeen(guideId) !== false) return;
    let poll: number | undefined;
    const start = window.setTimeout(() => {
      poll = window.setInterval(() => {
        if (usePageGuideStore.getState().request || isOtherDialogOpen()) return;
        window.clearInterval(poll);
        if (isSeen(guideId) !== false) return;
        markSeen(guideId);
        requestAutoPageGuide(guideId);
      }, POLL_MS);
    }, AUTO_DELAY_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(poll);
    };
  }, [guideId, userId, isNew, seenReady, isSeen, markSeen, location.key]);

  // Any request (also one made from a closing menu or drawer) waits for the
  // other dialog to close, so two modals never stack.
  const [shown, setShown] = useState<PageGuideRequest | null>(null);
  useEffect(() => {
    if (!request) return;
    const show = () => {
      setShown(request);
      track('page_guide_shown', { guide: request.id });
      markSeenRef.current(request.id);
    };
    if (!isOtherDialogOpen()) {
      show();
      return;
    }
    const poll = window.setInterval(() => {
      if (isOtherDialogOpen()) return;
      window.clearInterval(poll);
      show();
    }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [request]);

  if (!request || shown !== request) return null;

  const onClose = (reason: PageGuideCloseReason) => {
    track(reason === 'completed' ? 'page_guide_completed' : 'page_guide_skipped', {
      guide: request.id,
    });
    setShown(null);
    closeRequest();
  };

  return (
    <PageGuideDialog
      key={`${request.id}:${request.card}`}
      id={request.id}
      startCard={request.card}
      onClose={onClose}
    />
  );
}
