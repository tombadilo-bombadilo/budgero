// Open model deviations the cash-conservation check (cash-invariant.mjs)
// tolerates. Each key adds a term that mirrors the bug from SQL; the fuzz,
// run.mjs and the expected-to-fail tests in cash-conservation.node.spec.ts all
// read this list. When a fix merges, delete its key: the tests marked
// expected-to-fail then fail until they are flipped, and the fuzz holds the
// model to the reference again.
export const KNOWN_DEVIATIONS = [
  // Not filed yet (found by this check, see the report):
  // monthly: a refund of an unfunded purchase that funds a later card purchase is never charged
  'phantomLeak',
  // monthly: card -> off-budget transfer deducts the card's positive part twice
  'cardPositiveToOffBudget',
  // both modes: a split line transferring to an off-budget account never leaves RTA
  'splitTransferOffBudget',
];
