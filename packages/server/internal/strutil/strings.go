// Package strutil holds small, dependency-free string helpers shared across
// the server without pulling in domain or application packages (avoids import cycles).
package strutil

import "strings"

// FirstWord returns the first whitespace-delimited word of fullName, or "" if
// empty. Used for email greetings — "Hi Alex," reads better than
// "Hi Alex Johnson," in the email body.
func FirstWord(fullName string) string {
	fullName = strings.TrimSpace(fullName)
	if fullName == "" {
		return ""
	}
	if idx := strings.IndexAny(fullName, " \t"); idx > 0 {
		return fullName[:idx]
	}
	return fullName
}
