package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// HeaderRequestID is the request id header, read from the client when it
// is well-formed and always set on the response.
const HeaderRequestID = "X-Request-Id"

const requestIDKey = "request_id"

// clientRequestID is what we accept from a client: an opaque token, long
// enough to be unique, short and plain enough to log verbatim.
var clientRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// RequestIDMiddleware gives every request an id. A well-formed X-Request-Id
// from the client is kept (so the app can correlate its own logs); anything
// else is replaced by 16 random bytes in hex. The id is echoed in the
// X-Request-Id response header, stored for RequestID and included in the
// error body, so a user-reported error can be found in the server logs.
// Register it first so every later middleware and log line can use it.
func RequestIDMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			id := c.Request().Header.Get(HeaderRequestID)
			if !clientRequestID.MatchString(id) {
				id = newRequestID()
			}
			c.Set(requestIDKey, id)
			c.Response().Header().Set(HeaderRequestID, id)
			return next(c)
		}
	}
}

func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand never fails on supported platforms; a fixed id is
		// still better than no id.
		return "00000000000000000000000000000000"
	}
	return hex.EncodeToString(b[:])
}

// RequestID returns the request id set by RequestIDMiddleware, or "".
func RequestID(c echo.Context) string {
	id, _ := c.Get(requestIDKey).(string)
	return id
}

// Logger returns the global logger with the request id, the route template
// and, once the auth middleware has run, the user id attached. Handlers use
// it for anything they log about the current request.
func Logger(c echo.Context) zerolog.Logger {
	ctx := log.Logger.With()
	if id := RequestID(c); id != "" {
		ctx = ctx.Str("request_id", id)
	}
	if route := c.Path(); route != "" {
		ctx = ctx.Str("route", route)
	}
	if userID := GetUserIDFromContext(c); userID != "" {
		ctx = ctx.Str("user_id", userID)
	}
	return ctx.Logger()
}
