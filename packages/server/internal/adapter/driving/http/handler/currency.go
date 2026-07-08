package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

type currencyLayerResponse struct {
	Success   bool                   `json:"success"`
	Source    string                 `json:"source"`
	Timestamp int64                  `json:"timestamp"`
	Quotes    map[string]float64     `json:"quotes"`
	Error     map[string]interface{} `json:"error,omitempty"`
}

// GetExchangeRates proxies and caches exchange rates.
// Query params:
// - base: base currency (e.g., USD)
// - symbols: comma-separated list of target currencies (e.g., EUR,GBP)
// - month: YYYY-MM for monthly caching
func (h *Handlers) GetExchangeRates(c echo.Context) error {
	base := strings.ToUpper(c.QueryParam("base"))
	symbolsParam := c.QueryParam("symbols")
	month := c.QueryParam("month")

	if base == "" || symbolsParam == "" || month == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "base, symbols and month are required",
		})
	}

	symbols := make([]string, 0)
	for _, s := range strings.Split(symbolsParam, ",") {
		s = strings.TrimSpace(strings.ToUpper(s))
		if s != "" && s != base {
			symbols = append(symbols, s)
		}
	}
	if len(symbols) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "no valid symbols provided",
		})
	}

	ctx := c.Request().Context()

	// Load any cached rates
	quotes := make(map[string]float64)
	missing := make([]string, 0)
	for _, sym := range symbols {
		rate, err := h.services.ExchangeRate.GetRate(ctx, base, sym, month)
		if err == nil {
			quotes[base+sym] = rate
			continue
		}
		missing = append(missing, sym)
	}

	// If anything is missing, fetch from CurrencyLayer
	if len(missing) > 0 {
		apiKey := h.cfg.External.CurrencyLayerAPIKey
		if apiKey == "" {
			log.Error().Msg("CURRENCYLAYER_API_KEY not set")
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "currency provider not configured"})
		}

		// Determine endpoint based on month being current or not
		isCurrentMonth := month == time.Now().UTC().Format("2006-01")
		endpoint := "historical"
		dateParam := fmt.Sprintf("&date=%s-01", month)
		if isCurrentMonth {
			endpoint = "live"
			dateParam = ""
		}

		url := fmt.Sprintf(
			"https://api.currencylayer.com/%s?access_key=%s&source=%s&currencies=%s%s",
			endpoint,
			apiKey,
			base,
			strings.Join(missing, ","),
			dateParam,
		)

		resp, err := http.Get(url) //nolint:gosec // G107: URL is constructed from trusted exchange rate API
		if err != nil {
			log.Error().Err(err).Msg("failed fetching exchange rates")
			return c.JSON(http.StatusBadGateway, map[string]string{"error": "failed to fetch rates"})
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			log.Error().Int("status", resp.StatusCode).Msg("currency provider non-200")
			return c.JSON(http.StatusBadGateway, map[string]string{"error": "currency provider error"})
		}

		var provider currencyLayerResponse
		if err := json.NewDecoder(resp.Body).Decode(&provider); err != nil {
			log.Error().Err(err).Msg("failed decoding provider response")
			return c.JSON(http.StatusBadGateway, map[string]string{"error": "invalid provider response"})
		}

		if !provider.Success && len(provider.Error) > 0 {
			log.Warn().Interface("error", provider.Error).Msg("provider returned error")
			return c.JSON(http.StatusBadGateway, map[string]interface{}{"error": provider.Error})
		}

		// Upsert fetched rates into cache and merge into quotes
		for _, sym := range missing {
			key := base + sym
			if r, ok := provider.Quotes[key]; ok {
				// store base->sym
				if err := h.services.ExchangeRate.UpsertRate(ctx, base, sym, month, r); err != nil {
					log.Error().Err(err).Msg("failed upserting exchange rate")
				}
				quotes[key] = r
				// also store inverse for convenience
				if err := h.services.ExchangeRate.UpsertRate(ctx, sym, base, month, 1.0/r); err != nil {
					log.Warn().Err(err).Msg("failed upserting inverse exchange rate")
				}
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":   true,
		"source":    base,
		"timestamp": time.Now().Unix(),
		"quotes":    quotes,
	})
}
