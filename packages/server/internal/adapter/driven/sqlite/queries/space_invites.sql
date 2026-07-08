-- name: GetSpaceInviteByID :one
SELECT * FROM budget_space_invites WHERE id = ?;

-- name: GetSpaceInviteBySecret :one
SELECT
    i.id,
    i.space_id,
    s.display_name,
    i.inviter_user_id,
    i.encrypted_bundle,
    i.status,
    i.expires_at
FROM budget_space_invites i
INNER JOIN budget_spaces s ON s.space_id = i.space_id
WHERE i.invite_secret = ?;

-- name: CreateSpaceInvite :one
INSERT INTO budget_space_invites (
    id, space_id, inviter_user_id, invitee_email, invite_secret,
    encrypted_bundle, status, expires_at, created_at
) VALUES (?, ?, ?, ?, ?, '', 'pending', ?, ?)
RETURNING *;

-- name: UpdateInviteBundle :exec
UPDATE budget_space_invites
SET encrypted_bundle = ?
WHERE id = ? AND space_id = ? AND status = 'pending';

-- name: MarkInviteRedeemed :exec
UPDATE budget_space_invites
SET status = 'redeemed', redeemed_at = ?, redeemed_by = ?, invite_secret = ''
WHERE id = ?;

-- name: MarkInviteExpired :exec
UPDATE budget_space_invites
SET status = 'expired', invite_secret = ''
WHERE id = ?;

-- name: DeleteSpaceInvite :exec
DELETE FROM budget_space_invites WHERE id = ? AND space_id = ?;

-- name: ListSpaceInvites :many
SELECT * FROM budget_space_invites
WHERE space_id = ?
ORDER BY created_at DESC;

-- name: DeleteAllInvitesForSpace :exec
DELETE FROM budget_space_invites WHERE space_id = ?;
