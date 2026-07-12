// Package sqlc contains the typed SQLite query layer.
package sqlc

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// UpdateMemberEncryptedKeys replaces every supplied wrapped key in one SQLite
// statement. The count subquery makes the statement update zero rows unless
// every requested membership still exists, preserving all-or-nothing behavior
// even if membership changes after the service-layer access checks.
func (q *Queries) UpdateMemberEncryptedKeys(ctx context.Context, userID string, encryptedKeys map[string]string) (int64, error) {
	if len(encryptedKeys) == 0 {
		return 0, nil
	}

	spaceIDs := make([]string, 0, len(encryptedKeys))
	for spaceID := range encryptedKeys {
		spaceIDs = append(spaceIDs, spaceID)
	}
	sort.Strings(spaceIDs)

	var query strings.Builder
	query.WriteString("UPDATE budget_space_members SET encrypted_space_key = CASE space_id ")
	args := make([]any, 0, len(spaceIDs)*4+3)
	for _, spaceID := range spaceIDs {
		query.WriteString("WHEN ? THEN ? ")
		args = append(args, spaceID, encryptedKeys[spaceID])
	}
	query.WriteString("ELSE encrypted_space_key END WHERE user_id = ? AND space_id IN (")
	args = append(args, userID)
	query.WriteString(strings.TrimSuffix(strings.Repeat("?,", len(spaceIDs)), ","))
	query.WriteString(") AND (SELECT COUNT(*) FROM budget_space_members WHERE user_id = ? AND space_id IN (")
	for _, spaceID := range spaceIDs {
		args = append(args, spaceID)
	}
	args = append(args, userID)
	query.WriteString(strings.TrimSuffix(strings.Repeat("?,", len(spaceIDs)), ","))
	for _, spaceID := range spaceIDs {
		args = append(args, spaceID)
	}
	query.WriteString(")) = ?")
	args = append(args, len(spaceIDs))

	result, err := q.db.ExecContext(ctx, query.String(), args...)
	if err != nil {
		return 0, fmt.Errorf("update member encrypted keys: %w", err)
	}
	return result.RowsAffected()
}
