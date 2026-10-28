package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// UserPurgeRepository implements repository.UserPurgeRepository with raw SQL,
// because mutation_log is created at runtime by the sync hub and isn't part of
// the sqlc schema.
type UserPurgeRepository struct {
	db *sql.DB
}

// NewUserPurgeRepository creates a new UserPurgeRepository.
func NewUserPurgeRepository(db *sql.DB) *UserPurgeRepository {
	return &UserPurgeRepository{db: db}
}

var _ repository.UserPurgeRepository = (*UserPurgeRepository)(nil)

// Purge removes the user and everything tied to them in one transaction:
//
//   - spaces they own, with blobs, members, invites, mutation log, snapshots,
//     push tokens and queue;
//   - their rows in other people's shared spaces' mutation log are kept (the
//     space needs them) but anonymized;
//   - heartbeats, sent-email records, beta invites they created, pending
//     invites addressed to their email, memberships, credentials,
//     preferences, feedback and push data.
func (r *UserPurgeRepository) Purge(ctx context.Context, userID string) (_ *domain.UserPurgeReport, files []string, err error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	report := &domain.UserPurgeReport{UserID: userID, SpacesDeleted: []string{}}
	var dbPath string
	if err = tx.QueryRowContext(ctx,
		`SELECT email, COALESCE(db_path, '') FROM users WHERE id = ?`, userID,
	).Scan(&report.Email, &dbPath); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			err = domain.ErrUserNotFound
		}
		return nil, nil, err
	}
	if dbPath != "" {
		files = append(files, dbPath)
	}

	if report.SpacesDeleted, err = queryStrings(ctx, tx,
		`SELECT space_id FROM budget_spaces WHERE owner_user_id = ?`, userID); err != nil {
		return nil, nil, err
	}
	blobPaths, err := queryStrings(ctx, tx, `SELECT b.blob_path FROM budget_space_blobs b
		JOIN budget_spaces s ON s.space_id = b.space_id
		WHERE s.owner_user_id = ? AND b.blob_path <> ''`, userID)
	if err != nil {
		return nil, nil, err
	}
	files = append(files, blobPaths...)

	ownedSpaces := `(SELECT space_id FROM budget_spaces WHERE owner_user_id = ?)`
	steps := []struct {
		count *int64
		table string // skipped when the table doesn't exist
		query string
		args  []any
	}{
		{&report.MutationsDeleted, "mutation_log",
			`DELETE FROM mutation_log WHERE space_id IN ` + ownedSpaces, []any{userID}},
		{&report.MutationsAnonymized, "mutation_log",
			`UPDATE mutation_log SET user_id = '' WHERE user_id = ?`, []any{userID}},
		{&report.SnapshotsDeleted, "mutation_snapshots",
			`DELETE FROM mutation_snapshots WHERE space_id IN ` + ownedSpaces, []any{userID}},
		// Other members' push tokens and queued pushes for the spaces going away.
		{nil, "push_api_tokens", `DELETE FROM push_api_tokens WHERE space_id IN ` + ownedSpaces, []any{userID}},
		{nil, "push_queue", `DELETE FROM push_queue WHERE space_id IN ` + ownedSpaces, []any{userID}},
		{&report.ActivityDaysDeleted, "user_daily_activity",
			`DELETE FROM user_daily_activity WHERE user_id = ?`, []any{userID}},
		{&report.EmailsDeleted, "sent_emails", `DELETE FROM sent_emails WHERE user_id = ?`, []any{userID}},
		{nil, "email_answers", `DELETE FROM email_answers WHERE user_id = ?`, []any{userID}},
		// beta_invites references users without ON DELETE, which would block
		// the user delete below.
		{nil, "beta_invites", `DELETE FROM beta_invites WHERE created_by = ?`, []any{userID}},
		{nil, "beta_invites", `UPDATE beta_invites SET used_by = NULL WHERE used_by = ?`, []any{userID}},
		// Invites to other people's spaces still hold the user's email address.
		{&report.InvitesDeleted, "budget_space_invites",
			`DELETE FROM budget_space_invites WHERE lower(invitee_email) = lower(?)`, []any{report.Email}},
		{nil, "users",
			`UPDATE users SET primary_space_id = NULL WHERE primary_space_id IN ` + ownedSpaces, []any{userID}},
		// Explicit rather than relying on ON DELETE CASCADE, which only runs
		// when the connection has foreign keys enabled.
		{nil, "budget_space_invites",
			`DELETE FROM budget_space_invites WHERE inviter_user_id = ? OR space_id IN ` + ownedSpaces,
			[]any{userID, userID}},
		{nil, "budget_space_invites",
			`UPDATE budget_space_invites SET redeemed_by = NULL WHERE redeemed_by = ?`, []any{userID}},
		{nil, "budget_space_members",
			`DELETE FROM budget_space_members WHERE user_id = ? OR space_id IN ` + ownedSpaces,
			[]any{userID, userID}},
		{nil, "budget_space_blobs", `DELETE FROM budget_space_blobs WHERE space_id IN ` + ownedSpaces, []any{userID}},
		{nil, "budget_spaces", `DELETE FROM budget_spaces WHERE owner_user_id = ?`, []any{userID}},
		{nil, "push_api_tokens", `DELETE FROM push_api_tokens WHERE user_id = ?`, []any{userID}},
		{nil, "push_queue", `DELETE FROM push_queue WHERE user_id = ?`, []any{userID}},
		{nil, "local_credentials", `DELETE FROM local_credentials WHERE user_id = ?`, []any{userID}},
		{nil, "user_preferences", `DELETE FROM user_preferences WHERE user_id = ?`, []any{userID}},
		{nil, "user_feedback", `DELETE FROM user_feedback WHERE user_id = ?`, []any{userID}},
		{nil, "users", `DELETE FROM users WHERE id = ?`, []any{userID}},
	}
	existing := map[string]bool{}
	for _, step := range steps {
		ok, seen := existing[step.table]
		if !seen {
			if ok, err = tableExists(ctx, tx, step.table); err != nil {
				return nil, nil, err
			}
			existing[step.table] = ok
		}
		if !ok {
			continue
		}
		res, execErr := tx.ExecContext(ctx, step.query, step.args...)
		if execErr != nil {
			err = fmt.Errorf("purge %s: %w", step.table, execErr)
			return nil, nil, err
		}
		if step.count != nil {
			n, _ := res.RowsAffected()
			*step.count += n
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, nil, commitErr
	}
	return report, files, nil
}

// ListActivity returns every user with the data needed to judge inactivity.
func (r *UserPurgeRepository) ListActivity(ctx context.Context) ([]domain.UserActivitySummary, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT u.id, u.email, u.name, u.created_at,
       COALESCE((SELECT MAX(a.day) FROM user_daily_activity a WHERE a.user_id = u.id), ''),
       COALESCE(u.subscription_status, ''),
       COALESCE(u.subscription_id, '') <> '',
       u.trial_ends_at,
       COALESCE(u.is_founding_member, 0),
       COALESCE(u.is_blocked, 0),
       (SELECT COUNT(*) FROM budget_spaces s WHERE s.owner_user_id = u.id),
       (SELECT COUNT(*) FROM budget_space_members m
          JOIN budget_spaces s ON s.space_id = m.space_id
         WHERE m.user_id = u.id AND s.owner_user_id <> u.id),
       COALESCE((SELECT SUM(b.size_bytes) FROM budget_space_blobs b
          JOIN budget_spaces s ON s.space_id = b.space_id
         WHERE s.owner_user_id = u.id), 0)
FROM users u
ORDER BY u.created_at`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []domain.UserActivitySummary
	for rows.Next() {
		var (
			u         domain.UserActivitySummary
			createdAt sql.NullTime
			trialEnds sql.NullTime
		)
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &createdAt, &u.LastHeartbeatDay,
			&u.SubscriptionStatus, &u.HasSubscription, &trialEnds, &u.IsFoundingMember,
			&u.IsBlocked, &u.OwnedSpaces, &u.SharedSpaces, &u.StoredBytes); err != nil {
			return nil, err
		}
		if createdAt.Valid {
			t := createdAt.Time
			u.CreatedAt = &t
		}
		if trialEnds.Valid {
			t := trialEnds.Time
			u.TrialEndsAt = &t
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func queryStrings(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, strings.TrimSpace(s))
	}
	return out, rows.Err()
}

func tableExists(ctx context.Context, tx *sql.Tx, name string) (bool, error) {
	var n int
	err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&n)
	return n > 0, err
}
