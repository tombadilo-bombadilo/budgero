package handler_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// getBlob performs a GetDatabaseBlob request and returns the recorder.
func getBlob(h *handler.Handlers, e *echo.Echo, userID, spaceID string) (*httptest.ResponseRecorder, error) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)
	return rec, h.GetDatabaseBlob(c)
}

// uploadBody builds a distinct, reasonably large payload so a torn or stale
// read is detectable by hash.
func uploadBody(i int) string {
	return strings.Repeat(fmt.Sprintf("writer-%03d|", i), 16*1024)
}

// leftoverUploadTemps lists staged upload files that were never cleaned up.
func leftoverUploadTemps(t *testing.T, blobPath string) []string {
	t.Helper()
	matches, err := filepath.Glob(blobPath + ".upload-*")
	if err != nil {
		t.Fatalf("glob temp files: %v", err)
	}
	legacy, _ := filepath.Glob(blobPath + ".tmp")
	return append(matches, legacy...)
}

func TestGetDatabaseBlob_HeadersAlwaysMatchServedBytesDuringConcurrentUploads(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	tc.DB.SetMaxOpenConns(1)

	userID := testkit.SeedUser(t, tc.Queries, "blob-consistency@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Consistency Space")

	rec, err := postBlob(t, h, e, userID, spaceID, uploadBody(0), nil)
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("seed upload failed: err=%v status=%d", err, rec.Code)
	}

	const writers = 24
	var wg sync.WaitGroup
	stop := make(chan struct{})
	readerErrs := make(chan error, 64)

	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				rec, getErr := getBlob(h, e, userID, spaceID)
				if getErr != nil {
					readerErrs <- fmt.Errorf("GetDatabaseBlob() error = %w", getErr)
					return
				}
				header := rec.Header().Get("X-Database-Hash")
				if got := sha256Hex(rec.Body.Bytes()); got != header {
					readerErrs <- fmt.Errorf("served bytes hash %s != X-Database-Hash %s (version %s)",
						got, header, rec.Header().Get("X-Database-Version"))
					return
				}
			}
		}()
	}

	var writersWG sync.WaitGroup
	for i := 1; i <= writers; i++ {
		writersWG.Add(1)
		go func(i int) {
			defer writersWG.Done()
			// No version header: every upload advances unconditionally, so
			// they all race to publish.
			rec, postErr := postBlob(t, h, e, userID, spaceID, uploadBody(i), nil)
			if postErr != nil || rec.Code != http.StatusOK {
				readerErrs <- fmt.Errorf("upload %d failed (status %d): %w", i, rec.Code, postErr)
			}
		}(i)
	}
	writersWG.Wait()
	close(stop)
	wg.Wait()
	close(readerErrs)
	for err := range readerErrs {
		t.Error(err)
	}

	blob, err := tc.Queries.GetSpaceBlob(context.Background(), spaceID)
	if err != nil {
		t.Fatalf("GetSpaceBlob() error = %v", err)
	}
	if blob.SyncVersion != writers+1 {
		t.Fatalf("sync_version = %d, want %d", blob.SyncVersion, writers+1)
	}
	content, err := os.ReadFile(blob.BlobPath)
	if err != nil {
		t.Fatalf("read blob: %v", err)
	}
	if got := sha256Hex(content); got != blob.CurrentHash {
		t.Fatalf("stored file hash %s != recorded hash %s (concurrent uploads corrupted the blob)", got, blob.CurrentHash)
	}
	if !bytes.HasPrefix(content, []byte("writer-")) || len(content) != len(uploadBody(1)) {
		t.Fatalf("stored blob is not one complete upload (len %d)", len(content))
	}
	if left := leftoverUploadTemps(t, blob.BlobPath); len(left) > 0 {
		t.Fatalf("staged upload files left behind: %v", left)
	}
}

func TestPostDatabaseBlob_ConcurrentSameBaseVersion_OneWinsAndFileMatches(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	tc.DB.SetMaxOpenConns(1)

	userID := testkit.SeedUser(t, tc.Queries, "blob-cas-race@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "CAS Race Space")

	const writers = 12
	var wg sync.WaitGroup
	codes := make([]int, writers)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rec, err := postBlob(t, h, e, userID, spaceID, uploadBody(i), map[string]string{
				"X-Database-Version": "0",
				"X-Mutation-Version": "0",
			})
			if err != nil {
				t.Errorf("upload %d error = %v", i, err)
				return
			}
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()

	wins := 0
	for i, code := range codes {
		switch code {
		case http.StatusOK:
			wins++
		case http.StatusConflict:
		default:
			t.Fatalf("upload %d status = %d, want 200 or 409", i, code)
		}
	}
	if wins != 1 {
		t.Fatalf("winning uploads = %d, want exactly 1", wins)
	}

	blob, err := tc.Queries.GetSpaceBlob(context.Background(), spaceID)
	if err != nil {
		t.Fatalf("GetSpaceBlob() error = %v", err)
	}
	content, err := os.ReadFile(blob.BlobPath)
	if err != nil {
		t.Fatalf("read blob: %v", err)
	}
	if got := sha256Hex(content); got != blob.CurrentHash {
		t.Fatalf("stored file hash %s != recorded hash %s (a CAS loser's bytes went live)", got, blob.CurrentHash)
	}
	if left := leftoverUploadTemps(t, blob.BlobPath); len(left) > 0 {
		t.Fatalf("staged upload files left behind: %v", left)
	}
}

func TestUploadDatabase_RejectsEmptyBodyAndPublishesAtomically(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "legacy-upload@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Legacy Upload Space")

	_, err := doUpload(t, h, e, userID, spaceID, "", nil)
	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) || httpErr.Code != http.StatusBadRequest {
		t.Fatalf("empty legacy upload error = %v, want 400", err)
	}

	rec, err := doUpload(t, h, e, userID, spaceID, "legacy-bytes", nil)
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("legacy upload failed: err=%v status=%d", err, rec.Code)
	}

	blob, err := tc.Queries.GetSpaceBlob(context.Background(), spaceID)
	if err != nil {
		t.Fatalf("GetSpaceBlob() error = %v", err)
	}
	content, err := os.ReadFile(blob.BlobPath)
	if err != nil {
		t.Fatalf("read blob: %v", err)
	}
	if string(content) != "legacy-bytes" || sha256Hex(content) != blob.CurrentHash {
		t.Fatalf("legacy upload stored %q (hash match %v)", content, sha256Hex(content) == blob.CurrentHash)
	}
	if left := leftoverUploadTemps(t, blob.BlobPath); len(left) > 0 {
		t.Fatalf("staged upload files left behind: %v", left)
	}
}
