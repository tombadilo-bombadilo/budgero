import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import type { AdminUserDetails } from '@features/admin/model/admin-users';
import { formatShortDate } from '../admin-users.utils';
import { TabSection } from './TabSection';
import { CompactMetric, EmptyState, SectionError } from './primitives';

export function WorkspacesTab({
  details,
  loading,
  error,
  onRetry,
}: {
  details: AdminUserDetails | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <TabSection loading={loading} error={error} onRetry={onRetry}>
      <Card>
        <CardHeader>
          <CardTitle>Workspace Access</CardTitle>
          <CardDescription>
            Membership footprint and owner-wide collaborator seat usage.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <CompactMetric
            label="Owned Workspaces"
            value={`${details?.workspaces.ownedWorkspaceCount ?? 0}`}
          />
          <CompactMetric
            label="Collaborator Workspaces"
            value={`${details?.workspaces.collaboratorWorkspaceCount ?? 0}`}
          />
          <CompactMetric
            label="Shares Used"
            value={`${details?.workspaces.ownedShareSeatsUsed ?? 0}/${details?.workspaces.ownedShareSeatsLimit ?? 5}`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace Memberships</CardTitle>
          <CardDescription>
            Every workspace this account belongs to, including invitation status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SectionError message={details?.sectionErrors?.workspaces} />
          {details?.workspaces.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.workspaces.items.map((workspace) => (
                  <TableRow key={`${workspace.spaceId}-${workspace.role}`}>
                    <TableCell>
                      <div className="font-medium">
                        {workspace.displayName || workspace.spaceId}
                      </div>
                      <div className="text-xs text-muted-foreground">{workspace.spaceId}</div>
                    </TableCell>
                    <TableCell className="capitalize">{workspace.role}</TableCell>
                    <TableCell className="capitalize">{workspace.invitationStatus}</TableCell>
                    <TableCell>{workspace.ownerUserId}</TableCell>
                    <TableCell>{formatShortDate(workspace.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState message="This user is not attached to any workspaces." />
          )}
        </CardContent>
      </Card>
    </TabSection>
  );
}
