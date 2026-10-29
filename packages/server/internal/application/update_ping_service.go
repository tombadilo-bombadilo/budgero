package application

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net"
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
	now  func() time.Time
}

// NewUpdatePingService creates a new UpdatePingService.
func NewUpdatePingService(repo repository.UpdatePingRepository) *UpdatePingService {
	return &UpdatePingService{repo: repo, now: time.Now}
}

var _ driving.UpdatePingService = (*UpdatePingService)(nil)

// Record counts one update check under today's UTC date. Unknown client types
// are silently dropped rather than erroring.
func (s *UpdatePingService) Record(ctx context.Context, version, build, clientType, senderIP string) error {
	clientType = strings.ToLower(strings.TrimSpace(clientType))
	if _, ok := validPingClientTypes[clientType]; !ok {
		return nil
	}

	version = sanitizePingToken(version, maxPingVersionLen)
	if version == "" {
		version = "unknown"
	}
	build = sanitizePingToken(build, maxPingBuildLen)

	now := s.now().UTC()
	if err := s.repo.Record(ctx, now.Format("2006-01-02"), version, build, clientType); err != nil {
		return err
	}
	if clientType == "selfhost" {
		return s.recordSender(ctx, now, senderIP)
	}
	return nil
}

// recordSender counts senderIP once for the current UTC week. The IP is
// hashed with that week's random key and never stored; the key and hashes
// are deleted when the week rolls over (see repository.WeekKey).
func (s *UpdatePingService) recordSender(ctx context.Context, now time.Time, senderIP string) error {
	ip := net.ParseIP(strings.TrimSpace(senderIP))
	if ip == nil {
		return nil
	}
	newKey := make([]byte, 32)
	if _, err := rand.Read(newKey); err != nil {
		return err
	}
	week := weekStart(now)
	key, err := s.repo.WeekKey(ctx, week, newKey)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(ip.String()))
	return s.repo.AddSender(ctx, week, hex.EncodeToString(mac.Sum(nil)[:16]))
}

// SelfHostSummary implements driving.UpdatePingService.
func (s *UpdatePingService) SelfHostSummary(ctx context.Context, weeks, days int) (driving.SelfHostInstallSummary, error) {
	now := s.now().UTC()
	current := weekStart(now)
	// Roll finished weeks over even when no ping has arrived since, so their
	// key and hashes don't linger. The fresh key is only kept if this is the
	// week's first use.
	newKey := make([]byte, 32)
	if _, err := rand.Read(newKey); err != nil {
		return driving.SelfHostInstallSummary{}, err
	}
	if _, err := s.repo.WeekKey(ctx, current, newKey); err != nil {
		return driving.SelfHostInstallSummary{}, err
	}

	since := weekStart(now.AddDate(0, 0, -7*(weeks-1)))
	counts, err := s.repo.WeeklyInstalls(ctx, since)
	if err != nil {
		return driving.SelfHostInstallSummary{}, err
	}
	out := driving.SelfHostInstallSummary{
		Weeks:    make([]driving.SelfHostWeek, 0, len(counts)),
		Versions: []driving.SelfHostVersionPing{},
		Days:     days,
	}
	for _, c := range counts {
		out.Weeks = append(out.Weeks, driving.SelfHostWeek{
			Week: c.Week, Installs: c.Installs, Partial: c.Week == current,
		})
	}

	sinceDay := now.AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	versions, err := s.repo.VersionPings(ctx, sinceDay, "selfhost")
	if err != nil {
		return driving.SelfHostInstallSummary{}, err
	}
	for _, v := range versions {
		out.Versions = append(out.Versions, driving.SelfHostVersionPing{
			Version: v.Version, Pings: v.Pings, Days: v.Days,
		})
	}
	return out, nil
}

// weekStart returns the Monday (UTC) of t's week as YYYY-MM-DD.
func weekStart(t time.Time) string {
	t = t.UTC()
	offset := (int(t.Weekday()) + 6) % 7 // Monday = 0
	return time.Date(t.Year(), t.Month(), t.Day()-offset, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
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
