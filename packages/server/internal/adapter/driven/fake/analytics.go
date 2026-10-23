package fake

import (
	"context"
	"sync"

	"budgero-server/internal/port/driven/external"
)

var _ external.AnalyticsSender = (*AnalyticsSender)(nil)

// AnalyticsSender records batches in memory. Set Gate to make Send block
// until the channel is closed (or ctx ends), to simulate a slow backend.
type AnalyticsSender struct {
	Disabled bool
	Gate     chan struct{}

	mu      sync.Mutex
	batches [][]external.AnalyticsEvent
}

// Enabled reports !Disabled.
func (s *AnalyticsSender) Enabled() bool { return !s.Disabled }

// Send records the batch.
func (s *AnalyticsSender) Send(ctx context.Context, events []external.AnalyticsEvent) error {
	if s.Gate != nil {
		select {
		case <-s.Gate:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	cp := append([]external.AnalyticsEvent(nil), events...)
	s.mu.Lock()
	s.batches = append(s.batches, cp)
	s.mu.Unlock()
	return nil
}

// Events returns every recorded event in send order.
func (s *AnalyticsSender) Events() []external.AnalyticsEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []external.AnalyticsEvent
	for _, b := range s.batches {
		out = append(out, b...)
	}
	return out
}

// Batches returns how many Send calls were recorded.
func (s *AnalyticsSender) Batches() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.batches)
}
