package handler

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"os"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// Offline entitlement signing (ES256)
// Private key is provided as PEM via OFFLINE_ECDSA_PRIV_PEM or OFFLINE_ECDSA_PRIV_PATH

var offlinePriv *ecdsa.PrivateKey
var offlinePub *ecdsa.PublicKey

func initOfflineSigner(cfg *config.Config) {
	pemStr := cfg.External.OfflineECDSAPrivPEM
	if pemStr == "" && cfg.External.OfflineECDSAPrivPath != "" {
		data, err := os.ReadFile(cfg.External.OfflineECDSAPrivPath)
		if err != nil {
			log.Error().Err(err).Str("path", cfg.External.OfflineECDSAPrivPath).Msg("Failed to read offline key file")
			return
		}
		pemStr = string(data)
	}
	if pemStr == "" {
		log.Warn().Msg("OFFLINE_ECDSA_PRIV_PEM not set – offline entitlement signing disabled")
		return
	}
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		log.Error().Msg("Failed to parse OFFLINE_ECDSA_PRIV_PEM")
		return
	}
	pk, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		// Try PKCS8
		if keyAny, err2 := x509.ParsePKCS8PrivateKey(block.Bytes); err2 == nil {
			if k, ok := keyAny.(*ecdsa.PrivateKey); ok {
				offlinePriv = k
				offlinePub = &k.PublicKey
				log.Info().Msg("Loaded ES256 private key (PKCS8)")
				return
			}
		}
		log.Error().Err(err).Msg("Failed to parse EC private key")
		return
	}
	offlinePriv = pk
	offlinePub = &pk.PublicKey
	log.Info().Msg("Loaded ES256 private key (SEC1)")
}

// OfflineEntitlementClaims minimal set
type OfflineEntitlementClaims struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
	Ent struct {
		Founding  bool   `json:"founding"`
		Beta      bool   `json:"beta"`
		BetaExp   *int64 `json:"beta_exp,omitempty"`
		Sub       string `json:"subscription"`
		PeriodEnd *int64 `json:"period_end,omitempty"`
	} `json:"ent"`
}

// Sign compact JWS (header.payload.signature) with ES256
func signES256(payload []byte) (string, error) {
	header := map[string]string{"alg": "ES256", "typ": "JWT"}
	h, _ := json.Marshal(header)
	enc := base64.RawURLEncoding
	hp := enc.EncodeToString(h)
	pp := enc.EncodeToString(payload)
	signing := []byte(hp + "." + pp)
	r, s, err := ecdsa.Sign(rand.Reader, offlinePriv, sha256Bytes(signing))
	if err != nil {
		return "", err
	}
	sig := asn1ToJws(r, s, 32)
	sp := enc.EncodeToString(sig)
	return hp + "." + pp + "." + sp, nil
}

// Helpers
func sha256Bytes(b []byte) []byte { h := sha256Sum(b); return h[:] }
func sha256Sum(b []byte) [32]byte { return sha256.Sum256(b) }

// Convert ASN.1 ECDSA signature (r,s) to JWS (raw r||s)
func asn1ToJws(r, s *big.Int, size int) []byte {
	rb := r.Bytes()
	sb := s.Bytes()
	out := make([]byte, size*2)
	copy(out[size-len(rb):size], rb)
	copy(out[2*size-len(sb):], sb)
	return out
}

// GetOfflinePubKey returns the public JWK for ES256 offline signing.
func (h *Handlers) GetOfflinePubKey(c echo.Context) error {
	if offlinePub == nil {
		initOfflineSigner(h.cfg)
	}
	if offlinePub == nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "offline signing disabled"})
	}
	// Take the uncompressed point (0x04 || X || Y) via the ECDH view rather
	// than the deprecated ecdsa.PublicKey.X/.Y big.Int fields. For P-256 this
	// is 65 bytes with X and Y already left-padded to 32 bytes each.
	ecdhPub, err := offlinePub.ECDH()
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "offline signing key unusable"})
	}
	point := ecdhPub.Bytes()
	if len(point) != 65 {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "offline signing key unusable"})
	}
	jwk := map[string]string{
		"kty": "EC",
		"crv": "P-256",
		"alg": "ES256",
		"x":   base64.RawURLEncoding.EncodeToString(point[1:33]),
		"y":   base64.RawURLEncoding.EncodeToString(point[33:65]),
	}
	return c.JSON(http.StatusOK, jwk)
}

// IssueOfflineEntitlement issues an offline entitlement (requires active subscription).
func (h *Handlers) IssueOfflineEntitlement(c echo.Context) error {
	if offlinePriv == nil {
		initOfflineSigner(h.cfg)
	}
	if offlinePriv == nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "offline signing disabled"})
	}

	uid := middleware.GetUserIDFromContext(c)
	if uid == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, uid)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "user not found"})
	}

	eligible := false
	hasOpenEndedGrant := false
	var latestGrantEnd time.Time
	nowTime := time.Now()
	grant := func(end *time.Time) {
		eligible = true
		if end == nil {
			hasOpenEndedGrant = true
		} else if end.After(latestGrantEnd) {
			latestGrantEnd = *end
		}
	}
	if user.IsFoundingMember {
		grant(nil)
	}
	if user.SubscriptionStatus == domain.SubscriptionLifetime {
		grant(nil)
	}
	if user.HasBetaAccess {
		if user.BetaExpiresAt == nil || user.BetaExpiresAt.After(nowTime) {
			grant(user.BetaExpiresAt)
		}
	}
	if user.SubscriptionStatus == domain.SubscriptionActive {
		grant(nil)
	}
	if user.SubscriptionStatus == domain.SubscriptionTrialing || user.SubscriptionStatus == domain.SubscriptionOnTrial {
		if user.TrialEndsAt != nil && user.TrialEndsAt.After(nowTime) {
			grant(user.TrialEndsAt)
		}
	}
	if user.SubscriptionStatus == domain.SubscriptionPastDue {
		if user.CurrentPeriodEnd != nil && user.CurrentPeriodEnd.After(nowTime) {
			grant(user.CurrentPeriodEnd)
		}
	}
	if user.SubscriptionStatus == domain.SubscriptionCancelled {
		if user.SubscriptionEndsAt != nil && user.SubscriptionEndsAt.After(nowTime) {
			grant(user.SubscriptionEndsAt)
		}
	}
	if !eligible {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "access not eligible for offline entitlement"})
	}

	// Token must not outlive a time-limited entitlement
	expTime := nowTime.Add(14 * 24 * time.Hour)
	if !hasOpenEndedGrant && latestGrantEnd.Before(expTime) {
		expTime = latestGrantEnd
	}
	now := nowTime.Unix()
	exp := expTime.Unix()
	claims := OfflineEntitlementClaims{Sub: uid, Iat: now, Exp: exp}
	claims.Ent.Founding = user.IsFoundingMember
	claims.Ent.Beta = user.HasBetaAccess
	if user.BetaExpiresAt != nil {
		t := user.BetaExpiresAt.Unix()
		claims.Ent.BetaExp = &t
	}
	claims.Ent.Sub = user.SubscriptionStatus
	// For cancelled subscriptions, use SubscriptionEndsAt as the period end
	if user.SubscriptionStatus == "cancelled" && user.SubscriptionEndsAt != nil {
		t := user.SubscriptionEndsAt.Unix()
		claims.Ent.PeriodEnd = &t
	} else if user.CurrentPeriodEnd != nil {
		t := user.CurrentPeriodEnd.Unix()
		claims.Ent.PeriodEnd = &t
	}

	payload, _ := json.Marshal(claims)
	token, err := signES256(payload)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "sign error"})
	}
	return c.JSON(http.StatusOK, map[string]string{"token": token})
}
