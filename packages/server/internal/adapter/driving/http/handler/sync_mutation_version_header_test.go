package handler_test

import (
	"net/http"
	"testing"

	"budgero-server/internal/testkit"
)

// A snapshot published before any change was logged (an import or a new
// budget) is bound to mutation version 0. Downloads must say so: without the
// header the device seeds its cursor from the log's CURRENT position and
// never replays the changes made after the snapshot.
func TestDownloadBlob_MutationVersionHeader(t *testing.T) {
	cases := []struct {
		name    string
		upload  map[string]string
		rewrite string // SQL run after the upload to simulate an older row
		want    string // "" = header absent
	}{
		{
			name:   "out-of-band import bound to 0",
			upload: map[string]string{"X-Mutation-Version": "0", "X-Out-Of-Band": "1"},
			want:   "0",
		},
		{
			name:   "sync upload bound to 0",
			upload: map[string]string{"X-Mutation-Version": "0"},
			want:   "0",
		},
		{
			name:   "sync upload bound to 12",
			upload: map[string]string{"X-Mutation-Version": "12"},
			want:   "12",
		},
		{
			name:    "legacy row at 0 stays unbound",
			upload:  map[string]string{"X-Mutation-Version": "0"},
			rewrite: `UPDATE budget_space_blobs SET published_at = NULL, origin = 'sync' WHERE space_id = ?`,
			want:    "",
		},
		{
			name:    "legacy row above 0 keeps its version",
			upload:  map[string]string{"X-Mutation-Version": "7"},
			rewrite: `UPDATE budget_space_blobs SET published_at = NULL WHERE space_id = ?`,
			want:    "7",
		},
		{
			name:    "restored copy at 0 stays unbound",
			upload:  map[string]string{"X-Mutation-Version": "0"},
			rewrite: `UPDATE budget_space_blobs SET origin = 'restore' WHERE space_id = ?`,
			want:    "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, e, ctx := setupTestHandler(t)
			userID := testkit.SeedUser(t, ctx.Queries, "mv-header@example.com")
			spaceID := testkit.SeedSpace(t, ctx.DB, ctx.Queries, userID, "MV Space")

			rec, err := postBlob(t, h, e, userID, spaceID, "snapshot-bytes", tc.upload)
			if err != nil || rec.Code != http.StatusOK {
				t.Fatalf("upload: err=%v status=%d body=%s", err, rec.Code, rec.Body.String())
			}
			if tc.rewrite != "" {
				if _, execErr := ctx.DB.Exec(tc.rewrite, spaceID); execErr != nil {
					t.Fatalf("rewrite row: %v", execErr)
				}
			}

			blobRec, err := getBlob(h, e, userID, spaceID)
			if err != nil || blobRec.Code != http.StatusOK {
				t.Fatalf("blob download: err=%v status=%d", err, blobRec.Code)
			}
			legacyRec, err := doDownload(t, h, e, userID, spaceID, "", nil)
			if err != nil || legacyRec.Code != http.StatusOK {
				t.Fatalf("legacy download: err=%v status=%d", err, legacyRec.Code)
			}

			for route, got := range map[string]http.Header{"blob": blobRec.Header(), "download": legacyRec.Header()} {
				values := got.Values("X-Mutation-Version")
				switch {
				case tc.want == "" && len(values) != 0:
					t.Errorf("%s: X-Mutation-Version = %q, want absent", route, values)
				case tc.want != "" && (len(values) != 1 || values[0] != tc.want):
					t.Errorf("%s: X-Mutation-Version = %q, want %q", route, values, tc.want)
				}
			}
		})
	}
}
