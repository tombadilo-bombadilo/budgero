import { Navigate, useLocation } from 'react-router-dom';

/**
 * /reports/explorer (old Explorer URL). Dashboards' "Open in Explorer" sends
 * { editReportId, openSaveDialog } state; that report opens in its editor.
 */
export default function LegacyExplorerRedirect() {
  const location = useLocation();
  const state = location.state as { editReportId?: string; openSaveDialog?: boolean } | null;
  if (state?.editReportId) {
    return (
      <Navigate
        to={`/reports/question/${encodeURIComponent(state.editReportId)}`}
        replace
        state={{ openSaveDialog: Boolean(state.openSaveDialog) }}
      />
    );
  }
  return <Navigate to="/reports/question/new" replace />;
}
