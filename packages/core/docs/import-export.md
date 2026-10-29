# Import/Export Guide

## Import
Folder: `src/services/import/`

Components:
- csv-parser.ts / currency-parser.ts
  - Helpers for parsing import text and currency values.
- ynab-import-service.ts
  - Read YNAB-style exports and map to core entities.

Typical Flow:
1) Parse import payloads (currently YNAB ZIP flows in core).
2) Normalize fields (date, amount, currency).
3) Map to target budget/account/category and insert via TransactionService.

Considerations:
- Idempotency: guard against duplicate imports with source keys (e.g., transfer_id or pair_id).
- Currency: ensure original vs converted amounts are stored when currency differs from budget.

## Export
Folder: `src/services/export/`

Components:
- index.ts (export helpers)
  - CSV generation for budgets/transactions.
  - Report scaffolding for PDF/YNAB where applicable.

Typical Flow:
1) Query via service(s) for the required dataset.
2) Format to CSV/JSON suitable for downstream consumers.
3) (Optional) Generate PDF report in app/server layer using exported data.

Notes:
- Export is pure data formatting here; actual file I/O, PDF rendering, or file downloads are handled by the app/server packages.
- Keep column order and headers stable for external compatibility.

## Statement duplicate detection

CSV, PDF, OFX/QFX, QIF, and CAMT share an account-scoped review step. Exact
file-row identities and reliable bank IDs are skipped by default. Other rows
with the same native amount, direction, currency, and date need an explicit
Match, Skip or Import as new decision. Statement files also pass the
duplicate-hint tolerance (`plan(rows, { tolerance })`, user_meta amount bps and
day window): rows with no exact match are paired one to one with hand-entered,
unreconciled transactions inside it (nearest date, closest amount, same payee).
`suggestMatch` marks a row whose only candidate is such a transaction; the
wizard then defaults it to Match, which records the identity
(`importHistory.match`) and sets the transaction cleared, inside the import's
undo group. Bank sync and Push API use the same rule through
`ImportDuplicateService.manualMatches(query, tolerance())`: bank rows that fit a
hand entry become bank reviews; a pushed plain `transactions.add` that fits
becomes a review too (`BankSyncService.reviewForPushed`), keeping the pushed
args in `identity.pushArgs` so "Add as new" replays them. Pushed transfers and
splits are added directly. Similar rows inside one file are reviewed;
identical legitimate purchases are preserved. Every row is accessible through
pagination and filters.

`ImportDuplicateService` keeps immutable source identities in
`import_provenance`, independently of import-history retention. Transaction
creation and provenance insertion share one SQLite transaction, after currency
resolution. An operation ID makes retries idempotent; intentional additional
imports use new operation IDs. Deleting a transaction cascades its identities;
transaction undo snapshots restore them. A reviewed skip may attach an identity
to an existing transaction without changing its ledger fields or making it part
of import-run undo.

The wizard rechecks the preview before writing and checkpoints import history,
including separate invalid, skipped, and failed counts. Old transactions without
provenance remain possible matches. YNAB migration and bank sync are unchanged.
Matching is local: simultaneous imports on disconnected devices cannot be
prevented by this check.
