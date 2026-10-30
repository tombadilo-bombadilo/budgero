package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"

	"budgero-server/internal/domain/analytics"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	sqlite "modernc.org/sqlite"
)

// modulePath is this module's import path (go.mod); frames under it are ours.
const modulePath = "budgero-server"

// selfPath is this file's module-relative path, used to find the module root
// in the paths the runtime reports (a build directory, or modulePath under
// -trimpath). Frames are "ours" when their file sits under that root, which
// also holds for closures the compiler inlined and renamed into another
// package's symbol.
const selfPath = "internal/adapter/driving/http/middleware/errors.go"

var moduleRoot = func() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok || !strings.HasSuffix(file, selfPath) {
		return ""
	}
	return strings.TrimSuffix(file, selfPath)
}()

// maxFrames bounds the frames sent per exception (the innermost ones win).
const maxFrames = 30

// ExceptionSink receives server exceptions; the analytics tracker implements it.
type ExceptionSink interface {
	CaptureException(distinctID string, exc analytics.ServerException)
}

// panicError carries a recovered panic through the error handler: the value,
// the goroutine stack for the log and the program counters for the frames.
type panicError struct {
	value any
	stack []byte
	pcs   []uintptr
}

func (p *panicError) Error() string { return fmt.Sprintf("panic: %v", p.value) }

func (p *panicError) Unwrap() error {
	err, _ := p.value.(error)
	return err
}

// causeWithStack wraps an internal error with the program counters of the
// place it was attached to the HTTP error, so the exception's frames point
// at the failing handler rather than at the error handler.
type causeWithStack struct {
	err error
	pcs []uintptr
}

func (c *causeWithStack) Error() string { return c.err.Error() }
func (c *causeWithStack) Unwrap() error { return c.err }

// WithStack records where err was turned into an HTTP error. Use it with
// SetInternal; InternalError does both.
func WithStack(err error) error {
	if err == nil {
		return nil
	}
	return &causeWithStack{err: err, pcs: callers(3)}
}

// InternalError builds the HTTP error the client sees (status + fixed public
// message) with cause attached as its internal error, so ErrorHandler logs
// the cause and reports it with the caller's frames.
func InternalError(status int, publicMsg string, cause error) *echo.HTTPError {
	he := echo.NewHTTPError(status, publicMsg)
	if cause != nil {
		he.SetInternal(&causeWithStack{err: cause, pcs: callers(3)})
	}
	return he
}

// callers returns the program counters above skip frames (skip counts
// runtime.Callers itself, like runtime.Callers does).
func callers(skip int) []uintptr {
	pcs := make([]uintptr, 64)
	n := runtime.Callers(skip, pcs)
	return pcs[:n]
}

// RecoverConfig makes Echo's Recover hand panics to ErrorHandler as a
// panicError instead of printing them through its own logger: the stack of
// the panicking goroutine is attached for the log line and the program
// counters (taken while still on the panicking stack) for the frames.
func RecoverConfig() middleware.RecoverConfig {
	return middleware.RecoverConfig{
		StackSize:       64 << 10,
		DisableStackAll: true,
		LogErrorFunc: func(_ echo.Context, err error, stack []byte) error {
			// Recover wraps non-error values in fmt.Errorf("%v", r); keep the
			// error as the value either way, the handler never prints it.
			return &panicError{value: err, stack: stack, pcs: callers(1)}
		},
	}
}

// errorHandledKey marks a request ErrorHandler already processed: with
// RequestLogger's HandleError the same error reaches it a second time from
// Echo's ServeHTTP once the response is committed.
const errorHandledKey = "error_handled"

// ErrorHandler is the central echo.HTTPErrorHandler. It writes the same
// status and public message Echo's default would, plus the request id, and
// for 5xx and panics it logs one Error line with the cause (server log
// only) and reports one $exception to sink with fixed identifiers only.
// version is the server build version reported with each exception.
func ErrorHandler(sink ExceptionSink, version string) echo.HTTPErrorHandler {
	return func(err error, c echo.Context) {
		if handled, _ := c.Get(errorHandledKey).(bool); handled {
			return
		}
		c.Set(errorHandledKey, true)
		he := publicError(err)

		if he.Code >= 500 {
			reportServerError(c, err, he, sink, version)
		}

		if c.Response().Committed {
			return
		}
		var writeErr error
		if c.Request().Method == http.MethodHead {
			writeErr = c.NoContent(he.Code)
		} else {
			writeErr = c.JSON(he.Code, errorBody(he, RequestID(c)))
		}
		if writeErr != nil {
			logger := Logger(c)
			logger.Error().Err(writeErr).Msg("failed to write error response")
		}
	}
}

// publicError resolves what the client is told, exactly as Echo's default
// handler does: an *HTTPError as is (an *HTTPError nested as Internal
// replaces it), anything else a generic 500.
func publicError(err error) *echo.HTTPError {
	he, ok := err.(*echo.HTTPError) //nolint:errorlint // mirrors echo.DefaultHTTPErrorHandler on purpose
	if !ok {
		return &echo.HTTPError{Code: http.StatusInternalServerError, Message: http.StatusText(http.StatusInternalServerError)}
	}
	if inner, ok := he.Internal.(*echo.HTTPError); ok { //nolint:errorlint // same
		return inner
	}
	return he
}

func errorBody(he *echo.HTTPError, requestID string) any {
	switch m := he.Message.(type) {
	case string:
		return echo.Map{"message": m, "request_id": requestID}
	case json.Marshaler:
		return m
	case error:
		return echo.Map{"message": m.Error(), "request_id": requestID}
	}
	return echo.Map{"message": he.Message, "request_id": requestID}
}

func reportServerError(c echo.Context, err error, he *echo.HTTPError, sink ExceptionSink, version string) {
	c.Set(errorLoggedKey, true)

	cause := err
	if he.Internal != nil {
		cause = he.Internal
	}
	var pe *panicError
	isPanic := errors.As(err, &pe)

	route := c.Path()
	method := c.Request().Method
	logger := Logger(c)
	ev := logger.Error().
		Str("method", method).
		Int("status", he.Code).
		Err(cause)
	if isPanic {
		ev = ev.Str("stack", string(pe.stack))
		ev.Msg("panic recovered")
	} else {
		ev.Msg("request failed")
	}

	if sink == nil {
		return
	}
	exc := analytics.ServerException{
		Type:          rootErrorType(err),
		Code:          classifyError(err),
		Mechanism:     analytics.MechanismHTTP5xx,
		Route:         route,
		Method:        method,
		Status:        he.Code,
		RequestID:     RequestID(c),
		ServerVersion: version,
	}
	var pcs []uintptr
	switch {
	case isPanic:
		exc.Type = "panic"
		exc.Code = analytics.ErrCodePanic
		exc.Mechanism = analytics.MechanismPanic
		pcs = afterPanic(pe.pcs)
	default:
		var cws *causeWithStack
		if errors.As(err, &cws) {
			pcs = cws.pcs
		} else {
			// No capture point: the error handler's own stack still names
			// the middleware chain.
			pcs = callers(3)
		}
	}
	exc.Frames = frames(pcs)
	sink.CaptureException(GetUserIDFromContext(c), exc)
}

// wrapperTypes are error types that only wrap another error; the reported
// type is the first one in the chain that is not one of these.
var wrapperTypes = map[string]bool{
	"*echo.HTTPError":            true,
	"*middleware.panicError":     true,
	"*middleware.causeWithStack": true,
	"*fmt.wrapError":             true,
	"*fmt.wrapErrors":            true,
	"*errors.joinError":          true,
}

// rootErrorType returns the Go type name of the outermost error in the chain
// that is not a plain wrapper, e.g. "*sqlite.Error" or "*errors.errorString";
// a chain of wrappers only reports the outermost type. A type name is a
// fixed identifier; the message is never used.
func rootErrorType(err error) string {
	if err == nil {
		return "error"
	}
	for e := err; e != nil; e = errors.Unwrap(e) {
		name := reflect.TypeOf(e).String()
		if !wrapperTypes[name] {
			return name
		}
	}
	return reflect.TypeOf(err).String()
}

// SQLite primary result codes (modernc.org/sqlite lib constants).
const (
	sqliteBusy       = 5
	sqliteLocked     = 6
	sqliteConstraint = 19
)

// classifyError maps an error chain onto a bounded ErrorCode.
func classifyError(err error) analytics.ErrorCode {
	var pe *panicError
	if errors.As(err, &pe) {
		return analytics.ErrCodePanic
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) {
		return analytics.ErrCodeTimeout
	}
	var se *sqlite.Error
	if errors.As(err, &se) {
		switch se.Code() & 0xff {
		case sqliteBusy, sqliteLocked:
			return analytics.ErrCodeDBLocked
		case sqliteConstraint:
			return analytics.ErrCodeDBConstraint
		}
		return analytics.ErrCodeDBError
	}
	if errors.Is(err, sql.ErrConnDone) || errors.Is(err, sql.ErrTxDone) || errors.Is(err, sql.ErrNoRows) {
		return analytics.ErrCodeDBError
	}
	var pathErr *fs.PathError
	var linkErr *os.LinkError
	if errors.As(err, &pathErr) || errors.As(err, &linkErr) ||
		errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) || errors.Is(err, fs.ErrExist) {
		return analytics.ErrCodeStorage
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return analytics.ErrCodeTimeout
		}
		return analytics.ErrCodeUpstream
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return analytics.ErrCodeUpstream
	}
	return analytics.ErrCodeInternal
}

// afterPanic drops the frames above runtime.gopanic (runtime.Callers, the
// recover closure, Echo's Recover) so the frames start at the panic site.
func afterPanic(pcs []uintptr) []uintptr {
	iter := runtime.CallersFrames(pcs)
	for i := 0; ; i++ {
		f, more := iter.Next()
		if f.Function == "runtime.gopanic" {
			if i+1 < len(pcs) {
				return pcs[i+1:]
			}
			return nil
		}
		if !more {
			return pcs
		}
	}
}

// frames converts program counters (innermost first) into the module's own
// frames, oldest first and crashing frame last, at most maxFrames.
func frames(pcs []uintptr) []analytics.Frame {
	if len(pcs) == 0 {
		return nil
	}
	var out []analytics.Frame
	iter := runtime.CallersFrames(pcs)
	for {
		f, more := iter.Next()
		if inModule(f) {
			out = append(out, moduleFrame(f))
			if len(out) == maxFrames {
				break
			}
		}
		if !more {
			break
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// inModule reports whether the frame's source file belongs to this module.
// Falls back to the symbol's import path when the module root is unknown.
func inModule(f runtime.Frame) bool {
	if moduleRoot != "" {
		return strings.HasPrefix(f.File, moduleRoot)
	}
	return strings.HasPrefix(f.Function, modulePath+"/") || strings.HasPrefix(f.Function, modulePath+".")
}

// moduleFrame builds a Frame with the module-relative file path and the
// function's short symbol (import path stripped), so no build directory
// ever appears in the output.
func moduleFrame(f runtime.Frame) analytics.Frame {
	file := filepath.Base(f.File)
	if moduleRoot != "" {
		file = strings.TrimPrefix(f.File, moduleRoot)
	}
	short := f.Function
	if idx := strings.LastIndex(short, "/"); idx >= 0 {
		short = short[idx+1:]
	}
	return analytics.Frame{Filename: file, Function: short, Line: f.Line}
}
