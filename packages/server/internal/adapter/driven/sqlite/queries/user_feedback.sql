-- name: InsertUserFeedback :exec
INSERT INTO user_feedback (
    id, user_id, category, body, contact_back,
    screen_path, app_version, user_agent, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
