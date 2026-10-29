package handler_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func getSignups(t *testing.T, selfHost bool, query string) (*httptest.ResponseRecorder, error) {
	t.Helper()
	h, e, tc := setupVersionHandler(t, selfHost, nil)
	if _, err := tc.DB.Exec(`INSERT INTO users (id, email, created_at) VALUES
		('a', 'a@example.com', '2026-10-05 09:00:00.1 +0000 UTC m=+1.0'),
		('b', 'b@example.com', '2026-10-20 09:00:00.1 +0000 UTC m=+1.0')`); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	err := h.GetAdminSignups(e.NewContext(httptest.NewRequest(http.MethodGet, "/admin/signups?"+query, http.NoBody), rec))
	return rec, err
}

func TestGetAdminSignups(t *testing.T) {
	rec, err := getSignups(t, false, "from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z&granularity=monthly")
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Total  int `json:"total"`
		Points []struct {
			Start   string `json:"start"`
			Signups int    `json:"signups"`
		} `json:"points"`
	}
	if jsonErr := json.Unmarshal(rec.Body.Bytes(), &body); jsonErr != nil {
		t.Fatal(jsonErr)
	}
	if body.Total != 2 || len(body.Points) != 1 || body.Points[0].Start != "2026-10-01" {
		t.Fatalf("body = %+v", body)
	}

	for _, q := range []string{"granularity=hourly", "from=yesterday", "from=2026-10-31T00:00:00Z&to=2026-10-01T00:00:00Z"} {
		_, qErr := getSignups(t, false, q)
		var he *echo.HTTPError
		if !errors.As(qErr, &he) || he.Code != http.StatusBadRequest {
			t.Errorf("%s: err = %v, want 400", q, qErr)
		}
	}

	_, err = getSignups(t, true, "")
	var he *echo.HTTPError
	if !errors.As(err, &he) || he.Code != http.StatusNotFound {
		t.Fatalf("self-host err = %v, want 404", err)
	}
}
