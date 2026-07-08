package middleware

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkjwt "github.com/clerk/clerk-sdk-go/v2/jwt"
)

func resetClerkJWKCache() {
	clerkJWKCache.mu.Lock()
	defer clerkJWKCache.mu.Unlock()
	clerkJWKCache.entries = make(map[string]clerkJWKCacheEntry)
}

func restoreClerkFunctions(
	decode func(context.Context, *clerkjwt.DecodeParams) (*clerk.UnverifiedToken, error),
	verify func(context.Context, *clerkjwt.VerifyParams) (*clerk.SessionClaims, error),
	getKey func(context.Context, *clerkjwt.GetJSONWebKeyParams) (*clerk.JSONWebKey, error),
	nowFn func() time.Time,
) {
	clerkDecodeToken = decode
	clerkVerifyToken = verify
	clerkGetJSONWebKey = getKey
	clerkNowUTC = nowFn
}

func TestVerifyClerkToken_CachesJWKByKID(t *testing.T) {
	origDecode := clerkDecodeToken
	origVerify := clerkVerifyToken
	origGetKey := clerkGetJSONWebKey
	origNow := clerkNowUTC
	t.Cleanup(func() {
		restoreClerkFunctions(origDecode, origVerify, origGetKey, origNow)
		resetClerkJWKCache()
	})
	resetClerkJWKCache()

	const expectedKID = "kid-cache-test"
	jwk := &clerk.JSONWebKey{KeyID: expectedKID}

	clerkDecodeToken = func(_ context.Context, _ *clerkjwt.DecodeParams) (*clerk.UnverifiedToken, error) {
		return &clerk.UnverifiedToken{KeyID: expectedKID}, nil
	}

	getKeyCalls := 0
	clerkGetJSONWebKey = func(_ context.Context, params *clerkjwt.GetJSONWebKeyParams) (*clerk.JSONWebKey, error) {
		getKeyCalls++
		if params == nil || params.KeyID != expectedKID {
			t.Fatalf("GetJSONWebKey() KeyID = %v, want %s", params, expectedKID)
		}
		return jwk, nil
	}

	verifyCalls := 0
	clerkVerifyToken = func(_ context.Context, params *clerkjwt.VerifyParams) (*clerk.SessionClaims, error) {
		verifyCalls++
		if params == nil || params.JWK != jwk {
			t.Fatalf("Verify() JWK = %v, want cached key", params)
		}
		return &clerk.SessionClaims{
			RegisteredClaims: clerk.RegisteredClaims{Subject: "user-1"},
		}, nil
	}

	_, err := verifyClerkToken(context.Background(), "token-value", 10*time.Second)
	if err != nil {
		t.Fatalf("first verifyClerkToken() error = %v", err)
	}
	_, err = verifyClerkToken(context.Background(), "token-value", 10*time.Second)
	if err != nil {
		t.Fatalf("second verifyClerkToken() error = %v", err)
	}

	if getKeyCalls != 1 {
		t.Errorf("GetJSONWebKey() calls = %d, want 1", getKeyCalls)
	}
	if verifyCalls != 2 {
		t.Errorf("Verify() calls = %d, want 2", verifyCalls)
	}
}

func TestVerifyClerkToken_RefreshesCachedKeyOnFailure(t *testing.T) {
	origDecode := clerkDecodeToken
	origVerify := clerkVerifyToken
	origGetKey := clerkGetJSONWebKey
	origNow := clerkNowUTC
	t.Cleanup(func() {
		restoreClerkFunctions(origDecode, origVerify, origGetKey, origNow)
		resetClerkJWKCache()
	})
	resetClerkJWKCache()

	const expectedKID = "kid-rotating"
	oldJWK := &clerk.JSONWebKey{KeyID: expectedKID}
	newJWK := &clerk.JSONWebKey{KeyID: expectedKID}
	setCachedClerkJWK(expectedKID, oldJWK, time.Now().UTC())

	clerkDecodeToken = func(_ context.Context, _ *clerkjwt.DecodeParams) (*clerk.UnverifiedToken, error) {
		return &clerk.UnverifiedToken{KeyID: expectedKID}, nil
	}

	getKeyCalls := 0
	clerkGetJSONWebKey = func(_ context.Context, params *clerkjwt.GetJSONWebKeyParams) (*clerk.JSONWebKey, error) {
		getKeyCalls++
		if params == nil || params.KeyID != expectedKID {
			t.Fatalf("GetJSONWebKey() KeyID = %v, want %s", params, expectedKID)
		}
		return newJWK, nil
	}

	verifyCalls := 0
	clerkVerifyToken = func(_ context.Context, params *clerkjwt.VerifyParams) (*clerk.SessionClaims, error) {
		verifyCalls++
		if params == nil {
			t.Fatal("Verify() params is nil")
			return nil, errors.New("nil params")
		}
		switch params.JWK {
		case oldJWK:
			return nil, errors.New("signature verification failed")
		case newJWK:
			return &clerk.SessionClaims{
				RegisteredClaims: clerk.RegisteredClaims{Subject: "user-1"},
			}, nil
		default:
			t.Fatalf("Verify() received unexpected JWK: %#v", params.JWK)
			return nil, errors.New("unexpected jwk")
		}
	}

	_, err := verifyClerkToken(context.Background(), "token-value", 10*time.Second)
	if err != nil {
		t.Fatalf("verifyClerkToken() error = %v", err)
	}

	if getKeyCalls != 1 {
		t.Errorf("GetJSONWebKey() calls = %d, want 1", getKeyCalls)
	}
	if verifyCalls != 2 {
		t.Errorf("Verify() calls = %d, want 2", verifyCalls)
	}

	cached := getCachedClerkJWK(expectedKID, time.Now().UTC())
	if cached != newJWK {
		t.Errorf("cached JWK = %#v, want new JWK %#v", cached, newJWK)
	}
}

func TestVerifyClerkToken_WithoutKIDFallsBackToDirectVerify(t *testing.T) {
	origDecode := clerkDecodeToken
	origVerify := clerkVerifyToken
	origGetKey := clerkGetJSONWebKey
	origNow := clerkNowUTC
	t.Cleanup(func() {
		restoreClerkFunctions(origDecode, origVerify, origGetKey, origNow)
		resetClerkJWKCache()
	})
	resetClerkJWKCache()

	clerkDecodeToken = func(_ context.Context, _ *clerkjwt.DecodeParams) (*clerk.UnverifiedToken, error) {
		return &clerk.UnverifiedToken{}, nil
	}

	getKeyCalls := 0
	clerkGetJSONWebKey = func(_ context.Context, _ *clerkjwt.GetJSONWebKeyParams) (*clerk.JSONWebKey, error) {
		getKeyCalls++
		return &clerk.JSONWebKey{}, nil
	}

	verifyCalls := 0
	clerkVerifyToken = func(_ context.Context, params *clerkjwt.VerifyParams) (*clerk.SessionClaims, error) {
		verifyCalls++
		if params == nil {
			t.Fatal("Verify() params is nil")
			return nil, errors.New("nil params")
		}
		if params.JWK != nil {
			t.Fatalf("Verify() JWK = %#v, want nil", params.JWK)
		}
		return &clerk.SessionClaims{
			RegisteredClaims: clerk.RegisteredClaims{Subject: "user-1"},
		}, nil
	}

	_, err := verifyClerkToken(context.Background(), "token-value", 10*time.Second)
	if err != nil {
		t.Fatalf("verifyClerkToken() error = %v", err)
	}

	if getKeyCalls != 0 {
		t.Errorf("GetJSONWebKey() calls = %d, want 0", getKeyCalls)
	}
	if verifyCalls != 1 {
		t.Errorf("Verify() calls = %d, want 1", verifyCalls)
	}
}
