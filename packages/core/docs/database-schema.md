# Database Schema

This document summarizes the logical schema created by the migrations in `src/database/migrations.ts`.

## Core Tables

- budgets
  - id INTEGER PK AUTOINCREMENT
  - name TEXT NOT NULL
  - display_currency TEXT NOT NULL
  - badge_icon TEXT NOT NULL
  - number_format TEXT NOT NULL

- category_groups
  - id INTEGER PK AUTOINCREMENT
  - name TEXT NOT NULL
  - note TEXT NOT NULL DEFAULT ''
  - budget_id INTEGER NOT NULL → budgets(id) ON DELETE CASCADE ON UPDATE CASCADE

- categories
  - id INTEGER PK AUTOINCREMENT
  - name TEXT NOT NULL
  - note TEXT NOT NULL DEFAULT ''
  - category_group_id INTEGER NOT NULL → category_groups(id) CASCADE
  - budget_id INTEGER NOT NULL → budgets(id) CASCADE
  - exclude_from_budget_pace BOOLEAN DEFAULT FALSE (v2)

- goals
  - id INTEGER PK AUTOINCREMENT
  - type TEXT NOT NULL
  - category_id INTEGER NOT NULL UNIQUE → categories(id) CASCADE
  - target REAL NOT NULL
  - start_date TEXT NOT NULL
  - target_date TEXT NOT NULL DEFAULT '1970-01-01'

- accounts
  - id INTEGER PK AUTOINCREMENT
  - name TEXT NOT NULL
  - currency TEXT NOT NULL
  - type TEXT NOT NULL
  - reconciled_at DATE
  - balance REAL NOT NULL DEFAULT 0.0
  - balance_converted REAL DEFAULT NULL
  - budget_id INTEGER NOT NULL → budgets(id) CASCADE
  - metadata TEXT (v3)
  - on_budget BOOLEAN NOT NULL DEFAULT TRUE (v4)

- transactions
  - id INTEGER PK AUTOINCREMENT
  - category_id INTEGER NOT NULL → categories(id) CASCADE
  - account_id INTEGER NOT NULL → accounts(id) CASCADE
  - transfer_id TEXT DEFAULT NULL (used for paired transfers/splits)
  - date TEXT NOT NULL (ISO string), month TEXT GENERATED ALWAYS AS (substr(date, 1, 7)) STORED
  - memo TEXT NOT NULL DEFAULT ''
  - reconciled BOOLEAN NOT NULL DEFAULT FALSE
  - inflow REAL NOT NULL DEFAULT 0.0
  - outflow REAL NOT NULL DEFAULT 0.0
  - inflow_original REAL DEFAULT NULL
  - outflow_original REAL DEFAULT NULL
  - running_balance REAL DEFAULT 0.0
  - running_balance_original REAL DEFAULT NULL
  - budget_id INTEGER NOT NULL → budgets(id) CASCADE

- currency_rates
  - id INTEGER PK AUTOINCREMENT
  - from_currency TEXT NOT NULL
  - to_currency TEXT NOT NULL
  - rate REAL NOT NULL
  - month TEXT NOT NULL
  - last_updated TEXT NOT NULL
  - budget_id INTEGER NOT NULL → budgets(id) CASCADE
  - UNIQUE(from_currency, to_currency, month, budget_id)

- assignments
  - id INTEGER PK AUTOINCREMENT
  - category_id INTEGER NOT NULL → categories(id) CASCADE
  - amount REAL NOT NULL
  - month TEXT NOT NULL
  - budget_id INTEGER NOT NULL → budgets(id) CASCADE

- saved_reports (v5)
  - id TEXT PRIMARY KEY
  - name TEXT NOT NULL UNIQUE
  - description TEXT
  - query TEXT NOT NULL
  - charts TEXT DEFAULT '[]'
  - created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  - updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  - tags TEXT DEFAULT '[]'
  - is_favorite BOOLEAN DEFAULT FALSE

- transaction_splits (v8)
  - id INTEGER PK AUTOINCREMENT
  - transaction_id INTEGER NOT NULL → transactions(id) CASCADE
  - category_id INTEGER NULL → categories(id) SET NULL
  - transfer_account_id INTEGER NULL → accounts(id) SET NULL
  - memo TEXT NOT NULL DEFAULT ''
  - inflow REAL NOT NULL DEFAULT 0.0
  - outflow REAL NOT NULL DEFAULT 0.0
  - inflow_original REAL DEFAULT NULL
  - outflow_original REAL DEFAULT NULL
  - pair_id TEXT DEFAULT NULL
  - order_index INTEGER NOT NULL DEFAULT 0

## Indexes (selected)

- transactions: idx_transactions_month_category, idx_transactions_account_date, idx_transactions_budget_date, idx_transactions_category_date
- currency_rates: idx_currency_rates_lookup, idx_currency_rates_budget_month
- goals: idx_goals_category_id
- assignments: idx_assignments_category_month, idx_assignments_budget_month

## Notes

- Migrations enable foreign keys and enforce cascading deletes.
- `month` is derived from `date` for fast monthly aggregations.
- Multi-currency handling stores both original and converted amounts to the budget currency.
