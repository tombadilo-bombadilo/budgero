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

// HeaderClientSession carries the web client's random per-page-load id. The
// sync WebSocket, which cannot set headers, sends it as the
// QueryClientSession query parameter instead.
const HeaderClientSession = "X-Client-Session"

// QueryClientSession is the sync WebSocket's client session query parameter.
const QueryClientSession = "client_session"

const (
	requestIDKey     = "request_id"
	clientSessionKey = "client_session"
)

// clientRequestID is what we accept from a client, for request and session
// ids alike: an opaque token, long enough to be unique, short and plain
// enough to log verbatim.
var clientRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// RequestIDMiddleware gives every request an id. A well-formed X-Request-Id
// from the client is kept (so the app can correlate its own logs); anything
// else is replaced by 16 random bytes in hex. The id is echoed in the
// X-Request-Id response header, stored for RequestID and included in the
// error body, so a user-reported error can be found in the server logs.
// A well-formed X-Client-Session is stored for ClientSession; a malformed
// one is ignored. Register it first so every later middleware and log line
// can use them.
func RequestIDMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			id := c.Request().Header.Get(HeaderRequestID)
			if !clientRequestID.MatchString(id) {
				id = newRequestID()
			}
			c.Set(requestIDKey, id)
			c.Response().Header().Set(HeaderRequestID, id)
			SetClientSession(c, c.Request().Header.Get(HeaderClientSession))
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

// ValidClientSession returns id when it is a well-formed client session id
// (^[A-Za-z0-9_-]{8,64}$), otherwise "".
func ValidClientSession(id string) string {
	if !clientRequestID.MatchString(id) {
		return ""
	}
	return id
}

// SetClientSession stores id as the request's client session when it is
// well-formed; anything else is ignored and leaves the current value.
func SetClientSession(c echo.Context, id string) {
	if id = ValidClientSession(id); id != "" {
		c.Set(clientSessionKey, id)
	}
}

// ClientSession returns the client's per-page-load session id, or "".
func ClientSession(c echo.Context) string {
	id, _ := c.Get(clientSessionKey).(string)
	return id
}

// Logger returns the global logger with the request id, the client session,
// the route template and, once the auth middleware has run, the user id
// attached. Handlers use it for anything they log about the current request.
func Logger(c echo.Context) zerolog.Logger {
	ctx := log.Logger.With()
	if id := RequestID(c); id != "" {
		ctx = ctx.Str("request_id", id)
	}
	if session := ClientSession(c); session != "" {
		ctx = ctx.Str("client_session", session)
	}
	if route := c.Path(); route != "" {
		ctx = ctx.Str("route", route)
	}
	if userID := GetUserIDFromContext(c); userID != "" {
		ctx = ctx.Str("user_id", userID)
	}
	return ctx.Logger()
}
