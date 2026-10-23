import { describe, it } from 'vitest';
import { loadObservedCases, verifyObservedSnapshot } from './ynab-observed.helpers.js';

// Captured from a disposable YNAB trial plan on 2026-10-23 (see the fixture's _source).
// 01-04 #67: card A -> PayPal cash advance, PayPal purchase, then assignments.
// 05-08 #69: card-to-card balance transfer, funded (A/B) and unfunded (C/D) debt.
// 09-14 #68: card refund later spent from checking (E) or moved to another category (F).
const cases = loadObservedCases(
  new URL('./test-data/ynab-cc-transfers-repro.json', import.meta.url)
);

describe('YNAB-observed card transfers, cash advances and later refunds', () => {
  for (const { name, snapshot } of cases) {
    it(name, () => verifyObservedSnapshot(name, snapshot));
  }
});
