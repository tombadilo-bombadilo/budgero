package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/port/driven/repository"
)

// ExchangeRateRepository implements repository.ExchangeRateRepository using SQLite.
type ExchangeRateRepository struct {
	queries *sqlc.Queries
}

// NewExchangeRateRepository creates a new ExchangeRateRepository.
func NewExchangeRateRepository(queries *sqlc.Queries) *ExchangeRateRepository {
	return &ExchangeRateRepository{queries: queries}
}

var _ repository.ExchangeRateRepository = (*ExchangeRateRepository)(nil)

// GetRate retrieves the exchange rate between two currencies for a specific month.
func (r *ExchangeRateRepository) GetRate(ctx context.Context, baseCurrency, targetCurrency, month string) (float64, error) {
	rate, err := r.queries.GetExchangeRate(ctx, sqlc.GetExchangeRateParams{
		BaseCurrency:   baseCurrency,
		TargetCurrency: targetCurrency,
		Month:          month,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("rate not found for %s/%s in %s", baseCurrency, targetCurrency, month)
		}
		return 0, err
	}
	return rate, nil
}

// UpsertRate creates or updates an exchange rate for a currency pair and month.
func (r *ExchangeRateRepository) UpsertRate(ctx context.Context, baseCurrency, targetCurrency, month string, rate float64) error {
	return r.queries.UpsertExchangeRate(ctx, sqlc.UpsertExchangeRateParams{
		BaseCurrency:   baseCurrency,
		TargetCurrency: targetCurrency,
		Month:          month,
		Rate:           rate,
	})
}

// ListRates returns all exchange rates for a base currency in a specific month.
func (r *ExchangeRateRepository) ListRates(ctx context.Context, baseCurrency, month string) (map[string]float64, error) {
	rows, err := r.queries.ListExchangeRates(ctx, sqlc.ListExchangeRatesParams{
		BaseCurrency: baseCurrency,
		Month:        month,
	})
	if err != nil {
		return nil, err
	}

	rates := make(map[string]float64, len(rows))
	for _, row := range rows {
		rates[row.TargetCurrency] = row.Rate
	}
	return rates, nil
}
