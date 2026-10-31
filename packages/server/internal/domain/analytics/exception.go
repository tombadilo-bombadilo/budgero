package analytics

import "strconv"

// ExceptionEventName is PostHog's error-tracking event.
const ExceptionEventName = "$exception"

// ErrorCode is the coarse class of a server failure.
type ErrorCode struct{ v string }

// ErrorCode values.
var (
	ErrCodeInternal     = ErrorCode{"internal"}
	ErrCodeDBError      = ErrorCode{"db_error"}
	ErrCodeDBConstraint = ErrorCode{"db_constraint"}
	ErrCodeDBLocked     = ErrorCode{"db_locked"}
	ErrCodeStorage      = ErrorCode{"storage_error"}
	ErrCodeUpstream     = ErrorCode{"upstream_error"}
	ErrCodeTimeout      = ErrorCode{"timeout"}
	ErrCodePanic        = ErrorCode{"panic"}
	// Sync refusals: handled 4xx answers the client is expected to recover
	// from, reported as warnings because they are the sync failures that
	// are otherwise invisible server-side.
	ErrCodeSnapshotRegression    = ErrorCode{"snapshot_regression"}
	ErrCodeSnapshotConflict      = ErrorCode{"snapshot_conflict"}
	ErrCodeEncryptionKeyOutdated = ErrorCode{"encryption_key_outdated"}
	ErrCodeFormatTooNew          = ErrorCode{"format_too_new"}
	// Snapshot history warnings: accepted requests worth seeing in error
	// tracking. A large snapshot replaced by a much smaller one, and an
	// explicit restore from the server-side history.
	ErrCodeSnapshotShrink   = ErrorCode{"snapshot_shrink"}
	ErrCodeSnapshotRestored = ErrorCode{"snapshot_restored"}
)

// String returns the wire value.
func (c ErrorCode) String() string { return c.v }

// ExceptionMechanism says how the failure surfaced.
type ExceptionMechanism struct{ v string }

// ExceptionMechanism values.
var (
	MechanismPanic   = ExceptionMechanism{"panic"}
	MechanismHTTP5xx = ExceptionMechanism{"http_5xx"}
	// MechanismRefusal is a request the server deliberately refused.
	MechanismRefusal = ExceptionMechanism{"refusal"}
)

// ExceptionLevel is PostHog's $exception_level.
type ExceptionLevel struct{ v string }

// ExceptionLevel values.
var (
	LevelError   = ExceptionLevel{"error"}
	LevelWarning = ExceptionLevel{"warning"}
)

// Frame is one stack frame of our own module. Filename is module-relative
// (e.g. internal/adapter/driving/http/handler/sync.go) and Function has the
// package path stripped, so neither can carry a build machine path.
type Frame struct {
	Filename string
	Function string
	Line     int
}

// ServerException describes one failed request for PostHog error tracking.
// Every field is a fixed identifier: a Go type name, an ErrorCode, a route
// template, an HTTP method/status, a request id, the client's random
// per-page-load session token or one of our own frames. It never carries
// the error message.
type ServerException struct {
	// Type is the Go type name of the root error (e.g. *sqlite.Error),
	// "panic", or a fixed refusal name (e.g. SnapshotRegression).
	Type      string
	Code      ErrorCode
	Mechanism ExceptionMechanism
	Route     string
	Method    string
	Status    int
	RequestID string
	// ClientSession is the client's random per-page-load token
	// (X-Client-Session), empty when the client sent none. It identifies a
	// page load, not a person.
	ClientSession string
	ServerVersion string
	// Level defaults to LevelError.
	Level ExceptionLevel
	// Handled marks a failure the server answered on purpose (a refusal)
	// rather than one it did not expect.
	Handled bool
	// Frames are ordered oldest first, crashing frame last.
	Frames []Frame
}

// Event builds the $exception event. Flat properties are enum/identifier
// strings; the structured $exception_list goes through Payload.
func (x *ServerException) Event() Event {
	typ := x.Type
	if typ == "" {
		typ = "error"
	}
	route := x.Route
	if route == "" {
		route = "unmatched"
	}
	code := x.Code
	if code.v == "" {
		code = ErrCodeInternal
	}
	mech := x.Mechanism
	if mech.v == "" {
		mech = MechanismHTTP5xx
	}
	level := x.Level
	if level.v == "" {
		level = LevelError
	}
	props := map[string]string{
		"$exception_level": level.v,
		"error_code":       code.v,
		"route":            route,
		"method":           x.Method,
		"status":           strconv.Itoa(x.Status),
	}
	if x.Method == "" {
		delete(props, "method")
	}
	if x.RequestID != "" {
		props["request_id"] = x.RequestID
	}
	if x.ClientSession != "" {
		props["client_session"] = x.ClientSession
	}
	if x.ServerVersion != "" {
		props["server_version"] = x.ServerVersion
	}

	frames := make([]map[string]any, 0, len(x.Frames))
	for _, f := range x.Frames {
		frames = append(frames, map[string]any{
			"platform": "go",
			"filename": f.Filename,
			"lineno":   f.Line,
			"function": f.Function,
			"in_app":   true,
		})
	}
	ev := newEvent(ExceptionEventName, props)
	ev.payload = map[string]any{
		"$exception_list": []map[string]any{{
			"type":  typ,
			"value": typ + " · " + code.v + " · " + route,
			"mechanism": map[string]any{
				"handled":   x.Handled,
				"synthetic": false,
				"type":      mech.v,
			},
			"stacktrace": map[string]any{
				"type":   "raw",
				"frames": frames,
			},
		}},
	}
	return ev
}
