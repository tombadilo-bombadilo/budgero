package handler_test

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

// --- Data Format Gate Tests ---
//
// budget_space_blobs.data_format_version tracks the client data format of the
// stored blob. Uploads declare their format via X-Data-Format-Version; clients
// declare the highest format they understand via X-Budgero-Protocol (or the
// ?protocol= query param for WebSocket). The gates return 426 Upgrade Required
// when a client would misread or overwrite a newer-format blob.

const (
	dataFormatHeader = "X-Data-Format-Version"
	protocolHeader   = "X-Budgero-Protocol"
)

// doUpload performs an authenticated database upload with the given headers.
func doUpload(
	t *testing.T,
	h *handler.Handlers,
	e *echo.Echo,
	userID, spaceID, body string,
	headers map[string]string,
) (*httptest.ResponseRecorder, error) {
	t.Helper()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/database/upload?space_id="+spaceID,
		strings.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/octet-stream")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	return rec, h.UploadDatabase(c)
}

// doDownload performs an authenticated database download with the given headers.
func doDownload(
	t *testing.T,
	h *handler.Handlers,
	e *echo.Echo,
	userID, spaceID, query string,
	headers map[string]string,
) (*httptest.ResponseRecorder, error) {
	t.Helper()

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/database/download?space_id="+spaceID+query,
		http.NoBody,
	)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	return rec, h.DownloadDatabase(c)
}

// storedBlobFormat reads data_format_version straight from the database.
func storedBlobFormat(t *testing.T, db *sql.DB, spaceID string) int64 {
	t.Helper()

	var v int64
	if err := db.QueryRowContext(
		context.Background(),
		"SELECT data_format_version FROM budget_space_blobs WHERE space_id = ?",
		spaceID,
	).Scan(&v); err != nil {
		t.Fatalf("failed to read data_format_version: %v", err)
	}
	return v
}

// setBlobFormat forces the stored blob format for setup purposes.
func setBlobFormat(t *testing.T, db *sql.DB, spaceID string, version int64) {
	t.Helper()

	if _, err := db.ExecContext(
		context.Background(),
		"UPDATE budget_space_blobs SET data_format_version = ? WHERE space_id = ?",
		version,
		spaceID,
	); err != nil {
		t.Fatalf("failed to set data_format_version: %v", err)
	}
}

// requireUpgradeRequired asserts err is an *echo.HTTPError with status 426.
func requireUpgradeRequired(t *testing.T, err error) {
	t.Helper()

	if err == nil {
		t.Fatalf("expected HTTP error with status %d, got nil", http.StatusUpgradeRequired)
	}
	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected echo.HTTPError, got %T: %v", err, err)
	}
	if httpErr.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want %d (message: %v)", httpErr.Code, http.StatusUpgradeRequired, httpErr.Message)
	}
}

func TestUploadDatabase_DeclaredFormatRaisesStoredVersion(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "format-raise@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Format Raise Space")

	if got := storedBlobFormat(t, tc.DB, spaceID); got != 1 {
		t.Fatalf("fresh blob format = %d, want 1", got)
	}

	rec, err := doUpload(t, h, e, userID, spaceID, "encrypted-v2-data", map[string]string{
		dataFormatHeader: "2",
	})
	if err != nil {
		t.Fatalf("UploadDatabase() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("UploadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}

	if got := storedBlobFormat(t, tc.DB, spaceID); got != 2 {
		t.Fatalf("blob format after v2 upload = %d, want 2", got)
	}

	// A subsequent download by a v2-capable client reflects the raised format.
	rec, err = doDownload(t, h, e, userID, spaceID, "", map[string]string{
		protocolHeader: "2",
	})
	if err != nil {
		t.Fatalf("DownloadDatabase() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("DownloadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get(dataFormatHeader); got != "2" {
		t.Fatalf("download %s header = %q, want %q", dataFormatHeader, got, "2")
	}
}

func TestUploadDatabase_LegacyUploadRejectedAfterFormatRaised(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "format-legacy-upload@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Legacy Upload Space")

	rec, err := doUpload(t, h, e, userID, spaceID, "encrypted-v2-data", map[string]string{
		dataFormatHeader: "2",
	})
	if err != nil {
		t.Fatalf("v2 UploadDatabase() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("v2 UploadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}

	// A legacy client (no format header, implied format 1) must not overwrite
	// the newer-format blob.
	_, err = doUpload(t, h, e, userID, spaceID, "legacy-data", nil)
	requireUpgradeRequired(t, err)

	if got := storedBlobFormat(t, tc.DB, spaceID); got != 2 {
		t.Fatalf("blob format after rejected legacy upload = %d, want 2", got)
	}

	// A client that declares the current format may still upload; the stored
	// format is not raised past what was declared.
	rec, err = doUpload(t, h, e, userID, spaceID, "encrypted-v2-data-again", map[string]string{
		dataFormatHeader: "2",
	})
	if err != nil {
		t.Fatalf("same-format UploadDatabase() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("same-format UploadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := storedBlobFormat(t, tc.DB, spaceID); got != 2 {
		t.Fatalf("blob format after same-format upload = %d, want 2", got)
	}
}

func TestDownloadDatabase_RequiresProtocolForNewerFormat(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "format-download@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Download Gate Space")

	// Put a v2 blob on the server through the real upload path.
	if _, err := doUpload(t, h, e, userID, spaceID, "encrypted-v2-data", map[string]string{
		dataFormatHeader: "2",
	}); err != nil {
		t.Fatalf("v2 UploadDatabase() error = %v", err)
	}

	// Legacy client: no protocol declared → 426.
	_, err := doDownload(t, h, e, userID, spaceID, "", nil)
	requireUpgradeRequired(t, err)

	// Client explicitly declaring an older protocol → 426.
	_, err = doDownload(t, h, e, userID, spaceID, "", map[string]string{
		protocolHeader: "1",
	})
	requireUpgradeRequired(t, err)

	// Client declaring protocol 2 via header → 200 with format response header.
	rec, err := doDownload(t, h, e, userID, spaceID, "", map[string]string{
		protocolHeader: "2",
	})
	if err != nil {
		t.Fatalf("DownloadDatabase() with protocol header error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("DownloadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get(dataFormatHeader); got != "2" {
		t.Fatalf("download %s header = %q, want %q", dataFormatHeader, got, "2")
	}

	// Declaring the protocol via the ?protocol= query param also passes the gate.
	rec, err = doDownload(t, h, e, userID, spaceID, "&protocol=2", nil)
	if err != nil {
		t.Fatalf("DownloadDatabase() with protocol query param error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("DownloadDatabase() with query param status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestDownloadDatabase_MalformedProtocolTreatedAsLegacy(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "format-malformed@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Malformed Protocol Space")
	setBlobFormat(t, tc.DB, spaceID, 2)

	for _, raw := range []string{"abc", "-3", "0", "2.5"} {
		_, err := doDownload(t, h, e, userID, spaceID, "", map[string]string{
			protocolHeader: raw,
		})
		if err == nil {
			t.Fatalf("DownloadDatabase() with protocol %q expected 426, got nil error", raw)
		}
		requireUpgradeRequired(t, err)
	}
}

func TestSync_LegacyClientsUnaffectedOnFormatOneSpace(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "format-legacy-ok@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Legacy OK Space")

	// Legacy upload: no format header at all.
	rec, err := doUpload(t, h, e, userID, spaceID, "legacy-encrypted-data", nil)
	if err != nil {
		t.Fatalf("legacy UploadDatabase() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("legacy UploadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := storedBlobFormat(t, tc.DB, spaceID); got != 1 {
		t.Fatalf("blob format after legacy upload = %d, want 1", got)
	}

	// Legacy download: no protocol declared, still served.
	rec, err = doDownload(t, h, e, userID, spaceID, "", nil)
	if err != nil {
		t.Fatalf("legacy DownloadDatabase() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("legacy DownloadDatabase() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get(dataFormatHeader); got != "1" {
		t.Fatalf("download %s header = %q, want %q", dataFormatHeader, got, "1")
	}
}

func TestWebSocketHandler_RejectsUnsupportedFormatBeforeUpgrade(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "format-ws@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "WS Gate Space")
	setBlobFormat(t, tc.DB, spaceID, 2)

	// No protocol query param → legacy client → gated before the upgrade.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.WebSocketHandler(c)
	requireUpgradeRequired(t, err)

	// With ?protocol=2 the gate passes; the handler proceeds to the upgrade,
	// which fails here only because the request is not a real WebSocket
	// handshake — the failure must not be the 426 format gate.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/ws?space_id="+spaceID+"&protocol=2", http.NoBody)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	setUserContext(c, userID)

	err = h.WebSocketHandler(c)
	if err == nil {
		t.Fatal("WebSocketHandler() expected upgrade error for non-WebSocket request")
	}
	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) && httpErr.Code == http.StatusUpgradeRequired {
		t.Fatalf("WebSocketHandler() returned 426 despite supported protocol: %v", err)
	}
}
