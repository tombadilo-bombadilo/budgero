-- name: GetSpaceByID :one
SELECT * FROM budget_spaces WHERE space_id = ?;

-- name: GetSpaceOwner :one
SELECT owner_user_id FROM budget_spaces WHERE space_id = ?;

-- name: CreateSpace :one
INSERT INTO budget_spaces (space_id, owner_user_id, display_name, created_at)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: UpdateSpaceDisplayName :exec
UPDATE budget_spaces
SET display_name = ?, updated_at = datetime('now')
WHERE space_id = ?;

-- name: DeleteSpace :exec
DELETE FROM budget_spaces WHERE space_id = ?;

-- name: CountOccupiedCollaboratorSlotsByOwner :one
SELECT
  (
    SELECT COUNT(*)
    FROM budget_space_members m
    INNER JOIN budget_spaces s ON s.space_id = m.space_id
    WHERE s.owner_user_id = ?
      AND m.role = 'member'
      AND m.invitation_status = 'accepted'
  ) + (
    SELECT COUNT(*)
    FROM budget_space_invites i
    INNER JOIN budget_spaces s ON s.space_id = i.space_id
    WHERE s.owner_user_id = ?
      AND i.status = 'pending'
      AND (? = '' OR i.id != ?)
  );

-- name: ListSpacesByOwner :many
SELECT * FROM budget_spaces WHERE owner_user_id = ? ORDER BY created_at ASC;
