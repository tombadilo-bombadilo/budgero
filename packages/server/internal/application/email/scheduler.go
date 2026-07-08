package email

import (
	"context"
	"time"

	"budgero-server/internal/strutil"

	"github.com/rs/zerolog/log"
)

// SchedulerInterval is how often the loop scans for due emails. Short enough
// to hit the 72h / 48h windows with reasonable precision, long enough to
// keep the load on SQLite negligible.
const SchedulerInterval = 10 * time.Minute

// welcomeCatchupLookback is how far back the welcome-retry pass looks.
// Inline sends at signup cover the happy path; this backstops failures.
// 24h is more than enough slack for the 10-minute tick to catch up.
const welcomeCatchupLookback = 24 * time.Hour

// Scheduler drives the delayed email flows. It does not fire the welcome
// email on signup — that's an inline call at user creation. The scheduler
// only retries welcomes that failed to send the first time, and runs the
// inactivity + trial-ended windows on each tick.
type Scheduler struct {
	svc   *Service
	store *Store
}

// NewScheduler returns nil when svc is nil (email disabled). Callers should
// treat a nil scheduler as "don't start the loop."
func NewScheduler(svc *Service, store *Store) *Scheduler {
	if svc == nil {
		return nil
	}
	return &Scheduler{svc: svc, store: store}
}

// Run blocks until ctx is canceled. Safe to call from a goroutine.
// Runs one tick immediately on start (so a freshly-deployed server doesn't
// wait 10 minutes before sending catch-up emails), then on SchedulerInterval.
func (s *Scheduler) Run(ctx context.Context) {
	if s == nil {
		return
	}
	log.Info().Dur("interval", SchedulerInterval).Msg("email scheduler: starting")

	s.tick(ctx)

	ticker := time.NewTicker(SchedulerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("email scheduler: shutting down")
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	now := time.Now().UTC()
	s.runFlow(ctx, "welcome_catchup", func(ctx context.Context) ([]Candidate, error) {
		return s.store.WelcomeCatchup(ctx, now, welcomeCatchupLookback)
	}, TemplateWelcome)

	s.runFlow(ctx, "inactivity", func(ctx context.Context) ([]Candidate, error) {
		return s.store.InactivityCandidates(ctx, now)
	}, TemplateInactivity)

	s.runFlow(ctx, "trial_ended", func(ctx context.Context) ([]Candidate, error) {
		return s.store.TrialEndedCandidates(ctx, now)
	}, TemplateTrialEnded)

	s.runPersonalizedFlow(ctx, "trial_ending_day33", func(ctx context.Context) ([]PersonalizedCandidate, error) {
		return s.store.Day33Candidates(ctx, now)
	}, TemplateTrialEndingDay33)

	s.runPersonalizedFlow(ctx, "trial_ending_day35", func(ctx context.Context) ([]PersonalizedCandidate, error) {
		return s.store.Day35Candidates(ctx, now)
	}, TemplateTrialEndingDay35)
}

func (s *Scheduler) runPersonalizedFlow(
	ctx context.Context,
	flowName string,
	fetch func(context.Context) ([]PersonalizedCandidate, error),
	template string,
) {
	candidates, err := fetch(ctx)
	if err != nil {
		log.Error().Err(err).Str("flow", flowName).Msg("email scheduler: fetch failed")
		return
	}
	if len(candidates) == 0 {
		return
	}
	log.Info().Str("flow", flowName).Int("count", len(candidates)).
		Msg("email scheduler: sending personalized batch")

	for _, c := range candidates {
		if ctx.Err() != nil {
			return
		}
		firstName := strutil.FirstWord(c.FirstName)
		p := PersonalizationData{
			UnlockCode: c.UnlockCode,
			Tier:       c.Tier,
			PercentOff: c.PercentOff,
			ValidUntil: c.ValidUntil,
		}
		if err := s.svc.SendOnceWithPersonalization(ctx, c.UserID, c.Email, firstName, template, p); err != nil {
			log.Error().Err(err).Str("flow", flowName).
				Str("user_id", c.UserID).Str("to", c.Email).
				Msg("email scheduler: send failed")
		}
	}
}

func (s *Scheduler) runFlow(
	ctx context.Context,
	flowName string,
	fetch func(context.Context) ([]Candidate, error),
	template string,
) {
	candidates, err := fetch(ctx)
	if err != nil {
		log.Error().Err(err).Str("flow", flowName).Msg("email scheduler: fetch failed")
		return
	}
	if len(candidates) == 0 {
		return
	}
	log.Info().Str("flow", flowName).Int("count", len(candidates)).
		Msg("email scheduler: sending batch")

	for _, c := range candidates {
		if ctx.Err() != nil {
			return
		}
		firstName := strutil.FirstWord(c.FirstName)
		if err := s.svc.SendOnce(ctx, c.UserID, c.Email, firstName, template); err != nil {
			log.Error().Err(err).Str("flow", flowName).
				Str("user_id", c.UserID).Str("to", c.Email).
				Msg("email scheduler: send failed")
		}
	}
}
