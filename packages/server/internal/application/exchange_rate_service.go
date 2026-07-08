package application

import (
	"context"

	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// ExchangeRateService implements driving.ExchangeRateService.
type ExchangeRateService struct {
	rateRepo repository.ExchangeRateRepository
}

// NewExchangeRateService creates a new ExchangeRateService.
func NewExchangeRateService(rateRepo repository.ExchangeRateRepository) *ExchangeRateService {
	return &ExchangeRateService{rateRepo: rateRepo}
}

var _ driving.ExchangeRateService = (*ExchangeRateService)(nil)

// GetRate returns the exchange rate between two currencies for a given month.
func (s *ExchangeRateService) GetRate(ctx context.Context, baseCurrency, targetCurrency, month string) (float64, error) {
	return s.rateRepo.GetRate(ctx, baseCurrency, targetCurrency, month)
}

// UpsertRate creates or updates an exchange rate for a currency pair and month.
func (s *ExchangeRateService) UpsertRate(ctx context.Context, baseCurrency, targetCurrency, month string, rate float64) error {
	return s.rateRepo.UpsertRate(ctx, baseCurrency, targetCurrency, month, rate)
}

// ListRates returns all exchange rates for a base currency and month.
func (s *ExchangeRateService) ListRates(ctx context.Context, baseCurrency, month string) (map[string]float64, error) {
	return s.rateRepo.ListRates(ctx, baseCurrency, month)
}
