// Package crypto provides cryptographic utility functions.
package crypto //nolint:revive // crypto is an appropriate name for this internal package

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

// HashToken computes the SHA-256 hash of a token string.
func HashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// ComputeDataHash computes the SHA-256 hash of binary data.
func ComputeDataHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// identifierRegexp validates SQL identifier names.
var identifierRegexp = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// IsValidIdentifier checks if a name is a valid SQL identifier.
func IsValidIdentifier(name string) bool {
	return identifierRegexp.MatchString(name)
}
