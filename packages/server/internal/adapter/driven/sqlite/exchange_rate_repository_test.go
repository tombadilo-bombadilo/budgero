package sqlite_test

import (
	"context"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/testkit"
)

func TestExchangeRateRepository_UpsertRate(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewExchangeRateRepository(queries)
	ctx := context.Background()

	err := repo.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)
	if err != nil {
		t.Fatalf("UpsertRate() error = %v", err)
	}

	// Verify
	rate, err := repo.GetRate(ctx, "USD", "EUR", "2024-01")
	if err != nil {
		t.Fatalf("GetRate() error = %v", err)
	}
	if rate != 0.85 {
		t.Errorf("GetRate() = %v, want 0.85", rate)
	}
}

func TestExchangeRateRepository_UpsertRate_Update(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewExchangeRateRepository(queries)
	ctx := context.Background()

	// Create
	_ = repo.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.85)

	// Update
	err := repo.UpsertRate(ctx, "USD", "EUR", "2024-01", 0.90)
	if err != nil {
		t.Fatalf("UpsertRate() update error = %v", err)
	}

	rate, _ := repo.GetRate(ctx, "USD", "EUR", "2024-01")
	if rate != 0.90 {
		t.Errorf("GetRate() after update = %v, want 0.90", rate)
	}
}

func TestExchangeRateRepository_GetRate(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewExchangeRateRepository(queries)
	ctx := context.Background()

	testkit.SeedExchangeRate(t, queries, "EUR", "USD", "2024-02", 1.08)

	rate, err := repo.GetRate(ctx, "EUR", "USD", "2024-02")
	if err != nil {
		t.Fatalf("GetRate() error = %v", err)
	}
	if rate != 1.08 {
		t.Errorf("GetRate() = %v, want 1.08", rate)
	}
}

func TestExchangeRateRepository_GetRate_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewExchangeRateRepository(queries)
	ctx := context.Background()

	_, err := repo.GetRate(ctx, "USD", "JPY", "2024-01")
	if err == nil {
		t.Error("GetRate() error = nil, want error for not found")
	}
	if !strings.Contains(err.Error(), "rate not found") {
		t.Errorf("GetRate() error = %v, want 'rate not found' error", err)
	}
}

func TestExchangeRateRepository_ListRates(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewExchangeRateRepository(queries)
	ctx := context.Background()

	// Seed multiple rates for same base currency and month
	testkit.SeedExchangeRate(t, queries, "USD", "EUR", "2024-01", 0.85)
	testkit.SeedExchangeRate(t, queries, "USD", "GBP", "2024-01", 0.79)
	testkit.SeedExchangeRate(t, queries, "USD", "JPY", "2024-01", 148.5)
	// Different month - should not be included
	testkit.SeedExchangeRate(t, queries, "USD", "EUR", "2024-02", 0.86)

	rates, err := repo.ListRates(ctx, "USD", "2024-01")
	if err != nil {
		t.Fatalf("ListRates() error = %v", err)
	}
	if len(rates) != 3 {
		t.Errorf("ListRates() returned %d rates, want 3", len(rates))
	}

	if rates["EUR"] != 0.85 {
		t.Errorf("rates[EUR] = %v, want 0.85", rates["EUR"])
	}
	if rates["GBP"] != 0.79 {
		t.Errorf("rates[GBP] = %v, want 0.79", rates["GBP"])
	}
	if rates["JPY"] != 148.5 {
		t.Errorf("rates[JPY] = %v, want 148.5", rates["JPY"])
	}
}

func TestExchangeRateRepository_ListRates_Empty(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewExchangeRateRepository(queries)
	ctx := context.Background()

	rates, err := repo.ListRates(ctx, "XYZ", "2024-01")
	if err != nil {
		t.Fatalf("ListRates() error = %v", err)
	}
	if len(rates) != 0 {
		t.Errorf("ListRates() returned %d rates, want 0", len(rates))
	}
}
