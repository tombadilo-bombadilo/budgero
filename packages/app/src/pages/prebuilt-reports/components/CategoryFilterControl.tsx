import { useEffect, useMemo } from 'react';
import { CommandItem } from '@shared/ui/command';
import { Check, Minus } from 'lucide-react';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { useUiStore } from '@shared/store/useUiStore';
import {
  MultiSelectFilterControl,
  type MultiSelectFilterGroup,
  type MultiSelectGroupHeaderContext,
} from './MultiSelectFilterControl';

interface CategoryFilterControlProps {
  selectedCategoryIds: number[];
  onChange: (ids: number[]) => void;
  triggerClassName?: string;
  disabled?: boolean;
}

type CategoryItem = { ID: number; Name: string; CategoryGroupID: number | null };

const OTHER_GROUP = { ID: -1, Name: 'Other categories' };

function renderGroupHeader({
  group,
  allSelected,
  partiallySelected,
  onToggle,
}: MultiSelectGroupHeaderContext<CategoryItem>) {
  return (
    <CommandItem
      value={`group-${group.key}`}
      onSelect={onToggle}
      className="cursor-pointer font-medium"
    >
      <span className="mr-2 flex h-4 w-4 items-center justify-center text-muted-foreground">
        {allSelected ? (
          <Check className="h-4 w-4" />
        ) : partiallySelected ? (
          <Minus className="h-4 w-4" />
        ) : null}
      </span>
      <span className="truncate">All {group.heading}</span>
      <span className="ml-auto text-xs text-muted-foreground">{group.items.length}</span>
    </CommandItem>
  );
}

export function CategoryFilterControl({
  selectedCategoryIds,
  onChange,
  triggerClassName,
  disabled,
}: CategoryFilterControlProps) {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const { data: categories = [], isLoading: isLoadingCategories } = useCategories(budgetId);
  const { data: categoryGroups = [], isLoading: isLoadingGroups } = useCategoryGroups(budgetId);

  useEffect(() => {
    if (!categories.length) {
      if (selectedCategoryIds.length > 0) {
        onChange([]);
      }
      return;
    }

    const allowed = new Set(categories.map((category) => category.ID));
    const filtered = selectedCategoryIds.filter((id) => allowed.has(id));
    if (filtered.length !== selectedCategoryIds.length) {
      onChange(filtered);
    }
  }, [categories, onChange, selectedCategoryIds]);

  const groupedCategories: MultiSelectFilterGroup<CategoryItem>[] = useMemo(() => {
    if (!categories.length) return [];

    const groupLookup = new Map(categoryGroups.map((group) => [group.ID, group]));
    const buckets = new Map<
      number,
      { group: { ID: number; Name: string }; categories: CategoryItem[] }
    >();

    categories.forEach((category) => {
      const groupId = category.CategoryGroupID ?? OTHER_GROUP.ID;
      const group = groupLookup.get(groupId) ?? OTHER_GROUP;
      if (!buckets.has(groupId)) {
        buckets.set(groupId, { group, categories: [] });
      }
      const bucket = buckets.get(groupId);
      if (bucket) {
        bucket.categories.push(category);
      }
    });

    return Array.from(buckets.values())
      .map(({ group, categories: grouped }) => ({
        key: group.ID,
        heading: group.Name,
        items: grouped.slice().sort((a, b) => a.Name.localeCompare(b.Name)),
      }))
      .sort((a, b) => a.heading.localeCompare(b.heading));
  }, [categories, categoryGroups]);

  const isLoading = isLoadingCategories || isLoadingGroups;

  const buttonLabel = useMemo(() => {
    if (isLoading) {
      return 'Loading categories...';
    }
    if (categories.length === 0) {
      return 'No categories available';
    }
    if (selectedCategoryIds.length === 0) {
      return 'All categories';
    }
    if (selectedCategoryIds.length === 1) {
      const category = categories.find((item) => item.ID === selectedCategoryIds[0]);
      return category?.Name ?? '1 category';
    }
    return `${selectedCategoryIds.length} categories`;
  }, [isLoading, categories, selectedCategoryIds]);

  return (
    <MultiSelectFilterControl
      groups={groupedCategories}
      selectedIds={selectedCategoryIds}
      onChange={onChange}
      getId={(category) => category.ID}
      getLabel={(category) => category.Name}
      isLoading={isLoading}
      hasItems={categories.length > 0}
      buttonLabel={buttonLabel}
      triggerWidthClassName="sm:w-[260px]"
      contentClassName="w-[320px]"
      listClassName="max-h-72 overflow-y-auto"
      triggerClassName={triggerClassName}
      disabled={disabled}
      searchPlaceholder="Search categories..."
      emptyText="No categories found."
      allOptionLabel="All categories"
      allOptionValue="__all_categories__"
      groupItemClassName="pl-6"
      renderGroupHeader={renderGroupHeader}
    />
  );
}
