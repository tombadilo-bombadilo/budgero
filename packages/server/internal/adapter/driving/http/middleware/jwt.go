// Package middleware provides HTTP middleware for authentication and security.
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"budgero-server/internal/config"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkjwt "github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// SelfHostClaims represents JWT claims for self-hosted auth.
type SelfHostClaims struct {
	jwt.RegisteredClaims
	IsAdmin bool `json:"is_admin"`
}

type clerkJWKCacheEntry struct {
	jwk       *clerk.JSONWebKey
	expiresAt time.Time
}

var (
	selfHostSecret     []byte
	selfHostSecretOnce sync.Once
	selfHostTTL        time.Duration

	clerkJWKCache = struct {
		mu      sync.Mutex
		entries map[string]clerkJWKCacheEntry
	}{
		entries: make(map[string]clerkJWKCacheEntry),
	}

	clerkDecodeToken   = clerkjwt.Decode
	clerkVerifyToken   = clerkjwt.Verify
	clerkGetJSONWebKey = clerkjwt.GetJSONWebKey
	clerkNowUTC        = func() time.Time { return time.Now().UTC() }
)

const clerkJWKCacheTTL = time.Hour

// JWTMiddleware returns middleware appropriate for SaaS or self-host deployments.
func JWTMiddleware(cfg *config.Config) echo.MiddlewareFunc {
	if cfg.Auth.SelfHostable {
		initSelfHostSecret(cfg)
		return selfHostJWTMiddleware()
	}

	// Initialize Clerk if we have the key
	if cfg.Auth.ClerkSecretKey != "" {
		clerk.SetKey(cfg.Auth.ClerkSecretKey)
	}

	leeway := time.Duration(cfg.Auth.ClerkJWTLeeway) * time.Second

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			tokenString, err := extractBearerToken(c)
			if err != nil {
				return err
			}

			// Verify with Clerk; retry once for minor clock skew
			claims, verifyErr := verifyClerkToken(c.Request().Context(), tokenString, leeway)
			if verifyErr != nil {
				errStr := strings.ToLower(verifyErr.Error())
				if strings.Contains(errStr, "issued in the future") || strings.Contains(errStr, "iat") {
					time.Sleep(1200 * time.Millisecond)
					claims, verifyErr = verifyClerkToken(c.Request().Context(), tokenString, leeway)
				}
			}
			if verifyErr != nil {
				log.Error().Err(verifyErr).Msg("Failed to verify Clerk token")
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid token")
			}

			// Store Clerk user ID as the user_id
			c.Set("user_id", claims.Subject)
			return next(c)
		}
	}
}

func verifyClerkToken(ctx context.Context, token string, leeway time.Duration) (*clerk.SessionClaims, error) {
	decoded, err := clerkDecodeToken(ctx, &clerkjwt.DecodeParams{Token: token})
	if err != nil {
		return nil, err
	}

	kid := ""
	if decoded != nil {
		kid = strings.TrimSpace(decoded.KeyID)
	}

	// If KID is missing, fall back to default Clerk verification path.
	if kid == "" {
		return clerkVerifyToken(ctx, &clerkjwt.VerifyParams{Token: token, Leeway: leeway})
	}

	now := clerkNowUTC()
	if cached := getCachedClerkJWK(kid, now); cached != nil {
		claims, verifyErr := clerkVerifyToken(ctx, &clerkjwt.VerifyParams{
			Token:  token,
			Leeway: leeway,
			JWK:    cached,
		})
		if verifyErr == nil {
			return claims, nil
		}
		log.Debug().Err(verifyErr).Str("kid", kid).Msg("Cached Clerk JWK verification failed; refreshing key")
	}

	freshJWK, err := clerkGetJSONWebKey(ctx, &clerkjwt.GetJSONWebKeyParams{KeyID: kid})
	if err != nil {
		return nil, err
	}
	if freshJWK == nil {
		return nil, fmt.Errorf("missing json web key for kid %s", kid)
	}
	setCachedClerkJWK(kid, freshJWK, now)

	return clerkVerifyToken(ctx, &clerkjwt.VerifyParams{
		Token:  token,
		Leeway: leeway,
		JWK:    freshJWK,
	})
}

func getCachedClerkJWK(kid string, now time.Time) *clerk.JSONWebKey {
	if kid == "" {
		return nil
	}
	clerkJWKCache.mu.Lock()
	defer clerkJWKCache.mu.Unlock()

	entry, ok := clerkJWKCache.entries[kid]
	if !ok {
		return nil
	}
	if now.After(entry.expiresAt) {
		delete(clerkJWKCache.entries, kid)
		return nil
	}
	return entry.jwk
}

func setCachedClerkJWK(kid string, jwk *clerk.JSONWebKey, now time.Time) {
	if kid == "" || jwk == nil {
		return
	}
	clerkJWKCache.mu.Lock()
	defer clerkJWKCache.mu.Unlock()
	clerkJWKCache.entries[kid] = clerkJWKCacheEntry{
		jwk:       jwk,
		expiresAt: now.Add(clerkJWKCacheTTL),
	}
}

func initSelfHostSecret(cfg *config.Config) {
	selfHostSecretOnce.Do(func() {
		secret := strings.TrimSpace(cfg.Auth.JWTSecret)
		if secret == "" {
			secret = randomSelfHostSecret()
		}
		selfHostSecret = []byte(secret)
		selfHostTTL = time.Duration(cfg.Auth.JWTTTLHours) * time.Hour
		if selfHostTTL == 0 {
			selfHostTTL = 24 * time.Hour
		}
	})
}

func selfHostJWTMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			tokenString, err := extractBearerToken(c)
			if err != nil {
				return err
			}
			claims, err := ParseSelfHostToken(tokenString)
			if err != nil {
				log.Debug().Err(err).Msg("failed to validate self-host token")
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid token")
			}
			c.Set("user_id", claims.Subject)
			c.Set("selfhost_admin", claims.IsAdmin)
			return next(c)
		}
	}
}

func extractBearerToken(c echo.Context) (string, error) {
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" {
		log.Debug().Msg("No Authorization header present")
		return "", echo.NewHTTPError(http.StatusUnauthorized, "missing authorization header")
	}
	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenString == authHeader {
		log.Debug().Msg("Invalid Authorization header format")
		return "", echo.NewHTTPError(http.StatusUnauthorized, "invalid authorization header format")
	}
	return strings.TrimSpace(tokenString), nil
}

// GenerateSelfHostToken creates a JWT for self-hosted authentication.
func GenerateSelfHostToken(userID string, isAdmin bool) (string, error) {
	if len(selfHostSecret) == 0 {
		return "", fmt.Errorf("self-host secret not initialized")
	}
	if strings.TrimSpace(userID) == "" {
		return "", fmt.Errorf("user id required")
	}
	if selfHostTTL == 0 {
		selfHostTTL = 24 * time.Hour
	}
	now := time.Now()
	claims := SelfHostClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-1 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(selfHostTTL)),
		},
		IsAdmin: isAdmin,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(selfHostSecret)
}

// ParseSelfHostToken validates and parses a self-hosted JWT.
func ParseSelfHostToken(tokenString string) (*SelfHostClaims, error) {
	if len(selfHostSecret) == 0 {
		return nil, fmt.Errorf("self-host secret not initialized")
	}
	parsedToken, err := jwt.ParseWithClaims(tokenString, &SelfHostClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return selfHostSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsedToken.Claims.(*SelfHostClaims)
	if !ok || !parsedToken.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// InitSelfHostAuth initializes self-host authentication with the given config.
// Call this at startup before any auth operations.
func InitSelfHostAuth(cfg *config.Config) {
	if cfg.Auth.SelfHostable {
		initSelfHostSecret(cfg)
	}
}

func randomSelfHostSecret() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// Never fall back to a guessable, time-derived signing key — a server
		// that cannot obtain randomness must not issue forgeable tokens.
		panic(fmt.Sprintf("cannot generate self-host JWT secret: %v", err))
	}
	return hex.EncodeToString(buf)
}
