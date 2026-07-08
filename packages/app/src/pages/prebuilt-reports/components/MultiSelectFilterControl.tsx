import { useState, type ReactNode } from 'react';
import { Button } from '@shared/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@shared/lib/utils';

export interface MultiSelectFilterGroup<TItem> {
  key: string | number;
  heading: string;
  items: TItem[];
}

export interface MultiSelectGroupHeaderContext<TItem> {
  group: MultiSelectFilterGroup<TItem>;
  allSelected: boolean;
  partiallySelected: boolean;
  onToggle: () => void;
}

interface MultiSelectFilterControlProps<TItem> {
  groups: MultiSelectFilterGroup<TItem>[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  getId: (item: TItem) => number;
  getLabel: (item: TItem) => string;
  isLoading: boolean;
  hasItems: boolean;
  buttonLabel: string;
  triggerWidthClassName: string;
  contentClassName: string;
  listClassName: string;
  triggerClassName?: string;
  disabled?: boolean;
  searchPlaceholder: string;
  emptyText: string;
  allOptionLabel: string;
  allOptionValue: string;
  /** Indentation applied to item rows; typically only set when `renderGroupHeader` is used. */
  groupItemClassName?: string;
  renderGroupHeader?: (ctx: MultiSelectGroupHeaderContext<TItem>) => ReactNode;
}

export function MultiSelectFilterControl<TItem>({
  groups,
  selectedIds,
  onChange,
  getId,
  getLabel,
  isLoading,
  hasItems,
  buttonLabel,
  triggerWidthClassName,
  contentClassName,
  listClassName,
  triggerClassName,
  disabled,
  searchPlaceholder,
  emptyText,
  allOptionLabel,
  allOptionValue,
  groupItemClassName,
  renderGroupHeader,
}: MultiSelectFilterControlProps<TItem>) {
  const [open, setOpen] = useState(false);

  const handleToggleItem = (id: number) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id]
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('w-full justify-between gap-2', triggerWidthClassName, triggerClassName)}
          disabled={disabled || isLoading || !hasItems}
        >
          <span className="truncate text-left">{buttonLabel}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn(contentClassName, 'p-0')} align="end">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className={listClassName}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandItem
              value={allOptionValue}
              onSelect={() => onChange([])}
              className="cursor-pointer"
            >
              <Check
                className={cn(
                  'mr-2 h-4 w-4 text-muted-foreground',
                  selectedIds.length === 0 ? 'opacity-100' : 'opacity-0'
                )}
              />
              {allOptionLabel}
            </CommandItem>
            {groups.map((group) => {
              const groupIds = group.items.map(getId);
              const selectedCount = groupIds.filter((id) => selectedIds.includes(id)).length;
              const allSelected = selectedCount > 0 && selectedCount === groupIds.length;
              const partiallySelected = selectedCount > 0 && selectedCount < groupIds.length;
              const onToggleGroup = () => {
                if (groupIds.length === 0) return;
                if (allSelected) {
                  onChange(selectedIds.filter((id) => !groupIds.includes(id)));
                } else {
                  onChange(Array.from(new Set([...selectedIds, ...groupIds])));
                }
              };

              return (
                <CommandGroup key={group.key} heading={group.heading}>
                  {renderGroupHeader?.({
                    group,
                    allSelected,
                    partiallySelected,
                    onToggle: onToggleGroup,
                  })}
                  {group.items.map((item) => {
                    const id = getId(item);
                    const isSelected = selectedIds.includes(id);
                    return (
                      <CommandItem
                        key={id}
                        value={getLabel(item)}
                        onSelect={() => handleToggleItem(id)}
                        className={cn('cursor-pointer', groupItemClassName)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 text-muted-foreground',
                            isSelected ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        {getLabel(item)}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
