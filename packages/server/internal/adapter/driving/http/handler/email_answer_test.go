package handler_test

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/application/email"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

type fakeSender struct{ msgs []email.Message }

func (f *fakeSender) Send(_ context.Context, m email.Message) error {
	f.msgs = append(f.msgs, m)
	return nil
}

var answerLinkRE = regexp.MustCompile(`href="([^"]*/api/v1/email/answer/[^"]+)"`)

// setupEmailAnswer sends a real day-2 email through the service (fake
// transport) and returns the echo server plus the reason links in the email.
func setupEmailAnswer(t *testing.T) (e *echo.Echo, db *sql.DB, userID string, links []string) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	sender := &fakeSender{}
	svc, err := email.NewServiceWithSender(cfg, email.NewStore(sqlDB), sender)
	if err != nil {
		t.Fatal(err)
	}
	userID = testkit.SeedUser(t, queries, "answer@example.com")
	if err := svc.SendOnce(context.Background(), userID, "answer@example.com", "Ada", email.TemplateDay2Feedback); err != nil {
		t.Fatal(err)
	}
	if len(sender.msgs) != 1 {
		t.Fatalf("sent %d emails, want 1", len(sender.msgs))
	}
	for _, m := range answerLinkRE.FindAllStringSubmatch(sender.msgs[0].HTMLBody, -1) {
		links = append(links, strings.ReplaceAll(m[1], "&amp;", "&"))
	}
	if len(links) != len(email.ReasonsFor(email.TemplateDay2Feedback)) {
		t.Fatalf("found %d answer links, want %d", len(links), len(email.ReasonsFor(email.TemplateDay2Feedback)))
	}
	h := handler.NewHandlers(services, nil, handler.Options{Config: cfg, Email: svc})
	e = echo.New()
	e.GET("/api/v1/email/answer/:token", h.GetEmailAnswer)
	e.POST("/api/v1/email/answer/:token", h.PostEmailAnswer)
	db = sqlDB
	return e, db, userID, links
}

func do(e *echo.Echo, method, target string, form url.Values) *httptest.ResponseRecorder {
	var req *http.Request
	if form != nil {
		req = httptest.NewRequest(method, target, strings.NewReader(form.Encode()))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationForm)
	} else {
		req = httptest.NewRequest(method, target, http.NoBody)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func answerRow(t *testing.T, db *sql.DB, userID string) (reason, note sql.NullString) {
	t.Helper()
	if err := db.QueryRow(`SELECT reason, note FROM email_answers WHERE user_id = ?`, userID).Scan(&reason, &note); err != nil {
		t.Fatal(err)
	}
	return
}

func TestEmailAnswer_GetNeverWrites_PostRecords(t *testing.T) {
	e, db, userID, links := setupEmailAnswer(t)
	u, _ := url.Parse(links[1]) // too_much_setup
	path := u.Path

	rec := do(e, http.MethodGet, u.RequestURI(), nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `name="r" value="too_much_setup"`) {
		t.Fatalf("GET: %d %s", rec.Code, rec.Body.String())
	}
	if r, _ := answerRow(t, db, userID); r.Valid {
		t.Fatalf("GET recorded %q; a link scanner would vote", r.String)
	}

	rec = do(e, http.MethodPost, path, url.Values{"r": {"too_much_setup"}})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Too much setup") || !strings.Contains(rec.Body.String(), `name="note"`) {
		t.Fatalf("POST reason: %d %s", rec.Code, rec.Body.String())
	}
	if r, _ := answerRow(t, db, userID); r.String != "too_much_setup" {
		t.Fatalf("reason = %q", r.String)
	}

	rec = do(e, http.MethodPost, path, url.Values{"note": {"  importing from my bank took forever  "}})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "this really helps") {
		t.Fatalf("POST note: %d %s", rec.Code, rec.Body.String())
	}
	r, n := answerRow(t, db, userID)
	if r.String != "too_much_setup" || n.String != "importing from my bank took forever" {
		t.Fatalf("row = %q / %q", r.String, n.String)
	}

	// Tapping another reason changes the answer and keeps the note.
	do(e, http.MethodPost, path, url.Values{"r": {"going_well"}})
	if r, n := answerRow(t, db, userID); r.String != "going_well" || n.String == "" {
		t.Fatalf("after change: %q / %q", r.String, n.String)
	}
	// Re-opening the email link shows the saved answer, not a re-confirm.
	if rec := do(e, http.MethodGet, path, nil); !strings.Contains(rec.Body.String(), "Thanks, got it") {
		t.Fatalf("GET after answer: %s", rec.Body.String())
	}
}

func TestEmailAnswer_BadInput(t *testing.T) {
	e, db, userID, links := setupEmailAnswer(t)
	path, _ := url.Parse(links[0])

	if rec := do(e, http.MethodPost, path.Path, url.Values{"r": {"too_expensive"}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("reason from another template: %d", rec.Code)
	}
	if rec := do(e, http.MethodGet, "/api/v1/email/answer/nope?r=going_well", nil); rec.Code != http.StatusNotFound ||
		!strings.Contains(rec.Body.String(), "expired") {
		t.Fatalf("unknown token: %d", rec.Code)
	}
	if rec := do(e, http.MethodGet, path.Path+"?r=bogus", nil); !strings.Contains(rec.Body.String(), "What fits best?") {
		t.Fatalf("unknown reason should show the picker: %s", rec.Body.String())
	}

	if _, err := db.Exec(`UPDATE email_answers SET created_at = ? WHERE user_id = ?`,
		time.Now().Add(-email.AnswerTTL-time.Hour).UTC(), userID); err != nil {
		t.Fatal(err)
	}
	if rec := do(e, http.MethodPost, path.Path, url.Values{"r": {"going_well"}}); rec.Code != http.StatusNotFound {
		t.Fatalf("expired token: %d", rec.Code)
	}
}
