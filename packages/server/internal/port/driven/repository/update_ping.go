package repository

import "context"

// UpdatePingRepository persists aggregated anonymous update-check counts.
type UpdatePingRepository interface {
	// Record increments the counter for (day, version, build, clientType),
	// inserting the row on first sight. day is a UTC calendar day (YYYY-MM-DD).
	Record(ctx context.Context, day, version, build, clientType string) error
}
