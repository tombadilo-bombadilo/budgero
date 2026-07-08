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
