-- name: GetExchangeRate :one
SELECT rate FROM exchange_rates
WHERE base_currency = ? AND target_currency = ? AND month = ?;

-- name: UpsertExchangeRate :exec
INSERT INTO exchange_rates (base_currency, target_currency, month, rate, updated_at)
VALUES (?, ?, ?, ?, datetime('now'))
ON CONFLICT(base_currency, target_currency, month) DO UPDATE SET
    rate = excluded.rate,
    updated_at = datetime('now');

-- name: ListExchangeRates :many
SELECT * FROM exchange_rates
WHERE base_currency = ? AND month = ?;
