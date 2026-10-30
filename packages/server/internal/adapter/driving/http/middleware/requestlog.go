package middleware

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rs/zerolog"
)

// errorLoggedKey marks a request whose failure ErrorHandler already logged,
// so RequestLogger does not log it a second time.
const errorLoggedKey = "error_logged"

// RequestLogger logs failed API requests: 4xx at Warn, 5xx at Error.
// Successful requests are not logged (metrics cover them). Returned errors
// are handed to ErrorHandler first (HandleError), and a 5xx it logged is
// skipped here: that one line already carries the cause and stack.
// redactURI strips secrets from the logged URI.
func RequestLogger(redactURI func(string) string) echo.MiddlewareFunc {
	if redactURI == nil {
		redactURI = func(s string) string { return s }
	}
	return middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus:   true,
		LogMethod:   true,
		LogURI:      true,
		LogError:    true,
		HandleError: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			if v.Status < 400 {
				return nil
			}
			if logged, _ := c.Get(errorLoggedKey).(bool); logged {
				return nil
			}
			logger := Logger(c)
			var ev *zerolog.Event
			if v.Status >= 500 {
				ev = logger.Error()
			} else {
				ev = logger.Warn()
			}
			ev.Int("status", v.Status).
				Str("method", v.Method).
				Str("uri", redactURI(v.URI)).
				Err(v.Error).
				Msg("request failed")
			return nil
		},
	})
}
