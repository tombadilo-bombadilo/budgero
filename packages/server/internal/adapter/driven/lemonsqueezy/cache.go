package lemonsqueezy

import (
	"sync"
	"time"
)

// ProductCache caches LemonSqueezy products and variants
type ProductCache struct {
	products      []Product
	variants      []Variant
	lastFetch     time.Time
	cacheDuration time.Duration
	mu            sync.RWMutex
	client        *Client
}

// NewProductCache creates a new product cache
func NewProductCache(client *Client) *ProductCache {
	return &ProductCache{
		client:        client,
		cacheDuration: 5 * time.Minute,
	}
}

// GetProducts returns cached products or fetches new ones if cache is expired
func (pc *ProductCache) GetProducts() ([]Product, error) {
	pc.mu.RLock()
	if time.Since(pc.lastFetch) < pc.cacheDuration && len(pc.products) > 0 {
		products := pc.products
		pc.mu.RUnlock()
		return products, nil
	}
	pc.mu.RUnlock()

	return pc.refreshProducts()
}

// GetVariants returns cached variants or fetches new ones if cache is expired
func (pc *ProductCache) GetVariants() ([]Variant, error) {
	pc.mu.RLock()
	if time.Since(pc.lastFetch) < pc.cacheDuration && len(pc.variants) > 0 {
		variants := pc.variants
		pc.mu.RUnlock()
		return variants, nil
	}
	pc.mu.RUnlock()

	return pc.refreshVariants()
}

// fetchWithRetry calls fetch up to 3 times with exponential back-off sleep,
// returning the first successful result or the last error.
func fetchWithRetry[T any](fetch func() ([]T, error)) ([]T, error) {
	var result []T
	var err error

	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		result, err = fetch()
		if err == nil {
			return result, nil
		}
	}

	return nil, err
}

// refreshProducts fetches fresh products from LemonSqueezy with retry logic
func (pc *ProductCache) refreshProducts() ([]Product, error) {
	products, err := fetchWithRetry(pc.client.GetProducts)
	if err != nil {
		return nil, err
	}

	pc.mu.Lock()
	pc.products = products
	pc.lastFetch = time.Now()
	pc.mu.Unlock()
	return products, nil
}

// refreshVariants fetches fresh variants from LemonSqueezy with retry logic
func (pc *ProductCache) refreshVariants() ([]Variant, error) {
	variants, err := fetchWithRetry(pc.client.GetVariants)
	if err != nil {
		return nil, err
	}

	pc.mu.Lock()
	pc.variants = variants
	pc.lastFetch = time.Now()
	pc.mu.Unlock()
	return variants, nil
}

// Prefetch loads products and variants into cache
func (pc *ProductCache) Prefetch() error {
	_, err := pc.refreshProducts()
	if err != nil {
		return err
	}

	_, err = pc.refreshVariants()
	return err
}
