package application

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/port/driven/external"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// AnalyticsOptions tunes the analytics queue. Zero values use the defaults.
type AnalyticsOptions struct {
	QueueSize     int           // default 1024
	BatchSize     int           // default 50
	FlushInterval time.Duration // default 10s
	SendTimeout   time.Duration // default 5s
	OptOutTTL     time.Duration // default 10m
}

func (o AnalyticsOptions) withDefaults() AnalyticsOptions {
	if o.QueueSize <= 0 {
		o.QueueSize = 1024
	}
	if o.BatchSize <= 0 {
		o.BatchSize = 50
	}
	if o.FlushInterval <= 0 {
		o.FlushInterval = 10 * time.Second
	}
	if o.SendTimeout <= 0 {
		o.SendTimeout = 5 * time.Second
	}
	if o.OptOutTTL <= 0 {
		o.OptOutTTL = 10 * time.Minute
	}
	return o
}

type queuedEvent struct {
	userID string
	event  analytics.Event
	at     time.Time
}

type optOutEntry struct {
	disabled bool
	at       time.Time
}

// maxOptOutEntries bounds the opt-out cache; it is cleared when full.
const maxOptOutEntries = 10000

// AnalyticsService implements driving.AnalyticsTracker on top of an
// external.AnalyticsSender. Track only does a non-blocking channel send; a
// single worker batches events, drops those of opted-out users (looked up
// off the request path and cached) and ships them with a bounded timeout.
type AnalyticsService struct {
	sender  external.AnalyticsSender
	users   repository.UserRepository
	opts    AnalyticsOptions
	enabled bool

	queue   chan queuedEvent
	stop    chan struct{}
	done    chan struct{}
	closeMu sync.Once

	cacheMu sync.Mutex
	optOut  map[string]optOutEntry

	dropped atomic.Int64
	now     func() time.Time
}

var _ driving.AnalyticsTracker = (*AnalyticsService)(nil)

// NewAnalyticsService builds the tracker. A nil or disabled sender gives a
// tracker that drops everything without starting a worker.
func NewAnalyticsService(sender external.AnalyticsSender, users repository.UserRepository, opts AnalyticsOptions) *AnalyticsService {
	s := &AnalyticsService{
		sender: sender,
		users:  users,
		opts:   opts.withDefaults(),
		optOut: map[string]optOutEntry{},
		now:    time.Now,
		done:   make(chan struct{}),
	}
	s.enabled = sender != nil && sender.Enabled()
	if !s.enabled {
		close(s.done)
		return s
	}
	s.queue = make(chan queuedEvent, s.opts.QueueSize)
	s.stop = make(chan struct{})
	go s.run()
	return s
}

// Enabled reports whether events leave the server.
func (s *AnalyticsService) Enabled() bool { return s != nil && s.enabled }

// Track queues an event; it never blocks.
func (s *AnalyticsService) Track(userID string, event analytics.Event) {
	if !s.Enabled() || userID == "" || !event.Valid() {
		return
	}
	select {
	case <-s.stop:
		return
	default:
	}
	select {
	case s.queue <- queuedEvent{userID: userID, event: event, at: s.now()}:
	default:
		s.dropped.Add(1)
	}
}

// Dropped returns how many events were discarded because the queue was full.
func (s *AnalyticsService) Dropped() int64 { return s.dropped.Load() }

// SetOptOut records a fresh opt-out flag so the next flush honors it.
func (s *AnalyticsService) SetOptOut(userID string, disabled bool) {
	if !s.Enabled() || userID == "" {
		return
	}
	s.cacheMu.Lock()
	s.putLocked(userID, disabled)
	s.cacheMu.Unlock()
}

// Close stops accepting events, flushes what is queued and waits for the worker.
func (s *AnalyticsService) Close() {
	if !s.Enabled() {
		return
	}
	s.closeMu.Do(func() { close(s.stop) })
	<-s.done
}

func (s *AnalyticsService) run() {
	defer close(s.done)
	ticker := time.NewTicker(s.opts.FlushInterval)
	defer ticker.Stop()
	batch := make([]queuedEvent, 0, s.opts.BatchSize)
	for {
		select {
		case ev := <-s.queue:
			batch = append(batch, ev)
			if len(batch) >= s.opts.BatchSize {
				s.flush(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				s.flush(batch)
				batch = batch[:0]
			}
		case <-s.stop:
			for {
				select {
				case ev := <-s.queue:
					batch = append(batch, ev)
					if len(batch) >= s.opts.BatchSize {
						s.flush(batch)
						batch = batch[:0]
					}
				default:
					if len(batch) > 0 {
						s.flush(batch)
					}
					return
				}
			}
		}
	}
}

func (s *AnalyticsService) flush(batch []queuedEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), s.opts.SendTimeout)
	defer cancel()
	out := make([]external.AnalyticsEvent, 0, len(batch))
	for _, q := range batch {
		if s.isOptedOut(ctx, q.userID) {
			continue
		}
		out = append(out, external.AnalyticsEvent{
			Name:       q.event.Name(),
			DistinctID: q.userID,
			Properties: q.event.Properties(),
			Timestamp:  q.at,
		})
	}
	if len(out) == 0 {
		return
	}
	if err := s.sender.Send(ctx, out); err != nil {
		log.Warn().Err(err).Int("events", len(out)).Msg("analytics batch dropped")
	}
}

// isOptedOut reads the cached flag, falling back to one user lookup. Any
// lookup failure counts as opted out: when in doubt, send nothing.
func (s *AnalyticsService) isOptedOut(ctx context.Context, userID string) bool {
	now := s.now()
	s.cacheMu.Lock()
	entry, ok := s.optOut[userID]
	s.cacheMu.Unlock()
	if ok && now.Sub(entry.at) < s.opts.OptOutTTL {
		return entry.disabled
	}
	if s.users == nil {
		return true
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil || user == nil {
		return true
	}
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	// SetOptOut may have landed while we were reading; the newer value wins.
	if newer, ok := s.optOut[userID]; ok && !newer.at.Before(now) {
		return newer.disabled
	}
	s.putLocked(userID, user.IsAnalyticsDisabled)
	return user.IsAnalyticsDisabled
}

func (s *AnalyticsService) putLocked(userID string, disabled bool) {
	if len(s.optOut) >= maxOptOutEntries {
		s.optOut = map[string]optOutEntry{}
	}
	s.optOut[userID] = optOutEntry{disabled: disabled, at: s.now()}
}
