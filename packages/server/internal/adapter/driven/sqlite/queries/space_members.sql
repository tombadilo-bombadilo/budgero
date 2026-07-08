-- name: GetSpaceMember :one
SELECT * FROM budget_space_members WHERE space_id = ? AND user_id = ?;

-- name: GetMemberInvitationStatus :one
SELECT invitation_status FROM budget_space_members WHERE space_id = ? AND user_id = ?;

-- name: CreateSpaceMember :exec
INSERT INTO budget_space_members (
    space_id, user_id, role, encrypted_space_key, invitation_status, invited_at, accepted_at
) VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: UpdateMemberStatus :exec
UPDATE budget_space_members
SET invitation_status = ?, accepted_at = datetime('now')
WHERE space_id = ? AND user_id = ?;

-- name: UpdateMemberEncryptedKey :exec
UPDATE budget_space_members
SET encrypted_space_key = ?, invitation_status = 'accepted', accepted_at = datetime('now')
WHERE space_id = ? AND user_id = ?;

-- name: DeleteSpaceMember :exec
DELETE FROM budget_space_members WHERE space_id = ? AND user_id = ?;

-- name: ListSpaceMembers :many
SELECT
    m.space_id,
    m.user_id,
    COALESCE(u.name, '') AS user_name,
    COALESCE(u.email, '') AS user_email,
    m.role,
    m.encrypted_space_key,
    m.invitation_status,
    m.invite_secret,
    m.invited_at,
    m.accepted_at
FROM budget_space_members m
LEFT JOIN users u ON u.id = m.user_id
WHERE m.space_id = ?
ORDER BY m.role ASC, m.invited_at ASC;

-- name: ListSpacesForUser :many
SELECT
    s.space_id,
    s.display_name,
    s.owner_user_id,
    s.created_at,
    s.updated_at,
    m.role,
    m.invitation_status,
    m.encrypted_space_key
FROM budget_space_members m
INNER JOIN budget_spaces s ON s.space_id = m.space_id
WHERE m.user_id = ?
ORDER BY s.created_at ASC;

-- name: GetFirstAcceptedMembership :one
SELECT space_id
FROM budget_space_members
WHERE user_id = ? AND invitation_status = 'accepted'
ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, invited_at
LIMIT 1;

-- name: CountAcceptedMemberships :one
SELECT COUNT(*) FROM budget_space_members
WHERE user_id = ? AND invitation_status = 'accepted';

-- name: DeleteAllMembershipsForUser :exec
DELETE FROM budget_space_members WHERE user_id = ?;

-- name: DeleteAllMembershipsForSpace :exec
DELETE FROM budget_space_members WHERE space_id = ?;
