import { useEffect } from 'react';

/**
 * Jump-to-transaction behavior: when a transaction id is stored in localStorage
 * (e.g. from navigating in from elsewhere), scroll to and briefly highlight the
 * corresponding row once it renders.
 */
export function useJumpToTransaction(transactionsLength: number) {
  useEffect(() => {
    const selectedTransactionId = localStorage.getItem('selectedTransactionId');
    if (!selectedTransactionId) return;
    const id = parseInt(selectedTransactionId);
    if (!id || Number.isNaN(id)) return;
    let attempts = 0;
    const tryFocus = () => {
      const row = document.getElementById(`transaction-${id}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('ring-2', 'ring-primary');
        setTimeout(() => row.classList.remove('ring-2', 'ring-primary'), 2000);
        localStorage.removeItem('selectedTransactionId');
        localStorage.removeItem('expandTransactionId');
      } else if (attempts < 20) {
        attempts += 1;
        setTimeout(tryFocus, 200);
      }
    };
    setTimeout(tryFocus, 100);
  }, [transactionsLength]);
}
