package handler

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

type selfHostAdminStats struct {
	Mode                 string                  `json:"mode"`
	DatabasePath         string                  `json:"databasePath"`
	DatabaseSizeBytes    int64                   `json:"databaseSizeBytes"`
	DatabaseLastModified *time.Time              `json:"databaseLastModified,omitempty"`
	TotalUsers           int64                   `json:"totalUsers"`
	AdminUsers           int64                   `json:"adminUsers"`
	LocalAccounts        int64                   `json:"localAccounts"`
	MasterPasswordUsers  int64                   `json:"masterPasswordUsers"`
	SpaceCount           int64                   `json:"spaceCount"`
	SpacesWithMembers    int64                   `json:"spacesWithMembers"`
	TotalMemberships     int64                   `json:"totalMemberships"`
	SpaceBlobBytes       int64                   `json:"spaceBlobBytes"`
	PendingInvites       int64                   `json:"pendingInvites"`
	RecentUsers          []repository.RecentUser `json:"recentUsers"`
}

// GetSelfHostAdminStats surfaces deployment-focused metrics for self-host admins.
func (h *Handlers) GetSelfHostAdminStats(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}

	ctx := c.Request().Context()

	dbStats, err := h.services.Admin.GetSelfHostStats(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load stats")
	}

	recentUsers, err := h.services.Admin.ListRecentUsers(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load recent users")
	}

	dbPath := sqlite.ResolvePath()
	stats := selfHostAdminStats{
		DatabasePath:        dbPath,
		TotalUsers:          dbStats.TotalUsers,
		LocalAccounts:       dbStats.LocalAccounts,
		AdminUsers:          dbStats.AdminUsers,
		MasterPasswordUsers: dbStats.MasterPasswordUsers,
		SpaceCount:          dbStats.SpaceCount,
		SpacesWithMembers:   dbStats.SpacesWithMembers,
		TotalMemberships:    dbStats.TotalMemberships,
		SpaceBlobBytes:      dbStats.SpaceBlobBytes,
		PendingInvites:      dbStats.PendingInvites,
		RecentUsers:         recentUsers,
	}
	stats.Mode = "self_host"

	if stats.DatabasePath != "" {
		if info, err := os.Stat(stats.DatabasePath); err == nil {
			stats.DatabaseSizeBytes = info.Size()
			mod := info.ModTime()
			stats.DatabaseLastModified = &mod
		}
	}

	return c.JSON(http.StatusOK, stats)
}

// GetSelfHostAdminUsers lists users with local-auth centric metadata.
func (h *Handlers) GetSelfHostAdminUsers(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}

	ctx := c.Request().Context()
	users, err := h.services.Admin.ListSelfHostUsers(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load users")
	}

	return c.JSON(http.StatusOK, users)
}

// CreateSelfHostUser allows admins to create new users.
func (h *Handlers) CreateSelfHostUser(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}

	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"isAdmin"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "email is required")
	}
	if len(req.Password) < 8 {
		return echo.NewHTTPError(http.StatusBadRequest, "password must be at least 8 characters")
	}

	ctx := c.Request().Context()
	user, err := h.usecases.CreateLocalUser.Execute(ctx, req.Name, req.Email, req.Password, req.IsAdmin)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success": true,
		"user": map[string]interface{}{
			"id":      user.ID,
			"email":   user.Email,
			"name":    user.Name,
			"isAdmin": req.IsAdmin,
		},
	})
}

// SelfHostResetUserPassword allows admins to force a password reset for any user.
func (h *Handlers) SelfHostResetUserPassword(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}

	userID := strings.TrimSpace(c.Param("id"))
	if userID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user id required")
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	req.Password = strings.TrimSpace(req.Password)
	if len(req.Password) < 8 {
		return echo.NewHTTPError(http.StatusBadRequest, "password must be at least 8 characters")
	}

	ctx := c.Request().Context()
	if err := h.services.Credential.ResetPassword(ctx, userID, req.Password); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to reset password")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}

// DeleteSelfHostUser removes a user and owned budget spaces entirely.
func (h *Handlers) DeleteSelfHostUser(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}

	userID := strings.TrimSpace(c.Param("id"))
	if userID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user id required")
	}

	ctx := c.Request().Context()
	spaceIDs, err := h.services.User.DeleteWithSpaces(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete user")
	}

	if h.syncHub != nil {
		for _, spaceID := range spaceIDs {
			if err := h.syncHub.ResetSpace(spaceID); err != nil {
				log.Error().Err(err).Str("space_id", spaceID).Msg("failed to reset sync state after deleting user")
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":       true,
		"removedSpaces": spaceIDs,
	})
}

// DownloadSelfHostDatabase streams the SQLite file for backups.
func (h *Handlers) DownloadSelfHostDatabase(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}

	path := sqlite.ResolvePath()
	file, err := os.Open(path) //nolint:gosec // G304: path from sqlite.ResolvePath() is controlled
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to open database file")
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to inspect database file")
	}

	filename := filepath.Base(path)
	c.Response().Header().Set(echo.HeaderContentDisposition, "attachment; filename="+filename)
	c.Response().Header().Set(echo.HeaderContentLength, strconv.FormatInt(info.Size(), 10))
	return c.Stream(http.StatusOK, "application/octet-stream", file)
}
