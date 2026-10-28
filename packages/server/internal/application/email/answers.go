package email

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// One-tap answers: the day-2 and trial-ending emails carry a row of reason
// links instead of "hit reply". Each send gets a random token (stored in
// email_answers); the link is <AppURL>/api/v1/email/answer/<token>?r=<reason>.

// AnswerTTL is how long an answer link keeps working after the email is sent.
const AnswerTTL = 60 * 24 * time.Hour

// MaxAnswerNote caps the optional free-text note on the thank-you page.
const MaxAnswerNote = 1000

var (
	// ErrAnswerNotFound means the token isn't in email_answers.
	ErrAnswerNotFound = errors.New("answer link not found")
	// ErrAnswerExpired means the link is older than AnswerTTL.
	ErrAnswerExpired = errors.New("answer link expired")
	// ErrAnswerReason means the reason isn't offered in that email.
	ErrAnswerReason = errors.New("unknown reason")
)

// Reason is one tappable answer. Keys are stored in email_answers.reason;
// DO NOT rename them once shipped, or old answers stop matching.
type Reason struct {
	Key   string
	Label string
}

// answerReasons lists the reasons offered per template. Templates not in the
// map get no answer links (and no email_answers row).
var answerReasons = map[string][]Reason{
	TemplateDay2Feedback: {
		{"going_well", "Going well"},
		{"too_much_setup", "Too much setup"},
		{"import_problem", "My bank or import doesn't work"},
		{"missing_feature", "Missing a feature"},
		{"just_looking", "Just looking around"},
	},
	TemplateTrialEndingDay35: {
		{"subscribing", "I'm subscribing"},
		{"too_expensive", "Too expensive"},
		{"other_app", "Going back to YNAB or another app"},
		{"missing_feature", "Missing a feature"},
		{"no_time", "Didn't have time to set it up"},
		{"other", "Something else"},
	},
}

// ReasonsFor returns the reasons offered in the given template (nil if none).
func ReasonsFor(template string) []Reason {
	return answerReasons[template]
}

// ReasonLabel returns the display label for a reason key in a template.
func ReasonLabel(template, key string) (string, bool) {
	for _, r := range answerReasons[template] {
		if r.Key == key {
			return r.Label, true
		}
	}
	return "", false
}

func newAnswerToken() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// CreateAnswer stores a fresh token for (user, template) and returns it.
func (s *Store) CreateAnswer(ctx context.Context, userID, template string, now time.Time) (string, error) {
	token, err := newAnswerToken()
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO email_answers (token, user_id, template, created_at) VALUES (?, ?, ?, ?)`,
		token, userID, template, now.UTC())
	return token, err
}

// DeleteAnswer removes an unanswered token (used when the send fails).
func (s *Store) DeleteAnswer(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM email_answers WHERE token = ? AND reason IS NULL`, token)
	return err
}

// Answer is the state of one answer link.
type Answer struct {
	Template string
	Reason   string
	Note     string
}

func (s *Store) lookupAnswer(ctx context.Context, token string, now time.Time) (*Answer, error) {
	var a Answer
	var reason, note sql.NullString
	var created time.Time
	err := s.db.QueryRowContext(ctx,
		`SELECT template, reason, note, created_at FROM email_answers WHERE token = ?`, token,
	).Scan(&a.Template, &reason, &note, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAnswerNotFound
	}
	if err != nil {
		return nil, err
	}
	if now.Sub(created) > AnswerTTL {
		return nil, ErrAnswerExpired
	}
	a.Reason, a.Note = reason.String, note.String
	return &a, nil
}

// LookupAnswer returns the template and current answer for a token.
func (s *Store) LookupAnswer(ctx context.Context, token string, now time.Time) (*Answer, error) {
	return s.lookupAnswer(ctx, token, now)
}

// RecordAnswer sets the reason (tapping again changes it) and, when note is
// non-empty, the note. reason may be empty to only update the note.
func (s *Store) RecordAnswer(ctx context.Context, token, reason, note string, now time.Time) (*Answer, error) {
	a, err := s.lookupAnswer(ctx, token, now)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		if _, ok := ReasonLabel(a.Template, reason); !ok {
			return nil, ErrAnswerReason
		}
		a.Reason = reason
	}
	note = strings.TrimSpace(note)
	if len(note) > MaxAnswerNote {
		note = note[:MaxAnswerNote]
		for !utf8.ValidString(note) {
			note = note[:len(note)-1]
		}
	}
	if note != "" {
		a.Note = note
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE email_answers SET reason = NULLIF(?, ''), note = NULLIF(?, ''), answered_at = ? WHERE token = ?`,
		a.Reason, a.Note, now.UTC(), token)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// Store exposes the service's store (nil for render-only services).
func (s *Service) Store() *Store {
	if s == nil {
		return nil
	}
	return s.store
}
