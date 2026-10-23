package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/labstack/echo/v4"
)

// blockStatusStub answers IsBlocked only; other UserService methods panic.
type blockStatusStub struct {
	driving.UserService
	blocked bool
	err     error
}

func (s blockStatusStub) IsBlocked(context.Context, string) (bool, error) {
	return s.blocked, s.err
}

func runBlockedMiddleware(t *testing.T, users driving.UserService) (reached bool, err error) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/profile", http.NoBody)
	c := e.NewContext(req, httptest.NewRecorder())
	c.Set("user_id", "user-1")

	h := middleware.BlockedUserMiddleware(users)(func(echo.Context) error {
		reached = true
		return nil
	})
	return reached, h(c)
}

func TestBlockedUserMiddleware(t *testing.T) {
	tests := []struct {
		name        string
		stub        blockStatusStub
		wantReached bool
		wantStatus  int
	}{
		{name: "not blocked passes", stub: blockStatusStub{}, wantReached: true},
		{name: "unknown user passes", stub: blockStatusStub{err: domain.ErrUserNotFound}, wantReached: true},
		{name: "blocked is forbidden", stub: blockStatusStub{blocked: true}, wantStatus: http.StatusForbidden},
		{name: "lookup failure fails closed", stub: blockStatusStub{err: errors.New("database is locked")}, wantStatus: http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reached, err := runBlockedMiddleware(t, tt.stub)
			if reached != tt.wantReached {
				t.Fatalf("next handler reached = %v, want %v", reached, tt.wantReached)
			}
			if tt.wantStatus == 0 {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			var httpErr *echo.HTTPError
			if !errors.As(err, &httpErr) || httpErr.Code != tt.wantStatus {
				t.Fatalf("error = %v, want HTTP %d", err, tt.wantStatus)
			}
		})
	}
}
