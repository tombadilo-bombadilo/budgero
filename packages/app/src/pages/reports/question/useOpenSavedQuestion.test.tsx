import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { UnifiedReport } from '@budgero/core/browser';
import { useOpenSavedQuestion } from './useOpenSavedQuestion';

afterEach(cleanup);

const saved = { id: 'q9', name: 'New', query: '', charts: [] } as unknown as UnifiedReport;

/** What the save dialogs do: await onSave (which opens), then onSaveAndPin, in one tick. */
function Editor() {
  const { open, openAndPin } = useOpenSavedQuestion();
  const save = async (pin: boolean) => {
    await Promise.resolve();
    open(saved);
    if (pin) openAndPin(saved);
  };
  return (
    <>
      <button type="button" onClick={() => void save(false)}>
        Save
      </button>
      <button type="button" onClick={() => void save(true)}>
        Save and pin
      </button>
    </>
  );
}

function Saved() {
  const location = useLocation();
  return <p>saved:{JSON.stringify(location.state)}</p>;
}

function renderEditor() {
  render(
    <MemoryRouter initialEntries={['/reports/question/new']}>
      <Routes>
        <Route path="/reports/question/new" element={<Editor />} />
        <Route path="/reports/question/:id" element={<Saved />} />
      </Routes>
    </MemoryRouter>
  );
  return userEvent.setup();
}

describe('useOpenSavedQuestion', () => {
  it('carries "add to dashboard" to the saved question page', async () => {
    const user = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Save and pin' }));
    expect(await screen.findByText('saved:{"openPinDialog":true}')).toBeInTheDocument();
  });

  it('just opens the page after a plain save', async () => {
    const user = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('saved:null')).toBeInTheDocument();
  });
});
