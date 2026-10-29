package repository

import "context"

// UpdatePingRepository persists aggregated anonymous update-check counts.
type UpdatePingRepository interface {
	// Record increments the counter for (day, version, build, clientType),
	// inserting the row on first sight. day is a UTC calendar day (YYYY-MM-DD).
	Record(ctx context.Context, day, version, build, clientType string) error

	// WeekKey rolls earlier weeks over (their sender totals are kept, their
	// key and hashes deleted) and returns the current week's hashing key,
	// storing newKey as that key if the week has none yet.
	WeekKey(ctx context.Context, week string, newKey []byte) ([]byte, error)
	// AddSender records one hashed sender for week; repeats are ignored.
	AddSender(ctx context.Context, week, sender string) error
	// WeeklyInstalls returns distinct senders per week for weeks >= sinceWeek,
	// oldest first: kept totals for past weeks, the live count for open ones.
	WeeklyInstalls(ctx context.Context, sinceWeek string) ([]WeeklyInstallCount, error)
	// VersionPings sums pings per version for clientType since sinceDay.
	VersionPings(ctx context.Context, sinceDay, clientType string) ([]VersionPingCount, error)
}

// WeeklyInstallCount is the number of distinct update-check senders in a week.
type WeeklyInstallCount struct {
	Week     string // Monday of the UTC week, YYYY-MM-DD
	Installs int
}

// VersionPingCount is the ping total for one version.
type VersionPingCount struct {
	Version string
	Pings   int
	Days    int
}
