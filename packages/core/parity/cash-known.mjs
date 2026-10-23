// Open model deviations the cash-conservation check (cash-invariant.mjs)
// tolerates. Each key adds a term that mirrors the bug from SQL; the fuzz,
// run.mjs and the expected-to-fail tests in cash-conservation.node.spec.ts all
// read this list. When a fix merges, delete its key: the tests marked
// expected-to-fail then fail until they are flipped, and the fuzz holds the
// model to the reference again.
export const KNOWN_DEVIATIONS = [
  // GitHub #69: card -> card (and loan / mortgage -> card) transfers count as CC payments
  '#69',
  // GitHub #68: refund of a funded card purchase in a later month, then spent from
  // cash or moved out, is charged as cash overspend (monthly)
  '#68',
  // GitHub #67: card -> on-budget cash transfer (cash advance) does not raise RTA
  '#67',
  // #68 side finding: cumulative CC Payment funding uses gross card outflows
  // (refunds not netted), so a refunded purchase stays funded
  '#68-cumulative',
  // Not filed yet (found by this check, see the report):
  // monthly: a refund of an unfunded purchase that funds a later card purchase is never charged
  'phantomLeak',
  // monthly: card -> off-budget transfer deducts the card's positive part twice
  'cardPositiveToOffBudget',
  // both modes: a split line transferring to an off-budget account never leaves RTA
  'splitTransferOffBudget',
];
