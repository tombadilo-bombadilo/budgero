import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LegacyExplorerRedirect from './LegacyExplorerRedirect';

function Where() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search} {JSON.stringify(location.state)}
    </output>
  );
}

function renderAt(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/reports/explorer', state }]}>
      <Routes>
        <Route path="/reports/explorer" element={<LegacyExplorerRedirect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('LegacyExplorerRedirect', () => {
  it('opens the report a dashboard asked for, keeping openSaveDialog', () => {
    renderAt({ editReportId: 'abc 1', openSaveDialog: true });
    expect(screen.getByRole('status')).toHaveTextContent(
      '/reports/question/abc%201 {"openSaveDialog":true}'
    );
  });

  it('sends plain visits to a new question', () => {
    renderAt(null);
    expect(screen.getByRole('status')).toHaveTextContent('/reports/question/new');
  });
});
