import { Link } from 'react-router-dom';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Spinner } from '@shared/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { Lock, Pencil, Star, Trash2 } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';

interface WorkspaceRowProps {
  space: BudgetSpaceSummary;
  isActive?: boolean;
  isDefault: boolean;
  isLoading: boolean;
  isEditing: boolean;
  editingName: string;
  isUpdatingName: boolean;
  onEditingNameChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onSwitch: () => void;
  onToggleDefault: () => void;
}

/** One workspace row in the "Workspaces" card: identity, status badges, and row actions. */
export function WorkspaceRow({
  space,
  isActive = false,
  isDefault,
  isLoading,
  isEditing,
  editingName,
  isUpdatingName,
  onEditingNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onSwitch,
  onToggleDefault,
}: WorkspaceRowProps) {
  const isAccessible = space.invitation_status === 'accepted' && space.is_accessible !== false;
  const isLocked = space.invitation_status === 'accepted' && !isAccessible;
  const canSetDefault = isAccessible;
  const canRename = space.role === 'owner' && isAccessible;
  const canDelete = space.role === 'owner' && isAccessible;
  const lockMessage =
    space.access_reason === 'owned_subscription_required'
      ? 'This workspace is locked because your plan is inactive. Subscribe to regain access.'
      : space.access_reason === 'shared_owner_inactive'
        ? 'This shared workspace is locked until the owner renews their plan, or you subscribe.'
        : null;

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between',
        isLocked ? 'border-amber-500/50 bg-amber-500/5' : '',
        isDefault ? 'border-amber-400/70 bg-amber-500/10 dark:border-amber-400/50' : ''
      )}
    >
      <div className="space-y-1">
        {isEditing ? (
          <Input
            value={editingName}
            onChange={(event) => onEditingNameChange(event.target.value)}
            className="h-8"
            autoFocus
          />
        ) : (
          <div className="text-sm font-medium">{space.display_name || 'Unnamed workspace'}</div>
        )}
        <div className="text-xs text-muted-foreground">
          Role: {space.role}
          {space.invitation_status !== 'accepted' && ` • ${space.invitation_status}`}
        </div>
        {lockMessage ? (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{lockMessage}</span>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {isActive ? <Badge variant="secondary">Active</Badge> : null}
        {isLocked ? (
          <Badge variant="outline" className="border-amber-500/70 text-amber-700">
            Access blocked
          </Badge>
        ) : null}
        {canRename ? (
          isEditing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdatingName || !editingName.trim()}
                onClick={onSaveEdit}
                loading={isUpdatingName}
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelEdit} disabled={isUpdatingName}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" onClick={onStartEdit} className="h-8 w-8">
              <Pencil className="h-4 w-4" />
            </Button>
          )
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${space.display_name || 'workspace'}`}
            onClick={onDelete}
            className="h-8 w-8 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
        {!isActive && isAccessible ? (
          <Button variant="outline" size="sm" disabled={isLoading} onClick={onSwitch}>
            {isLoading ? <Spinner /> : 'Switch'}
          </Button>
        ) : null}
        {isLocked ? (
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/subscription">Subscribe</Link>
          </Button>
        ) : null}
        {canSetDefault ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={isDefault ? 'Clear default workspace' : 'Set as default workspace'}
                onClick={onToggleDefault}
                className={cn(
                  'h-8 w-8 text-muted-foreground',
                  isDefault ? 'text-amber-600 dark:text-amber-400' : ''
                )}
              >
                <Star className={cn('h-4 w-4', isDefault ? 'fill-current' : '')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isDefault ? 'Clear default workspace' : 'Set as default workspace'}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {isDefault ? (
          <Badge
            variant="outline"
            className="border-amber-500/80 text-amber-700 dark:border-amber-400/60 dark:text-amber-300"
          >
            Default
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
