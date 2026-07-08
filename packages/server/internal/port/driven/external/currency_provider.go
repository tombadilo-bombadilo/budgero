package external

import "context"

// CurrencyProvider defines methods for fetching exchange rates from external APIs.
type CurrencyProvider interface {
	// GetRates fetches exchange rates for a base currency on a specific date.
	// Returns a map of target currency codes to their rates.
	GetRates(ctx context.Context, baseCurrency string, date string) (map[string]float64, error)

	// GetRate fetches a specific exchange rate.
	GetRate(ctx context.Context, baseCurrency, targetCurrency, date string) (float64, error)
}
