-- name: GetUserPreferences :one
SELECT * FROM user_preferences WHERE user_id = ?;

-- name: UpsertUserPreferences :exec
INSERT INTO user_preferences (
    user_id,
    theme_mode,
    theme_preset,
    classic_font,
    home_page,
    desktop_budget_layout,
    compact_mobile_layout,
    mobile_budget_layout,
    master_password_storage_mode,
    master_password_storage_days
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
    theme_mode = excluded.theme_mode,
    theme_preset = excluded.theme_preset,
    classic_font = excluded.classic_font,
    home_page = excluded.home_page,
    desktop_budget_layout = excluded.desktop_budget_layout,
    compact_mobile_layout = excluded.compact_mobile_layout,
    mobile_budget_layout = excluded.mobile_budget_layout,
    master_password_storage_mode = excluded.master_password_storage_mode,
    master_password_storage_days = excluded.master_password_storage_days,
    updated_at = datetime('now');
