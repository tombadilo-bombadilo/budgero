package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/adapter/driving/http/handler"
	appmw "budgero-server/internal/adapter/driving/http/middleware"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

const (
	originSync          = "sync"
	historyRoute        = "/api/v1/database/blob/history"
	testUserHeader      = "X-Test-User"
	adminHistoryPattern = "/api/v1/admin/spaces/%s/blob-history"
)

type historyFixture struct {
	t        *testing.T
	e        *echo.Echo
	tc       *testkit.TestContext
	services *application.Services
	tracker  *recordingTracker
	hub      *synchub.Hub
	ownerID  string
	spaceID  string
}

type historyOptions struct {
	keep, days int
	withHub    bool
}

// newHistoryFixture serves the blob, upload and history routes behind the
// production request-id and error-handler chain. The acting user comes from
// the X-Test-User header.
func newHistoryFixture(t *testing.T, opts historyOptions) *historyFixture {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	cfg.SnapshotHistory = config.SnapshotHistoryConfig{Keep: opts.keep, Days: opts.days}
	services.SnapshotHistory = application.NewSnapshotHistoryService(sqlite.NewSpaceRepository(queries), cfg)
	tracker := &recordingTracker{}
	services.Analytics = tracker

	f := &historyFixture{
		t:        t,
		e:        echo.New(),
		tc:       &testkit.TestContext{DB: sqlDB, Queries: queries},
		services: services,
		tracker:  tracker,
	}
	if opts.withHub {
		ml, err := synchub.NewMutationLog(sqlDB)
		if err != nil {
			t.Fatalf("NewMutationLog() error = %v", err)
		}
		f.hub = synchub.NewHub(ml)
		go f.hub.Run()
	}
	h := handler.NewHandlers(services, f.hub, handler.Options{Config: cfg})

	auth := func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if user := c.Request().Header.Get(testUserHeader); user != "" {
				c.Set("user_id", user)
			}
			return next(c)
		}
	}
	f.e.Use(appmw.RequestIDMiddleware())
	f.e.HTTPErrorHandler = appmw.ErrorHandler(tracker, "test")
	f.e.POST("/api/v1/database/blob", h.PostDatabaseBlob, auth)
	f.e.GET("/api/v1/database/blob", h.GetDatabaseBlob, auth)
	f.e.POST("/api/v1/database/upload", h.UploadDatabase, auth)
	f.e.GET(historyRoute, h.GetSnapshotHistory, auth)
	f.e.GET(historyRoute+"/:id", h.GetSnapshotHistoryEntry, auth)
	f.e.POST(historyRoute+"/:id/restore", h.RestoreSnapshotHistoryEntry, auth)
	f.e.GET("/api/v1/admin/spaces/:space_id/blob-history", h.AdminGetSnapshotHistory, auth)
	f.e.POST("/api/v1/admin/spaces/:space_id/blob-history/:id/restore", h.AdminRestoreSnapshotHistoryEntry, auth)

	f.ownerID = testkit.SeedUser(t, queries, "history-owner@example.com")
	f.spaceID = testkit.SeedSpace(t, sqlDB, queries, f.ownerID, "History Space")
	return f
}

func (f *historyFixture) do(method, target, userID string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	f.t.Helper()
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	if userID != "" {
		req.Header.Set(testUserHeader, userID)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.e.ServeHTTP(rec, req)
	return rec
}

// upload posts body as the owner on top of baseVersion, bound to mutation
// mv, and returns the new sync version.
func (f *historyFixture) upload(body []byte, baseVersion, mv int64, extra map[string]string) int64 {
	f.t.Helper()
	headers := map[string]string{
		"X-Database-Version": strconv.FormatInt(baseVersion, 10),
		"X-Mutation-Version": strconv.FormatInt(mv, 10),
	}
	for k, v := range extra {
		headers[k] = v
	}
	rec := f.do(http.MethodPost, "/api/v1/database/blob?space_id="+f.spaceID, f.ownerID, body, headers)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("upload status = %d body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Version int64 `json:"version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		f.t.Fatal(err)
	}
	return resp.Version
}

type historyListing struct {
	SpaceID string `json:"space_id"`
	Current struct {
		SyncVersion          int64     `json:"sync_version"`
		MutationVersion      int64     `json:"mutation_version"`
		SizeBytes            int64     `json:"size_bytes"`
		UpdatedAt            time.Time `json:"updated_at"`
		EncryptionKeyVersion int64     `json:"encryption_key_version"`
		DataFormatVersion    int64     `json:"data_format_version"`
		Origin               string    `json:"origin"`
	} `json:"current"`
	Entries []struct {
		ID                   int64     `json:"id"`
		SyncVersion          int64     `json:"sync_version"`
		MutationVersion      int64     `json:"mutation_version"`
		SizeBytes            int64     `json:"size_bytes"`
		BecameCurrentAt      time.Time `json:"became_current_at"`
		ReplacedAt           time.Time `json:"replaced_at"`
		Origin               string    `json:"origin"`
		EncryptionKeyVersion int64     `json:"encryption_key_version"`
		DataFormatVersion    int64     `json:"data_format_version"`
		Restorable           bool      `json:"restorable"`
	} `json:"entries"`
}

func (f *historyFixture) list(userID string) historyListing {
	f.t.Helper()
	rec := f.do(http.MethodGet, historyRoute+"?space_id="+f.spaceID, userID, nil, nil)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("list status = %d body %s", rec.Code, rec.Body.String())
	}
	var out historyListing
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		f.t.Fatal(err)
	}
	return out
}

func (f *historyFixture) entryVersions(l *historyListing) []int64 {
	out := []int64{}
	for _, e := range l.Entries {
		out = append(out, e.SyncVersion)
	}
	return out
}

func (f *historyFixture) historyDir() string {
	return filepath.Join(filepath.Dir(sqlite.SpaceBlobPath(f.spaceID)), "history", f.spaceID)
}

func (f *historyFixture) currentBytes() string {
	f.t.Helper()
	data, err := os.ReadFile(sqlite.SpaceBlobPath(f.spaceID))
	if err != nil {
		f.t.Fatal(err)
	}
	return string(data)
}

func (f *historyFixture) historyRows() int {
	f.t.Helper()
	var n int
	if err := f.tc.DB.QueryRow(`SELECT COUNT(*) FROM space_blob_history WHERE space_id = ?`, f.spaceID).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *historyFixture) exceptionCodes() []string {
	out := []string{}
	for _, e := range f.tracker.exceptions() {
		out = append(out, e.exc.Code.String())
	}
	return out
}

func TestSnapshotHistory_FirstUploadKeepsNothingSecondKeepsReplaced(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})

	v1 := f.upload([]byte("snapshot-one"), 0, 40, nil)
	if l := f.list(f.ownerID); len(l.Entries) != 0 || f.historyRows() != 0 {
		t.Fatalf("first upload kept history: %+v", l.Entries)
	}
	if _, err := os.Stat(f.historyDir()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("history dir after first upload: %v", err)
	}

	v2 := f.upload([]byte("snapshot-two"), v1, 41, nil)
	if f.currentBytes() != "snapshot-two" {
		t.Fatalf("current = %q", f.currentBytes())
	}

	l := f.list(f.ownerID)
	if len(l.Entries) != 1 {
		t.Fatalf("entries = %+v", l.Entries)
	}
	e := l.Entries[0]
	if e.SyncVersion != v1 || e.MutationVersion != 40 || e.SizeBytes != int64(len("snapshot-one")) ||
		e.Origin != originSync || !e.Restorable || e.EncryptionKeyVersion != 1 || e.ReplacedAt.IsZero() ||
		e.BecameCurrentAt.After(e.ReplacedAt) {
		t.Fatalf("entry = %+v", e)
	}
	if l.Current.SyncVersion != v2 || l.Current.MutationVersion != 41 || l.Current.Origin != originSync ||
		l.Current.SizeBytes != int64(len("snapshot-two")) || l.Current.UpdatedAt.IsZero() {
		t.Fatalf("current = %+v", l.Current)
	}
	kept, err := os.ReadFile(filepath.Join(f.historyDir(), fmt.Sprintf("%d.db", v1)))
	if err != nil || string(kept) != "snapshot-one" {
		t.Fatalf("history file = %q, %v", kept, err)
	}
	if n := len(f.tracker.exceptions()); n != 0 {
		t.Fatalf("normal uploads reported %d exceptions", n)
	}
}

func TestSnapshotHistory_LegacyUploadRouteRecordsHistory(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
	legacy := func(body string, mv int64) {
		rec := f.do(http.MethodPost, "/api/v1/database/upload?space_id="+f.spaceID, f.ownerID, []byte(body),
			map[string]string{"X-Mutation-Version": strconv.FormatInt(mv, 10)})
		if rec.Code != http.StatusOK {
			t.Fatalf("legacy upload status = %d body %s", rec.Code, rec.Body.String())
		}
	}
	legacy("legacy-one", 5)
	legacy("legacy-two", 6)

	l := f.list(f.ownerID)
	if len(l.Entries) != 1 || l.Entries[0].SyncVersion != 1 || l.Entries[0].MutationVersion != 5 {
		t.Fatalf("entries = %+v", l.Entries)
	}
	kept, err := os.ReadFile(filepath.Join(f.historyDir(), "1.db"))
	if err != nil || string(kept) != "legacy-one" {
		t.Fatalf("history file = %q, %v", kept, err)
	}
}

func TestSnapshotHistory_OriginOfReplacedSnapshotIsKept(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})

	v1 := f.upload([]byte("imported"), 0, 10, map[string]string{"X-Out-Of-Band": "1"})
	if got := f.list(f.ownerID).Current.Origin; got != "out_of_band" {
		t.Fatalf("current origin = %q", got)
	}
	f.upload([]byte("synced"), v1, 11, nil)

	l := f.list(f.ownerID)
	if len(l.Entries) != 1 || l.Entries[0].Origin != "out_of_band" || l.Current.Origin != originSync {
		t.Fatalf("listing = %+v", l)
	}
}

func TestSnapshotHistory_PrunesBeyondKeep(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 3, days: 0})

	var version int64
	for i := 1; i <= 6; i++ {
		version = f.upload([]byte(fmt.Sprintf("snapshot-%d", i)), version, int64(i), nil)
	}

	l := f.list(f.ownerID)
	if got := f.entryVersions(&l); fmt.Sprint(got) != "[5 4 3]" {
		t.Fatalf("kept versions = %v, want [5 4 3]", got)
	}
	for _, gone := range []string{"1.db", "2.db"} {
		if _, err := os.Stat(filepath.Join(f.historyDir(), gone)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("pruned file %s still there: %v", gone, err)
		}
	}
	files, _ := os.ReadDir(f.historyDir())
	if len(files) != 3 {
		t.Errorf("history dir holds %d files, want 3", len(files))
	}
}

func TestSnapshotHistory_DailyRetentionKeepsNewestEntryPerDay(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 1, days: 7})
	v1 := f.upload([]byte("base"), 0, 1, nil)

	// Backdated entries, as if earlier days had their own uploads.
	now := time.Now().UTC()
	day := func(daysAgo int, hour int) time.Time {
		d := now.AddDate(0, 0, -daysAgo)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, time.UTC)
	}
	if err := os.MkdirAll(f.historyDir(), 0o750); err != nil {
		t.Fatal(err)
	}
	seed := []struct {
		name string
		at   time.Time
	}{
		{"d2-early", day(2, 1)},
		{"d2-late", day(2, 3)},
		{"d3-only", day(3, 2)},
		{"d10-old", day(10, 2)},
	}
	for i, s := range seed {
		path := filepath.Join(f.historyDir(), s.name+".db")
		if err := os.WriteFile(path, []byte(s.name), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := f.tc.DB.Exec(`INSERT INTO space_blob_history (space_id, file_path, sync_version, became_current_at, replaced_at)
			VALUES (?, ?, ?, ?, ?)`, f.spaceID, path, -100+i, s.at, s.at.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}

	f.upload([]byte("next"), v1, 2, nil) // archives v1 and prunes

	l := f.list(f.ownerID)
	kept := map[int64]bool{}
	for _, e := range l.Entries {
		kept[e.SyncVersion] = true
	}
	// v1 (newest, by count), d2-late (newest of its day), d3-only. d2-early
	// loses to d2-late; d10-old is outside the 7-day window.
	if len(l.Entries) != 3 || !kept[v1] || !kept[-99] || !kept[-98] {
		t.Fatalf("kept = %v", f.entryVersions(&l))
	}
	for _, gone := range []string{"d2-early.db", "d10-old.db"} {
		if _, err := os.Stat(filepath.Join(f.historyDir(), gone)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("pruned file %s still there: %v", gone, err)
		}
	}
}

func TestSnapshotHistory_KeepZeroDisablesHistory(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 0, days: 7})
	v1 := f.upload([]byte("one"), 0, 1, nil)
	f.upload([]byte("two"), v1, 2, nil)

	if n := f.historyRows(); n != 0 {
		t.Fatalf("history rows = %d with history disabled", n)
	}
	if _, err := os.Stat(f.historyDir()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("history dir with history disabled: %v", err)
	}
}

// awaitOutOfBand waits for a sync_state_changed broadcast at version.
func awaitOutOfBand(t *testing.T, client *synchub.Client, version int64) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case msg, ok := <-client.Send:
			if !ok {
				t.Fatal("send channel closed")
			}
			if msg.Type == "sync_state_changed" && msg.Version == version {
				if !msg.OutOfBand {
					t.Fatalf("restore broadcast not out-of-band: %+v", msg)
				}
				return
			}
		case <-deadline:
			t.Fatalf("no broadcast for version %d", version)
		}
	}
}

func TestRestoreSnapshot_PromotesBumpsVersionAndNotifiesOutOfBand(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7, withHub: true})
	good := bytes.Repeat([]byte("g"), 4096)
	v1 := f.upload(good, 0, 19369, nil)
	v2 := f.upload([]byte("near-empty"), v1, 19370, nil)

	client := synchub.NewClient(f.hub, nil, f.ownerID, f.spaceID)
	f.hub.Register <- client
	awaitHubRegistered(t, f.hub, f.spaceID, client)

	entryID := f.list(f.ownerID).Entries[0].ID
	rec := f.do(http.MethodPost, fmt.Sprintf("%s/%d/restore?space_id=%s", historyRoute, entryID, f.spaceID), f.ownerID, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore status = %d body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Version         int64 `json:"version"`
		MutationVersion int64 `json:"mutation_version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Version != v2+1 || resp.MutationVersion != 19369 {
		t.Fatalf("restore response = %+v", resp)
	}
	awaitOutOfBand(t, client, resp.Version)

	if !bytes.Equal([]byte(f.currentBytes()), good) {
		t.Fatal("current blob is not the restored snapshot")
	}
	dl := f.do(http.MethodGet, "/api/v1/database/blob?space_id="+f.spaceID, f.ownerID, nil, nil)
	if dl.Code != http.StatusOK || dl.Header().Get("X-Database-Version") != strconv.FormatInt(resp.Version, 10) ||
		dl.Header().Get("X-Mutation-Version") != "19369" || !bytes.Equal(dl.Body.Bytes(), good) ||
		dl.Header().Get("X-Database-Hash") != sha256Hex(good) {
		t.Fatalf("download after restore: %d %v", dl.Code, dl.Header())
	}

	l := f.list(f.ownerID)
	if l.Current.Origin != "restore" || l.Current.SyncVersion != resp.Version || l.Current.SizeBytes != int64(len(good)) {
		t.Fatalf("current = %+v", l.Current)
	}
	// The replaced current (v2) went to history; the restored entry stays.
	if got := f.entryVersions(&l); fmt.Sprint(got) != fmt.Sprint([]int64{v2, v1}) {
		t.Fatalf("history versions = %v", got)
	}
	if l.Entries[0].Origin != originSync || l.Entries[0].MutationVersion != 19370 {
		t.Fatalf("replaced current entry = %+v", l.Entries[0])
	}

	excs := f.tracker.exceptions()
	if len(excs) != 1 {
		t.Fatalf("exceptions = %v", f.exceptionCodes())
	}
	exc := excs[0].exc
	if exc.Type != "SnapshotRestored" || exc.Code != analytics.ErrCodeSnapshotRestored || exc.Status != http.StatusOK ||
		exc.Level != analytics.LevelWarning || !exc.Handled || exc.Route != historyRoute+"/:id/restore" {
		t.Fatalf("exception = %+v", exc)
	}

	// A restored snapshot is a normal base for the next upload.
	f.upload([]byte("after-restore"), resp.Version, 19371, nil)
}

func TestRestoreSnapshot_RefusesNotRestorable(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup string
	}{
		{"encryption key changed", `UPDATE budget_space_blobs SET encryption_key_version = 2 WHERE space_id = ?`},
		{"entry in a newer data format", `UPDATE space_blob_history SET data_format_version = 9 WHERE space_id = ?`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
			v1 := f.upload([]byte("one"), 0, 1, nil)
			v2 := f.upload([]byte("two"), v1, 2, nil)
			if _, err := f.tc.DB.Exec(tc.setup, f.spaceID); err != nil {
				t.Fatal(err)
			}
			l := f.list(f.ownerID)
			if l.Entries[0].Restorable {
				t.Fatalf("entry listed as restorable: %+v", l.Entries[0])
			}

			rec := f.do(http.MethodPost, fmt.Sprintf("%s/%d/restore?space_id=%s", historyRoute, l.Entries[0].ID, f.spaceID), f.ownerID, nil, nil)
			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"error":"not_restorable"`) {
				t.Fatalf("restore status = %d body %s", rec.Code, rec.Body.String())
			}
			if f.currentBytes() != "two" || f.list(f.ownerID).Current.SyncVersion != v2 {
				t.Fatal("refused restore changed the current snapshot")
			}
		})
	}
}

func TestRestoreSnapshot_ForeignSpaceAndNonMember(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
	v1 := f.upload([]byte("one"), 0, 1, nil)
	f.upload([]byte("two"), v1, 2, nil)
	entryID := f.list(f.ownerID).Entries[0].ID

	stranger := testkit.SeedUser(t, f.tc.Queries, "stranger@example.com")
	strangerSpace := testkit.SeedSpace(t, f.tc.DB, f.tc.Queries, stranger, "Stranger Space")

	// The entry id against a space the caller owns but the entry isn't in.
	rec := f.do(http.MethodPost, fmt.Sprintf("%s/%d/restore?space_id=%s", historyRoute, entryID, strangerSpace), stranger, nil, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign entry restore status = %d body %s", rec.Code, rec.Body.String())
	}
	// The real space, by someone who isn't a member.
	rec = f.do(http.MethodPost, fmt.Sprintf("%s/%d/restore?space_id=%s", historyRoute, entryID, f.spaceID), stranger, nil, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-member restore status = %d body %s", rec.Code, rec.Body.String())
	}
	if f.currentBytes() != "two" {
		t.Fatal("refused restore changed the current snapshot")
	}
	rec = f.do(http.MethodPost, fmt.Sprintf("%s/abc/restore?space_id=%s", historyRoute, f.spaceID), f.ownerID, nil, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad id status = %d", rec.Code)
	}
}

func TestSnapshotHistory_ListAndDownloadPermissions(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
	v1 := f.upload([]byte("kept-bytes"), 0, 77, nil)
	f.upload([]byte("current-bytes"), v1, 78, nil)

	member := testkit.SeedUser(t, f.tc.Queries, "member@example.com")
	testkit.SeedMembership(t, f.tc.Queries, f.spaceID, member, "member")
	stranger := testkit.SeedUser(t, f.tc.Queries, "outsider@example.com")
	strangerSpace := testkit.SeedSpace(t, f.tc.DB, f.tc.Queries, stranger, "Outsider Space")

	l := f.list(member)
	if len(l.Entries) != 1 {
		t.Fatalf("member listing = %+v", l)
	}
	entryPath := fmt.Sprintf("%s/%d", historyRoute, l.Entries[0].ID)

	dl := f.do(http.MethodGet, entryPath+"?space_id="+f.spaceID, member, nil, nil)
	if dl.Code != http.StatusOK || dl.Body.String() != "kept-bytes" {
		t.Fatalf("member download = %d %q", dl.Code, dl.Body.String())
	}
	h := dl.Header()
	if h.Get("X-Database-Version") != strconv.FormatInt(v1, 10) || h.Get("X-Mutation-Version") != "77" ||
		h.Get("X-Encryption-Key-Version") != "1" || h.Get("X-Database-Hash") != sha256Hex([]byte("kept-bytes")) ||
		h.Get("X-Budget-Space-ID") != f.spaceID || h.Get("X-Data-Format-Version") == "" ||
		h.Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("download headers = %v", h)
	}

	if rec := f.do(http.MethodGet, historyRoute+"?space_id="+f.spaceID, stranger, nil, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("non-member list status = %d", rec.Code)
	}
	if rec := f.do(http.MethodGet, entryPath+"?space_id="+f.spaceID, stranger, nil, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("non-member download status = %d", rec.Code)
	}
	if rec := f.do(http.MethodGet, entryPath+"?space_id="+strangerSpace, stranger, nil, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign entry download status = %d", rec.Code)
	}
	if rec := f.do(http.MethodGet, historyRoute+"?space_id="+f.spaceID, "", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list status = %d", rec.Code)
	}
}

func TestSnapshotHistory_ShrinkWarningReportedOnce(t *testing.T) {
	big := bytes.Repeat([]byte("b"), 300*1024)

	t.Run("large snapshot replaced by a tiny one", func(t *testing.T) {
		f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
		v1 := f.upload(big, 0, 100, nil)
		f.upload([]byte("tiny"), v1, 101, nil)

		excs := f.tracker.exceptions()
		if len(excs) != 1 {
			t.Fatalf("exceptions = %v", f.exceptionCodes())
		}
		exc := excs[0].exc
		if exc.Type != "SnapshotShrink" || exc.Code != analytics.ErrCodeSnapshotShrink || exc.Status != http.StatusOK ||
			exc.Level != analytics.LevelWarning || !exc.Handled || exc.Route != "/api/v1/database/blob" {
			t.Fatalf("exception = %+v", exc)
		}
		// Still accepted, and the large one is kept.
		if f.currentBytes() != "tiny" || f.list(f.ownerID).Entries[0].SizeBytes != int64(len(big)) {
			t.Fatal("shrunk upload not accepted or previous snapshot not kept")
		}
	})

	t.Run("legacy route", func(t *testing.T) {
		f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
		f.upload(big, 0, 100, nil)
		rec := f.do(http.MethodPost, "/api/v1/database/upload?space_id="+f.spaceID, f.ownerID, []byte("tiny"),
			map[string]string{"X-Mutation-Version": "101"})
		if rec.Code != http.StatusOK {
			t.Fatalf("legacy upload status = %d", rec.Code)
		}
		if got := f.exceptionCodes(); fmt.Sprint(got) != "[snapshot_shrink]" {
			t.Fatalf("exceptions = %v", got)
		}
	})

	t.Run("no warning", func(t *testing.T) {
		for _, tc := range []struct {
			name  string
			first []byte
			next  []byte
			extra map[string]string
		}{
			{"small snapshot shrinking", bytes.Repeat([]byte("s"), 200*1024), []byte("tiny"), nil},
			{"large snapshot shrinking to 20%", big, big[:len(big)/5], nil},
			{"out-of-band import", big, []byte("tiny"), map[string]string{"X-Out-Of-Band": "1"}},
		} {
			f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
			v1 := f.upload(tc.first, 0, 100, nil)
			f.upload(tc.next, v1, 101, tc.extra)
			if n := len(f.tracker.exceptions()); n != 0 {
				t.Errorf("%s: exceptions = %v", tc.name, f.exceptionCodes())
			}
		}
	})
}

func TestSnapshotHistory_RegressionGuardUnaffectedForNormalUploads(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
	v1 := f.upload([]byte("full"), 0, 19369, nil)
	v2 := f.upload([]byte("fuller"), v1, 19370, nil)

	rec := f.do(http.MethodPost, "/api/v1/database/blob?space_id="+f.spaceID, f.ownerID, []byte("near-empty"),
		map[string]string{"X-Database-Version": strconv.FormatInt(v2, 10), "X-Mutation-Version": "25"})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "mutation_version_regression") {
		t.Fatalf("regressing upload status = %d body %s", rec.Code, rec.Body.String())
	}
	if f.currentBytes() != "fuller" || len(f.list(f.ownerID).Entries) != 1 {
		t.Fatal("refused upload touched the snapshot or its history")
	}

	// Restoring the older snapshot is an explicit rewind: the guard doesn't
	// apply to it, and afterwards it guards from the restored position.
	entryID := f.list(f.ownerID).Entries[0].ID
	rec = f.do(http.MethodPost, fmt.Sprintf("%s/%d/restore?space_id=%s", historyRoute, entryID, f.spaceID), f.ownerID, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore status = %d body %s", rec.Code, rec.Body.String())
	}
	rec = f.do(http.MethodPost, "/api/v1/database/blob?space_id="+f.spaceID, f.ownerID, []byte("stale"),
		map[string]string{"X-Database-Version": strconv.FormatInt(v2+1, 10), "X-Mutation-Version": "19368"})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "mutation_version_regression") {
		t.Fatalf("upload below the restored position: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSnapshotHistory_AdminListAndRestore(t *testing.T) {
	f := newHistoryFixture(t, historyOptions{keep: 10, days: 7, withHub: true})
	v1 := f.upload([]byte("good"), 0, 10, nil)
	f.upload([]byte("bad"), v1, 11, nil)
	admin := testkit.SeedUser(t, f.tc.Queries, "support@example.com")

	listPath := fmt.Sprintf(adminHistoryPattern, f.spaceID)
	rec := f.do(http.MethodGet, listPath, admin, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin list status = %d body %s", rec.Code, rec.Body.String())
	}
	var l historyListing
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil {
		t.Fatal(err)
	}
	if len(l.Entries) != 1 || l.SpaceID != f.spaceID {
		t.Fatalf("admin listing = %+v", l)
	}

	rec = f.do(http.MethodPost, fmt.Sprintf("%s/%d/restore", listPath, l.Entries[0].ID), admin, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin restore status = %d body %s", rec.Code, rec.Body.String())
	}
	if f.currentBytes() != "good" || f.list(f.ownerID).Current.Origin != "restore" {
		t.Fatal("admin restore did not promote the entry")
	}
	if got := f.exceptionCodes(); fmt.Sprint(got) != "[snapshot_restored]" {
		t.Fatalf("exceptions = %v", got)
	}

	if rec := f.do(http.MethodGet, fmt.Sprintf(adminHistoryPattern, "no-such-space"), admin, nil, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown space status = %d", rec.Code)
	}
}

func TestSnapshotHistory_DeletePathsRemoveHistory(t *testing.T) {
	ctx := context.Background()
	seedHistory := func(t *testing.T) *historyFixture {
		t.Helper()
		f := newHistoryFixture(t, historyOptions{keep: 10, days: 7})
		v1 := f.upload([]byte("one"), 0, 1, nil)
		f.upload([]byte("two"), v1, 2, nil)
		if f.historyRows() != 1 {
			t.Fatal("expected one history row")
		}
		if _, err := os.Stat(f.historyDir()); err != nil {
			t.Fatal(err)
		}
		return f
	}
	requireGone := func(t *testing.T, f *historyFixture) {
		t.Helper()
		if n := f.historyRows(); n != 0 {
			t.Errorf("history rows = %d", n)
		}
		if _, err := os.Stat(f.historyDir()); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("history dir still there: %v", err)
		}
	}

	t.Run("workspace delete", func(t *testing.T) {
		f := seedHistory(t)
		if err := f.services.Space.Delete(ctx, f.ownerID, f.spaceID); err != nil {
			t.Fatal(err)
		}
		requireGone(t, f)
	})
	t.Run("data reset", func(t *testing.T) {
		f := seedHistory(t)
		if _, err := f.services.User.ResetData(ctx, f.ownerID); err != nil {
			t.Fatal(err)
		}
		requireGone(t, f)
	})
	t.Run("user purge", func(t *testing.T) {
		f := seedHistory(t)
		if _, err := f.services.UserPurge.Purge(ctx, f.ownerID); err != nil {
			t.Fatal(err)
		}
		requireGone(t, f)
	})
}
