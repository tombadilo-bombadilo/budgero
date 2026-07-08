package lemonsqueezy

import (
	"context"
	"fmt"
	"strings"
	"time"

	"budgero-server/internal/port/driven/external"
)

// DiscountIssuer wraps the LS Client and ProductCache to fulfill the
// external.DiscountIssuer port. The annual variant ID is resolved at call
// time from the cache (variants where Interval == "year" and IsSubscription
// is true).
type DiscountIssuer struct {
	client *Client
	cache  *ProductCache
}

// NewDiscountIssuer constructs a DiscountIssuer bound to the given client
// and product cache.
func NewDiscountIssuer(client *Client, cache *ProductCache) *DiscountIssuer {
	return &DiscountIssuer{client: client, cache: cache}
}

var _ external.DiscountIssuer = (*DiscountIssuer)(nil)

// IssueDiscount mints a single-redemption discount on the store's annual
// variant. The variantID parameter from the interface is ignored because
// the rewards system always targets the annual plan; we resolve which
// variant that is at runtime so deployments don't need to hardcode IDs.
func (d *DiscountIssuer) IssueDiscount(_ context.Context, code string, percentOff int, _ string, expiresAt time.Time) (string, error) {
	if d == nil || d.client == nil {
		return "", fmt.Errorf("discount issuer is not configured")
	}
	annualVariant, err := d.findAnnualVariant()
	if err != nil {
		return "", err
	}
	return d.client.CreateDiscount(code, percentOff, annualVariant.ID, expiresAt)
}

// RevokeDiscount deletes a discount from the LS store. No-op if externalID
// is empty (the discount was never registered with LS).
func (d *DiscountIssuer) RevokeDiscount(_ context.Context, externalID string) error {
	if externalID == "" {
		return nil
	}
	if d == nil || d.client == nil {
		return fmt.Errorf("discount issuer is not configured")
	}
	return d.client.DeleteDiscount(externalID)
}

func (d *DiscountIssuer) findAnnualVariant() (*Variant, error) {
	if d.cache == nil {
		return nil, fmt.Errorf("no product cache available to resolve annual variant")
	}
	variants, err := d.cache.GetVariants()
	if err != nil {
		return nil, fmt.Errorf("load variants: %w", err)
	}
	for i := range variants {
		v := &variants[i]
		if !v.IsSubscription {
			continue
		}
		if strings.EqualFold(v.Interval, "year") {
			return v, nil
		}
	}
	return nil, fmt.Errorf("no annual variant found in store catalog")
}
