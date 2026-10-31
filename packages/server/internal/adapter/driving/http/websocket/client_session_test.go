package websocket

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"
)

func logLine(t *testing.T, c *Client) map[string]any {
	t.Helper()
	var buf bytes.Buffer
	base := zerolog.New(&buf)
	l := c.withLogFields(&base)
	l.Warn().Msg("catch-up failed")
	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line); err != nil {
		t.Fatalf("log line: %v (%q)", err, buf.String())
	}
	return line
}

func TestClient_LogContextCarriesClientSession(t *testing.T) {
	c := NewClient(nil, nil, "user-1", "space-1").WithClientSession("page-load_0123")
	if c.ClientSession() != "page-load_0123" {
		t.Fatalf("ClientSession() = %q", c.ClientSession())
	}
	line := logLine(t, c)
	if line["client_session"] != "page-load_0123" || line["user_id"] != "user-1" || line["space_id"] != "space-1" {
		t.Fatalf("line = %v", line)
	}

	// Without a session the field is absent, not empty.
	bare := logLine(t, NewClient(nil, nil, "user-1", "space-1"))
	if _, ok := bare["client_session"]; ok {
		t.Fatalf("client_session must be absent: %v", bare)
	}
}
