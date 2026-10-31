package shared //nolint:revive // var-naming: tests access unexported helpers in the shared command package

import "testing"

func TestRedactURIHidesRelayTickets(t *testing.T) {
	cases := map[string]string{
		"/api/v1/bank-relay/dXNlcg.1790969784.sig/":               "/api/v1/bank-relay/[redacted]",
		"/api/v1/bank-relay/ticket-lookalike.1.sig":               "/api/v1/bank-relay/[redacted]",
		"/api/v1/bank-relay/ticket":                               "/api/v1/bank-relay/ticket",
		"/api/v1/ws/sync?token=eyJhbGciOi.secret.sig&space_id=s1": "/api/v1/ws/sync?space_id=s1&token=%5Bredacted%5D",
		"/api/v1/database/blob?space_id=s1":                       "/api/v1/database/blob?space_id=s1",
		"/api/v1/health":                                          "/api/v1/health",
	}
	for in, want := range cases {
		if got := redactURI(in); got != want {
			t.Errorf("redactURI(%q) = %q, want %q", in, got, want)
		}
	}
}
