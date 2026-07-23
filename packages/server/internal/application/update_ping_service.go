package application

import (
	"context"
	"strings"
	"time"

	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// The endpoint feeding this service is public and unauthenticated, so inputs
// are clamped hard: unknown client types are dropped, and version/build are
// reduced to short, character-restricted tokens so junk traffic can't grow
// the table beyond a handful of rows per day.
const (
	maxPingVersionLen = 32
	maxPingBuildLen   = 64
)

var validPingClientTypes = map[string]struct{}{
	"selfhost": {},
	"saas":     {},
}

// UpdatePingService implements driving.UpdatePingService.
type UpdatePingService struct {
	repo repository.UpdatePingRepository
}

// NewUpdatePingService creates a new UpdatePingService.
func NewUpdatePingService(repo repository.UpdatePingRepository) *UpdatePingService {
	return &UpdatePingService{repo: repo}
}

var _ driving.UpdatePingService = (*UpdatePingService)(nil)

// Record counts one update check under today's UTC date. Unknown client types
// are silently dropped rather than erroring.
func (s *UpdatePingService) Record(ctx context.Context, version, build, clientType string) error {
	clientType = strings.ToLower(strings.TrimSpace(clientType))
	if _, ok := validPingClientTypes[clientType]; !ok {
		return nil
	}

	version = sanitizePingToken(version, maxPingVersionLen)
	if version == "" {
		version = "unknown"
	}
	build = sanitizePingToken(build, maxPingBuildLen)

	day := time.Now().UTC().Format("2006-01-02")
	return s.repo.Record(ctx, day, version, build, clientType)
}

// sanitizePingToken keeps only version-ish characters and truncates, so
// arbitrary strings on the public endpoint can't be persisted verbatim.
func sanitizePingToken(s string, maxLen int) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		switch {
		case r >= '0' && r <= '9',
			r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r == '.', r == '-', r == '+', r == '_':
			b.WriteRune(r)
		}
		if b.Len() >= maxLen {
			break
		}
	}
	return b.String()
}
