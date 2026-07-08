package email

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Store owns the sent_emails dedup table plus the per-flow candidate
// queries. Uses raw database/sql rather than sqlc so this package stays
// self-contained — if you want to migrate to sqlc later, the queries
// live in one place.
type Store struct {
	db *sql.DB
}

// NewStore constructs the store. Callers are expected to share the single
// *sql.DB used by the rest of the app.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// HasSent reports whether the given (user, template) pair has already been
// recorded in sent_emails. The primary key on the table guarantees at most
// one row per pair, so this is a direct existence check.
func (s *Store) HasSent(ctx context.Context, userID, template string) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM sent_emails WHERE user_id = ? AND template = ? LIMIT 1`,
		userID, template,
	).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// MarkSent records the send. If the row already exists (double-tick race),
// the INSERT OR IGNORE keeps it idempotent rather than erroring.
func (s *Store) MarkSent(ctx context.Context, userID, template string, sentAt time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO sent_emails (user_id, template, sent_at) VALUES (?, ?, ?)`,
		userID, template, sentAt.UTC(),
	)
	return err
}

// Candidate is the minimum user info the scheduler needs to fire an email.
type Candidate struct {
	UserID    string
	Email     string
	FirstName string
}

// PersonalizedCandidate carries per-user fields needed by personalized email
// flows (trial-ending day33/day35), pulled from trial_discount_codes via
// LEFT JOIN. UnlockCode is empty when the user hasn't earned any tier yet.
type PersonalizedCandidate struct {
	Candidate
	UnlockCode string
	Tier       int
	PercentOff int
	ValidUntil time.Time
}

// WelcomeCatchup finds SaaS users created within the last 24h who don't
// yet have a `welcome` row in sent_emails. The inline send at signup is
// the primary path; this backstops sends that failed transiently (Resend
// 500, network blip, process killed mid-flight).
//
// We exclude users whose email is still the synthesized clerk_id@clerk.user
// placeholder (Clerk fetch failed at signup) — those addresses bounce 100%
// of the time. Once the next Clerk sync repairs the email, the catchup
// will pick them up on a subsequent pass.
func (s *Store) WelcomeCatchup(ctx context.Context, now time.Time, lookback time.Duration) ([]Candidate, error) {
	return s.queryCandidates(ctx, `
		SELECT u.id, u.email, u.name
		FROM users u
		WHERE u.created_at >= ?
		  AND u.email NOT LIKE '%@clerk.user'
		  AND NOT EXISTS (
		    SELECT 1 FROM sent_emails s
		    WHERE s.user_id = u.id AND s.template = ?
		  )
	`, now.Add(-lookback).UTC(), TemplateWelcome)
}

// InactivityCandidates finds users to nudge toward their first reward (10%
// off, Tier 1 = log 5 transactions). Targets users who:
//   - signed up between 75h and 72h ago (a 3h window so a delayed
//     scheduler tick doesn't miss anyone),
//   - are still on an active trial,
//   - haven't opted out of trial-signal tracking (otherwise their
//     transactions never count toward the reward, so the pitch would be
//     a lie),
//   - haven't unlocked Tier 1 yet (includes both the fully inactive and the
//     "almost there" 1–4 transaction users),
//   - haven't already received this nudge.
//
// The template key stays "inactivity" so anyone who got the previous
// re-engagement version of this email isn't mailed twice.
func (s *Store) InactivityCandidates(ctx context.Context, now time.Time) ([]Candidate, error) {
	windowStart := now.Add(-75 * time.Hour).UTC()
	windowEnd := now.Add(-72 * time.Hour).UTC()
	return s.queryCandidates(ctx, `
		SELECT u.id, u.email, u.name
		FROM users u
		LEFT JOIN trial_progress tp ON tp.user_id = u.id
		WHERE u.created_at BETWEEN ? AND ?
		  AND u.subscription_status IN ('on_trial', 'trialing')
		  AND u.is_trial_signals_disabled = 0
		  AND u.email NOT LIKE '%@clerk.user'
		  AND tp.tier1_unlocked_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM sent_emails s
		    WHERE s.user_id = u.id AND s.template = ?
		  )
	`, windowStart, windowEnd, TemplateInactivity)
}

// TrialEndedCandidates finds users whose trial_ends_at falls between 51h
// and 48h ago (2-day post-trial window, 3h slack like above), who never
// converted to an active subscription, and who haven't been emailed yet.
//
// subscription_status values we INCLUDE (i.e. "trial lapsed, no conversion"):
//   - 'expired', 'inactive'      — trial ran out, nothing purchased
//   - 'on_trial', 'trialing'     — still shows trial state but trial_ends_at is past
//                                  (webhook hasn't flipped them yet, or they never
//                                  clicked subscribe)
//
// Values we EXCLUDE: active, cancelled, past_due, lifetime, paused — those
// users either are paying, were paying, or have lifetime access.
//
// We also EXCLUDE users with an active (unredeemed, unexpired) trial-rewards
// discount code — those users already received a tier-unlock email AND
// would receive trial_ending_day33/day35 emails. Stacking the legacy
// COMEBACK30 email on top of those would mean four discount offers in one
// week. The unlock-tier code is more valuable to the user, so we let it win.
func (s *Store) TrialEndedCandidates(ctx context.Context, now time.Time) ([]Candidate, error) {
	windowStart := now.Add(-51 * time.Hour).UTC()
	windowEnd := now.Add(-48 * time.Hour).UTC()
	return s.queryCandidates(ctx, `
		SELECT u.id, u.email, u.name
		FROM users u
		WHERE u.trial_ends_at BETWEEN ? AND ?
		  AND u.subscription_status IN ('expired', 'inactive', 'on_trial', 'trialing')
		  AND u.email NOT LIKE '%@clerk.user'
		  AND NOT EXISTS (
		    SELECT 1 FROM sent_emails s
		    WHERE s.user_id = u.id AND s.template = ?
		  )
		  AND NOT EXISTS (
		    SELECT 1 FROM trial_discount_codes c
		    WHERE c.user_id = u.id
		      AND c.redeemed_at IS NULL
		      AND c.valid_until > ?
		  )
	`, windowStart, windowEnd, TemplateTrialEnded, now.UTC())
}

// Day33Candidates finds users whose trial_ends_at is between 45h and 48h in
// the future (i.e. the last 3h before the official "2 days left" mark), who
// haven't subscribed and haven't been emailed yet. The 3h window catches
// scheduler ticks running on a 10-minute cadence.
//
// Joins to trial_discount_codes to fetch the user's highest-tier active
// code (if any), which the template renders inline.
func (s *Store) Day33Candidates(ctx context.Context, now time.Time) ([]PersonalizedCandidate, error) {
	windowStart := now.Add(45 * time.Hour).UTC()
	windowEnd := now.Add(48 * time.Hour).UTC()
	return s.queryPersonalized(ctx, `
		SELECT
		  u.id,
		  u.email,
		  u.name,
		  COALESCE(c.code, ''),
		  COALESCE(c.tier, 0),
		  COALESCE(c.percent_off, 0),
		  COALESCE(c.valid_until, '')
		FROM users u
		LEFT JOIN (
		  SELECT user_id, code, tier, percent_off, valid_until
		  FROM trial_discount_codes
		  WHERE redeemed_at IS NULL
		  GROUP BY user_id
		  HAVING tier = MAX(tier)
		) c ON c.user_id = u.id
		WHERE u.trial_ends_at BETWEEN ? AND ?
		  AND u.subscription_status IN ('on_trial', 'trialing')
		  AND u.email NOT LIKE '%@clerk.user'
		  AND NOT EXISTS (
		    SELECT 1 FROM sent_emails s
		    WHERE s.user_id = u.id AND s.template = ?
		  )
	`, windowStart, windowEnd, TemplateTrialEndingDay33)
}

// Day35Candidates finds users whose trial just ended in the last 3h (so we
// fire the "ends today" email on the day-of), again with their highest
// active tier code joined in.
func (s *Store) Day35Candidates(ctx context.Context, now time.Time) ([]PersonalizedCandidate, error) {
	windowStart := now.Add(-3 * time.Hour).UTC()
	windowEnd := now.UTC()
	return s.queryPersonalized(ctx, `
		SELECT
		  u.id,
		  u.email,
		  u.name,
		  COALESCE(c.code, ''),
		  COALESCE(c.tier, 0),
		  COALESCE(c.percent_off, 0),
		  COALESCE(c.valid_until, '')
		FROM users u
		LEFT JOIN (
		  SELECT user_id, code, tier, percent_off, valid_until
		  FROM trial_discount_codes
		  WHERE redeemed_at IS NULL
		  GROUP BY user_id
		  HAVING tier = MAX(tier)
		) c ON c.user_id = u.id
		WHERE u.trial_ends_at BETWEEN ? AND ?
		  AND u.subscription_status IN ('on_trial', 'trialing', 'expired', 'inactive')
		  AND u.email NOT LIKE '%@clerk.user'
		  AND NOT EXISTS (
		    SELECT 1 FROM sent_emails s
		    WHERE s.user_id = u.id AND s.template = ?
		  )
	`, windowStart, windowEnd, TemplateTrialEndingDay35)
}

func (s *Store) queryPersonalized(ctx context.Context, query string, args ...any) ([]PersonalizedCandidate, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query personalized candidates: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []PersonalizedCandidate
	for rows.Next() {
		var c PersonalizedCandidate
		var validUntilStr string
		if err := rows.Scan(&c.UserID, &c.Email, &c.FirstName, &c.UnlockCode, &c.Tier, &c.PercentOff, &validUntilStr); err != nil {
			return nil, err
		}
		if validUntilStr != "" {
			if t, parseErr := time.Parse(time.RFC3339, validUntilStr); parseErr == nil {
				c.ValidUntil = t
			} else if t, parseErr := time.Parse("2006-01-02 15:04:05.999999999-07:00", validUntilStr); parseErr == nil {
				c.ValidUntil = t
			}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) queryCandidates(ctx context.Context, query string, args ...any) ([]Candidate, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query candidates: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.UserID, &c.Email, &c.FirstName); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
