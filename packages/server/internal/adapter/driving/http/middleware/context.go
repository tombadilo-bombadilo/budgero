package middleware

import "github.com/labstack/echo/v4"

// GetUserIDFromContext extracts user ID from Echo context.
func GetUserIDFromContext(c echo.Context) string {
	userID, ok := c.Get("user_id").(string)
	if !ok {
		return ""
	}
	return userID
}

// IsSelfHostAdminFromContext returns whether the current token denotes an admin.
func IsSelfHostAdminFromContext(c echo.Context) bool {
	v, ok := c.Get("selfhost_admin").(bool)
	return ok && v
}
