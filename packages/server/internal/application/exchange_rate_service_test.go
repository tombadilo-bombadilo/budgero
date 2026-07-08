package application_test

import (
	"context"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
)

func TestExchangeRateService_UpsertAndGetRate(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Upsert a rate
	err := svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)
	if err != nil {
		t.Fatalf("UpsertRate() error = %v", err)
	}

	// Get the rate
	rate, err := svc.GetRate(ctx, "USD", "EUR", "2024-01")
	if err != nil {
		t.Fatalf("GetRate() error = %v", err)
	}

	if rate != 0.85 {
		t.Errorf("GetRate() = %v, want 0.85", rate)
	}
}

func TestExchangeRateService_GetRate_NotFound(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Get non-existent rate
	rate, err := svc.GetRate(ctx, "USD", "EUR", "2024-01")
	if err != nil {
		t.Fatalf("GetRate() error = %v", err)
	}

	// Should return 0 for not found
	if rate != 0 {
		t.Errorf("GetRate() for missing rate = %v, want 0", rate)
	}
}

func TestExchangeRateService_UpsertRate_Updates(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Insert initial rate
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)

	// Update the rate
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.90)

	// Get updated rate
	rate, _ := svc.GetRate(ctx, "USD", "EUR", "2024-01")
	if rate != 0.90 {
		t.Errorf("GetRate() after update = %v, want 0.90", rate)
	}
}

func TestExchangeRateService_ListRates(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Add multiple rates for same base and month
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)
	_ = svc.UpsertRate(ctx, "USD", "GBP", "2024-01", 0.75)
	_ = svc.UpsertRate(ctx, "USD", "JPY", "2024-01", 148.50)
	// Different month should not be included
	_ = svc.UpsertRate(ctx, "USD", "CAD", "2024-02", 1.35)
	// Different base should not be included
	_ = svc.UpsertRate(ctx, "EUR", "GBP", "2024-01", 0.88)

	rates, err := svc.ListRates(ctx, "USD", "2024-01")
	if err != nil {
		t.Fatalf("ListRates() error = %v", err)
	}

	if len(rates) != 3 {
		t.Errorf("ListRates() returned %d rates, want 3", len(rates))
	}

	if rates["EUR"] != 0.85 {
		t.Errorf("rates[EUR] = %v, want 0.85", rates["EUR"])
	}
	if rates["GBP"] != 0.75 {
		t.Errorf("rates[GBP] = %v, want 0.75", rates["GBP"])
	}
	if rates["JPY"] != 148.50 {
		t.Errorf("rates[JPY] = %v, want 148.50", rates["JPY"])
	}
}

func TestExchangeRateService_ListRates_Empty(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	rates, err := svc.ListRates(ctx, "USD", "2024-01")
	if err != nil {
		t.Fatalf("ListRates() error = %v", err)
	}

	if len(rates) != 0 {
		t.Errorf("ListRates() for empty repo returned %d rates, want 0", len(rates))
	}
}

func TestExchangeRateService_DifferentMonths(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Same currency pair, different months
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-02", 0.86)
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-03", 0.84)

	// Each month should have its own rate
	rate1, _ := svc.GetRate(ctx, "USD", "EUR", "2024-01")
	rate2, _ := svc.GetRate(ctx, "USD", "EUR", "2024-02")
	rate3, _ := svc.GetRate(ctx, "USD", "EUR", "2024-03")

	if rate1 != 0.85 {
		t.Errorf("Jan rate = %v, want 0.85", rate1)
	}
	if rate2 != 0.86 {
		t.Errorf("Feb rate = %v, want 0.86", rate2)
	}
	if rate3 != 0.84 {
		t.Errorf("Mar rate = %v, want 0.84", rate3)
	}
}

func TestExchangeRateService_DifferentBaseCurrencies(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Different base currencies
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)
	_ = svc.UpsertRate(ctx, "GBP", "EUR", "2024-01", 1.15)
	_ = svc.UpsertRate(ctx, "CHF", "EUR", "2024-01", 1.05)

	// Each should be independent
	usdRate, _ := svc.GetRate(ctx, "USD", "EUR", "2024-01")
	gbpRate, _ := svc.GetRate(ctx, "GBP", "EUR", "2024-01")
	chfRate, _ := svc.GetRate(ctx, "CHF", "EUR", "2024-01")

	if usdRate != 0.85 {
		t.Errorf("USD->EUR rate = %v, want 0.85", usdRate)
	}
	if gbpRate != 1.15 {
		t.Errorf("GBP->EUR rate = %v, want 1.15", gbpRate)
	}
	if chfRate != 1.05 {
		t.Errorf("CHF->EUR rate = %v, want 1.05", chfRate)
	}

	// List rates for USD only
	usdRates, _ := svc.ListRates(ctx, "USD", "2024-01")
	if len(usdRates) != 1 {
		t.Errorf("USD rates count = %d, want 1", len(usdRates))
	}
}

func TestExchangeRateService_EdgeCaseRates(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	tests := []struct {
		name   string
		rate   float64
	}{
		{"very small rate", 0.0001},
		{"rate equals 1", 1.0},
		{"large rate", 1000.50},
		{"precise rate", 0.123456789},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_ = svc.UpsertRate(ctx, "USD", "TEST", "2024-01", tt.rate)
			got, _ := svc.GetRate(ctx, "USD", "TEST", "2024-01")
			if got != tt.rate {
				t.Errorf("Rate = %v, want %v", got, tt.rate)
			}
		})
	}
}

func TestExchangeRateService_SpecialCharactersInCurrencyCode(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Currency codes that might cause issues with key formatting
	_ = svc.UpsertRate(ctx, "BTC", "USD", "2024-01", 45000.0)
	_ = svc.UpsertRate(ctx, "ETH", "USD", "2024-01", 2500.0)

	btcRate, _ := svc.GetRate(ctx, "BTC", "USD", "2024-01")
	ethRate, _ := svc.GetRate(ctx, "ETH", "USD", "2024-01")

	if btcRate != 45000.0 {
		t.Errorf("BTC->USD rate = %v, want 45000.0", btcRate)
	}
	if ethRate != 2500.0 {
		t.Errorf("ETH->USD rate = %v, want 2500.0", ethRate)
	}
}

func TestExchangeRateService_YearBoundaries(t *testing.T) {
	ctx := context.Background()
	rateRepo := fake.NewExchangeRateRepository()
	svc := application.NewExchangeRateService(rateRepo)

	// Test across year boundaries
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2023-12", 0.91)
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.90)
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2024-12", 0.88)
	_ = svc.UpsertRate(ctx, "USD", "EUR", "2025-01", 0.87)

	rate2023_12, _ := svc.GetRate(ctx, "USD", "EUR", "2023-12")
	rate2024_01, _ := svc.GetRate(ctx, "USD", "EUR", "2024-01")
	rate2024_12, _ := svc.GetRate(ctx, "USD", "EUR", "2024-12")
	rate2025_01, _ := svc.GetRate(ctx, "USD", "EUR", "2025-01")

	if rate2023_12 != 0.91 {
		t.Errorf("2023-12 rate = %v, want 0.91", rate2023_12)
	}
	if rate2024_01 != 0.90 {
		t.Errorf("2024-01 rate = %v, want 0.90", rate2024_01)
	}
	if rate2024_12 != 0.88 {
		t.Errorf("2024-12 rate = %v, want 0.88", rate2024_12)
	}
	if rate2025_01 != 0.87 {
		t.Errorf("2025-01 rate = %v, want 0.87", rate2025_01)
	}
}
