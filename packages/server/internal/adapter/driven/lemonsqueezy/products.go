package lemonsqueezy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

// GetProducts fetches all products from the store
func (c *Client) GetProducts() ([]Product, error) {
	url := fmt.Sprintf("https://api.lemonsqueezy.com/v1/products?filter[store_id]=%s", c.storeID)

	req, err := http.NewRequest("GET", url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch products with status %d: %s", resp.StatusCode, string(body))
	}

	var productsResp struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				StoreID     int    `json:"store_id"`
				Name        string `json:"name"`
				Description string `json:"description"`
				Price       int    `json:"price"`
				Status      string `json:"status"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&productsResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	products := make([]Product, 0)
	for _, p := range productsResp.Data {
		if p.Attributes.Status == "published" {
			products = append(products, Product{
				ID:          p.ID,
				Name:        p.Attributes.Name,
				Description: p.Attributes.Description,
				Price:       p.Attributes.Price,
				StoreID:     p.Attributes.StoreID,
			})
		}
	}

	return products, nil
}

// GetVariants fetches all variants for the store's products
func (c *Client) GetVariants() ([]Variant, error) {
	variants := make([]Variant, 0)
	products, err := c.GetProducts()
	if err != nil {
		return nil, fmt.Errorf("failed to get products: %w", err)
	}

	if len(products) == 0 {
		return variants, nil
	}

	for _, product := range products {
		url := fmt.Sprintf("https://api.lemonsqueezy.com/v1/variants?filter[product_id]=%s&page[size]=100", product.ID)

		for url != "" {
			req, err := http.NewRequest("GET", url, http.NoBody)
			if err != nil {
				return nil, fmt.Errorf("failed to create request: %w", err)
			}

			req.Header.Set("Accept", "application/vnd.api+json")
			req.Header.Set("Authorization", "Bearer "+c.apiKey)

			resp, err := c.httpClient.Do(req)
			if err != nil {
				return nil, fmt.Errorf("failed to send request: %w", err)
			}

			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				return nil, fmt.Errorf("failed to fetch variants with status %d: %s", resp.StatusCode, string(body))
			}

			var variantsResp struct {
				Data []struct {
					ID         string `json:"id"`
					Attributes struct {
						ProductID      int    `json:"product_id"`
						Name           string `json:"name"`
						Description    string `json:"description"`
						Price          int    `json:"price"`
						PriceFormatted string `json:"price_formatted"`
						Interval       string `json:"interval"`
						IntervalCount  int    `json:"interval_count"`
						IsSubscription bool   `json:"is_subscription"`
						Status         string `json:"status"`
						Sort           int    `json:"sort"`
					} `json:"attributes"`
				} `json:"data"`
				Links struct {
					Next *string `json:"next"`
				} `json:"links"`
			}

			if err := json.NewDecoder(resp.Body).Decode(&variantsResp); err != nil {
				_ = resp.Body.Close()
				return nil, fmt.Errorf("failed to decode response: %w", err)
			}
			_ = resp.Body.Close()

			for i := range variantsResp.Data {
				v := &variantsResp.Data[i]
				if v.Attributes.Status != "published" {
					continue
				}

				priceFormatted := v.Attributes.PriceFormatted
				if priceFormatted == "" {
					dollars := float64(v.Attributes.Price) / 100
					priceFormatted = fmt.Sprintf("$%.2f", dollars)
				}

				variants = append(variants, Variant{
					ID:             v.ID,
					ProductID:      v.Attributes.ProductID,
					Name:           v.Attributes.Name,
					Description:    v.Attributes.Description,
					Price:          v.Attributes.Price,
					PriceFormatted: priceFormatted,
					Interval:       v.Attributes.Interval,
					IntervalCount:  v.Attributes.IntervalCount,
					IsSubscription: v.Attributes.IsSubscription,
					Sort:           v.Attributes.Sort,
				})
			}

			if variantsResp.Links.Next != nil && *variantsResp.Links.Next != "" {
				url = *variantsResp.Links.Next
			} else {
				url = ""
			}
		}
	}

	// Sort variants by their sort order
	for i := 0; i < len(variants)-1; i++ {
		for j := i + 1; j < len(variants); j++ {
			if variants[i].Sort > variants[j].Sort {
				variants[i], variants[j] = variants[j], variants[i]
			}
		}
	}

	return variants, nil
}

// GetCustomers fetches all customers for the store
func (c *Client) GetCustomers() ([]Customer, error) {
	customers := make([]Customer, 0)
	url := "https://api.lemonsqueezy.com/v1/customers?page[size]=100"

	for url != "" {
		req, err := http.NewRequest("GET", url, http.NoBody)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Accept", "application/vnd.api+json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to send request: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			return nil, fmt.Errorf("failed to fetch customers with status %d: %s", resp.StatusCode, string(body))
		}

		var customersResp struct {
			Data []struct {
				ID         string `json:"id"`
				Attributes struct {
					StoreID                      int         `json:"store_id"`
					Name                         string      `json:"name"`
					Email                        string      `json:"email"`
					MonthlyRecurringRevenueCents int         `json:"monthly_recurring_revenue_cents"`
					TotalRevenueCents            int         `json:"total_revenue_cents"`
					TotalRevenueCurrency         interface{} `json:"total_revenue_currency"`
				} `json:"attributes"`
			} `json:"data"`
			Links struct {
				Next *string `json:"next"`
			} `json:"links"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&customersResp); err != nil {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("failed to decode response: %w", err)
		}
		_ = resp.Body.Close()

		for _, cust := range customersResp.Data {
			if c.storeID != "" {
				if storeID, err := strconv.Atoi(c.storeID); err == nil {
					if cust.Attributes.StoreID != storeID {
						continue
					}
				}
			}

			customer := Customer{ID: cust.ID}
			customer.Attributes.StoreID = cust.Attributes.StoreID
			customer.Attributes.Name = cust.Attributes.Name
			customer.Attributes.Email = cust.Attributes.Email
			customer.Attributes.MonthlyRecurringRevenueCents = cust.Attributes.MonthlyRecurringRevenueCents
			customer.Attributes.TotalRevenueCents = cust.Attributes.TotalRevenueCents
			customer.Attributes.TotalRevenueCurrency = cust.Attributes.TotalRevenueCurrency
			customers = append(customers, customer)
		}

		if customersResp.Links.Next != nil && *customersResp.Links.Next != "" {
			url = *customersResp.Links.Next
		} else {
			url = ""
		}
	}

	return customers, nil
}

// GetVariantByID fetches a single variant by its ID
func (c *Client) GetVariantByID(variantID int) (*Variant, error) {
	url := fmt.Sprintf("https://api.lemonsqueezy.com/v1/variants/%d", variantID)

	req, err := http.NewRequest("GET", url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch variant with status %d: %s", resp.StatusCode, string(body))
	}

	var variantResp struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				ProductID      int    `json:"product_id"`
				Name           string `json:"name"`
				Description    string `json:"description"`
				Price          int    `json:"price"`
				PriceFormatted string `json:"price_formatted"`
				Interval       string `json:"interval"`
				IntervalCount  int    `json:"interval_count"`
				IsSubscription bool   `json:"is_subscription"`
				Sort           int    `json:"sort"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&variantResp); err != nil {
		return nil, fmt.Errorf("failed to decode variant response: %w", err)
	}

	attributes := variantResp.Data.Attributes
	priceFormatted := attributes.PriceFormatted
	if priceFormatted == "" {
		dollars := float64(attributes.Price) / 100
		priceFormatted = fmt.Sprintf("$%.2f", dollars)
	}

	variant := &Variant{
		ID:             variantResp.Data.ID,
		ProductID:      attributes.ProductID,
		Name:           attributes.Name,
		Description:    attributes.Description,
		Price:          attributes.Price,
		PriceFormatted: priceFormatted,
		Interval:       attributes.Interval,
		IntervalCount:  attributes.IntervalCount,
		IsSubscription: attributes.IsSubscription,
		Sort:           attributes.Sort,
	}

	return variant, nil
}
