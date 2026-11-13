import { Trans } from '@lingui/react/macro';
import { Wallet, Search, Plus } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { useEmptyStateViewed } from '@shared/lib/analytics/first-month';

interface EmptyStateDisplayProps {
  type: 'no-categories' | 'no-search-results';
  searchTerm?: string;
  onAddCategoryGroup?: () => void;
}

export function EmptyStateDisplay({
  type,
  searchTerm,
  onAddCategoryGroup,
}: EmptyStateDisplayProps) {
  useEmptyStateViewed('budget', type === 'no-categories');
  if (type === 'no-categories') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">
          <Trans>Start Building Your Budget</Trans>
        </h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          <Trans>
            Create category groups to organize your spending, then add categories within each group.
          </Trans>
        </p>
        {onAddCategoryGroup && (
          <Button onClick={onAddCategoryGroup} size="sm">
            <Trans>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Category Group
            </Trans>
          </Button>
        )}
      </div>
    );
  }

  if (type === 'no-search-results') {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">
          <Trans>No categories found matching "{searchTerm}"</Trans>
        </p>
        <p className="text-xs mt-1">
          <Trans>Try a different search term</Trans>
        </p>
      </div>
    );
  }

  return null;
}
