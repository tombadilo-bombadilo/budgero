package handler

import (
	"context"

	httpmiddleware "budgero-server/internal/adapter/driving/http/middleware"
)

// ensureWorkspaceAccess resolves a workspace and enforces ownership entitlement rules:
// - owners must have an active subscription or active trial
// - collaboration-only users can access member workspaces only
func (h *Handlers) ensureWorkspaceAccess(ctx context.Context, userID, requestedSpaceID string) (string, error) {
	if h.selfHostMode {
		return h.services.Space.ResolveSpaceID(ctx, userID, requestedSpaceID)
	}

	resolvedID, _, err := httpmiddleware.CheckWorkspaceAccess(
		ctx,
		userID,
		requestedSpaceID,
		h.services.User,
		h.services.Space,
	)
	if err != nil {
		return "", err
	}
	return resolvedID, nil
}
