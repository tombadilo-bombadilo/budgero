package repository

import "context"

// ExchangeRateRepository defines methods for exchange rate persistence.
type ExchangeRateRepository interface {
	// GetRate gets the exchange rate for a currency pair and month.
	GetRate(ctx context.Context, baseCurrency, targetCurrency, month string) (float64, error)

	// UpsertRate inserts or updates an exchange rate.
	UpsertRate(ctx context.Context, baseCurrency, targetCurrency, month string, rate float64) error

	// ListRates lists all exchange rates for a base currency and month.
	ListRates(ctx context.Context, baseCurrency, month string) (map[string]float64, error)
}
