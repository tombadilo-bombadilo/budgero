import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UnifiedReport } from '@budgero/core/browser';

/** Route state of /reports/question/:id. */
export interface QuestionRouteState {
  openSaveDialog?: boolean;
  /** Open "Add to dashboard" once the page is up (after "Save and add to dashboard"). */
  openPinDialog?: boolean;
}

/**
 * Moves to a just-saved question's own page. That page remounts the editor,
 * so "add to dashboard" travels along in the route state instead of being
 * opened on the editor that is about to go away. `open` and `openAndPin`
 * from one save land in the same render: the pin wins.
 */
export function useOpenSavedQuestion() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ id: string; pin: boolean } | null>(null);

  useEffect(() => {
    if (!pending) return;
    const state: QuestionRouteState | null = pending.pin ? { openPinDialog: true } : null;
    void navigate(`/reports/question/${pending.id}`, { replace: true, state });
  }, [pending, navigate]);

  return {
    open: (report: UnifiedReport) =>
      setPending((previous) =>
        previous?.id === report.id ? previous : { id: report.id, pin: false }
      ),
    openAndPin: (report: UnifiedReport) => setPending({ id: report.id, pin: true }),
  };
}
