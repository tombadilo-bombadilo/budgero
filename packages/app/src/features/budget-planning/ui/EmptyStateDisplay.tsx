import { Wallet, Search, Plus } from 'lucide-react';
import { Button } from '@shared/ui/button';

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
  if (type === 'no-categories') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">Start Building Your Budget</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Create category groups to organize your spending, then add categories within each group.
        </p>
        {onAddCategoryGroup && (
          <Button onClick={onAddCategoryGroup} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Category Group
          </Button>
        )}
      </div>
    );
  }

  if (type === 'no-search-results') {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No categories found matching "{searchTerm}"</p>
        <p className="text-xs mt-1">Try a different search term</p>
      </div>
    );
  }

  return null;
}
