package shared_test

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestCorruptedEmailQuery(t *testing.T) {
	// Create in-memory SQLite database
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer func() { _ = db.Close() }()

	// Create tables
	_, err = db.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			name TEXT
		);
		CREATE TABLE local_credentials (
			user_id TEXT PRIMARY KEY,
			is_admin INTEGER DEFAULT 0
		);
	`)
	if err != nil {
		t.Fatalf("failed to create tables: %v", err)
	}

	// Insert test users
	testUsers := []struct {
		id      string
		email   string
		isAdmin int
	}{
		{"user1", "admin", 1},                            // Normal admin
		{"user2", "user2@clerk.user", 1},                 // Corrupted admin
		{"user3", "someuser", 0},                         // Normal user
		{"user4", "abc123xyz@clerk.user", 0},             // Corrupted non-admin
		{"user5", "test@gmail.com", 0},                   // Normal email
		{"user6", "user_01jj1234@clerk.user", 1},         // Corrupted admin with underscore
	}

	for _, u := range testUsers {
		_, err = db.Exec(`INSERT INTO users (id, email) VALUES (?, ?)`, u.id, u.email)
		if err != nil {
			t.Fatalf("failed to insert user %s: %v", u.id, err)
		}
		_, err = db.Exec(`INSERT INTO local_credentials (user_id, is_admin) VALUES (?, ?)`, u.id, u.isAdmin)
		if err != nil {
			t.Fatalf("failed to insert local_credentials %s: %v", u.id, err)
		}
	}

	t.Run("LIKE with pattern in param", func(t *testing.T) {
		pattern := "%@clerk.user"
		rows, err := db.Query(`
			SELECT u.id, u.email, COALESCE(c.is_admin, 0) as is_admin
			FROM users u
			LEFT JOIN local_credentials c ON u.id = c.user_id
			WHERE u.email LIKE ?
		`, pattern)
		if err != nil {
			t.Fatalf("query failed: %v", err)
		}
		defer func() { _ = rows.Close() }()

		var found []string
		for rows.Next() {
			var id, email string
			var isAdmin int
			if err := rows.Scan(&id, &email, &isAdmin); err != nil {
				t.Fatalf("scan failed: %v", err)
			}
			found = append(found, id)
			t.Logf("Found: id=%s email=%s isAdmin=%d", id, email, isAdmin)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("rows iteration error: %v", err)
		}
		if len(found) != 3 {
			t.Errorf("expected 3 corrupted users, got %d", len(found))
		}
	})
}
