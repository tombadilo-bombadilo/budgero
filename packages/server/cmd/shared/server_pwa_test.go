package shared //nolint:revive // var-naming: tests access unexported helpers in the shared command package

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/labstack/echo/v4"
)

func TestSetPWAHeadersDoesNotCacheHTMLShell(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "root shell", path: "/index.html", want: "no-cache, no-store, must-revalidate"},
		{name: "hashed asset", path: "/assets/index-abc123.js", want: "public, max-age=31536000"},
		{name: "service worker", path: "/sw.js", want: "no-cache, no-store, must-revalidate"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			ctx := e.NewContext(httptest.NewRequest(http.MethodGet, tt.path, http.NoBody), httptest.NewRecorder())

			setPWAHeaders(ctx, tt.path)

			if got := ctx.Response().Header().Get("Cache-Control"); got != tt.want {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPWAStaticServesTheAppForRoutesThatAreAlsoDirectories(t *testing.T) {
	previous := webAssets
	webAssets = fstest.MapFS{
		"dist/index.html":              {Data: []byte("<!doctype html><title>app</title>")},
		"dist/onboarding/accounts.png": {Data: []byte("png")},
		"dist/assets/app-abc.js":       {Data: []byte("js")},
	}
	t.Cleanup(func() { webAssets = previous })

	e := echo.New()
	e.Use(pwaStaticMiddleware())
	e.GET("/*", func(c echo.Context) error { return c.NoContent(http.StatusNotFound) })

	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, http.NoBody))
		return rec
	}

	// /onboarding is an app route and a directory of images (2026-11-02:
	// served as an empty, year-cached octet-stream; with a slash, a 500).
	for _, path := range []string{"/onboarding", "/onboarding/"} {
		rec := get(path)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<title>app</title>") {
			t.Fatalf("%s = %d %q", path, rec.Code, rec.Body.String())
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-cache, no-store, must-revalidate" {
			t.Fatalf("%s Cache-Control = %q", path, cc)
		}
	}
	if rec := get("/onboarding/accounts.png"); rec.Code != http.StatusOK || rec.Body.String() != "png" {
		t.Fatalf("image = %d %q", rec.Code, rec.Body.String())
	}
	if rec := get("/assets/app-abc.js"); rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "public, max-age=31536000" {
		t.Fatalf("asset = %d %v", rec.Code, rec.Header())
	}
	if rec := get("/missing.png"); rec.Code != http.StatusNotFound {
		t.Fatalf("missing file = %d", rec.Code)
	}
}
