import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@shared/lib/utils';
import { getErrorMessage } from '@shared/lib/errors';
import { Button } from '@shared/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Popover, PopoverAnchor, PopoverTrigger, PopoverContent } from '@shared/ui/popover';
import {
  useCategories,
  useCategoryGroups,
  useAddCategory,
} from '@entities/category/api/useCategories';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useMonthlyBudget, useReadyToAssign } from '@entities/budget/api/useMonthlyBudget';
import { useUiStore } from '@shared/store/useUiStore';
import type { VirtualElement } from '@floating-ui/react';
import type { Category } from '@budgero/core/browser';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { CreateCategoryDialog } from '@features/category-management/ui/CreateCategoryDialog';

interface SearchableCategorySelectProps {
  budgetId: number;
  selectedCategoryId: number | null;
  onCategorySelect: (categoryId: number) => void;
  placeholder?: string;
  triggerClassName?: string;
  popoverContentClassName?: string;
  includeReadyToAssign?: boolean; // Inject special RTA option at top
  readyToAssignLabel?: string; // Custom label for RTA
  excludeCategoryId?: number; // Optionally filter a category (e.g., source)
  showAvailableForMonth?: boolean; // Show "Available" for the effective month next to each category
  month?: string; // Override month (defaults to UI currentMonth)
  onlyPositiveAvailable?: boolean; // Only list categories with available > 0 (e.g., cover sources)
}

export function SearchableCategorySelect({
  budgetId,
  selectedCategoryId,
  onCategorySelect,
  placeholder = 'Select a category',
  triggerClassName,
  popoverContentClassName,
  includeReadyToAssign = false,
  readyToAssignLabel = 'Ready To Assign',
  excludeCategoryId,
  showAvailableForMonth = false,
  month,
  onlyPositiveAvailable = false,
}: SearchableCategorySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [pendingCategoryName, setPendingCategoryName] = React.useState('');
  const [selectedGroupIdForCreate, setSelectedGroupIdForCreate] = React.useState<number | null>(
    null
  );
  const [createError, setCreateError] = React.useState<string | null>(null);

  const {
    data: categoryGroupsData,
    isLoading: isLoadingGroups,
    error: errorGroups,
  } = useCategoryGroups(budgetId);

  const {
    data: categoriesData,
    isLoading: isLoadingCategories,
    error: errorCategories,
  } = useCategories(budgetId);
  const addCategoryMutation = useAddCategory();

  const normalizedSearch = React.useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const noMatchesForSearch = React.useMemo(() => {
    if (!normalizedSearch) return false;
    return !(categoriesData ?? []).some((cat) => cat.Name.toLowerCase().includes(normalizedSearch));
  }, [categoriesData, normalizedSearch]);

  const canOfferCreate = normalizedSearch.length > 0 && noMatchesForSearch;
  const isMobile = useIsMobile();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverContentRef = React.useRef<HTMLDivElement | null>(null);
  const headerAnchorRef = React.useRef<VirtualElement | null>(null);
  const [, forceVirtualAnchorUpdate] = React.useReducer((count: number) => count + 1, 0);

  const uiMonth = useUiStore((s) => s.currentMonth);
  const effectiveMonth = month || uiMonth;
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);
  const { data: monthlyRows = [] } = useMonthlyBudget(effectiveMonth, budgetId);
  const availableByCategory = React.useMemo(() => {
    const map = new Map<number, number>();
    (monthlyRows || []).forEach((row) => {
      if (row.CategoryID > 0) map.set(row.CategoryID, row.Available || 0);
    });
    return map;
  }, [monthlyRows]);
  const { data: readyToAssignAmount = 0 } = useReadyToAssign(budgetId);

  const popoverSide = 'bottom';
  const popoverCollisionPadding = React.useMemo(() => {
    return isMobile ? { top: 12, bottom: 12 } : 12;
  }, [isMobile]);

  const updateMobileLayoutMetrics = React.useCallback(() => {
    if (typeof document === 'undefined') {
      headerAnchorRef.current = null;
      forceVirtualAnchorUpdate();
      return;
    }

    const mobileTopBar = document.querySelector<HTMLElement>('[data-mobile-top-bar]');
    if (!mobileTopBar) {
      headerAnchorRef.current = null;
      forceVirtualAnchorUpdate();
      return;
    }

    const virtualElement: VirtualElement = {
      getBoundingClientRect: () => mobileTopBar.getBoundingClientRect(),
      contextElement: mobileTopBar,
    };

    headerAnchorRef.current = virtualElement;
    forceVirtualAnchorUpdate();
  }, [forceVirtualAnchorUpdate]);

  React.useEffect(() => {
    if (!isMobile) {
      headerAnchorRef.current = null;
      forceVirtualAnchorUpdate();
      return;
    }

    if (!open) {
      return;
    }

    updateMobileLayoutMetrics();

    if (typeof window === 'undefined') {
      return;
    }

    const handleResizeOrScroll = () => updateMobileLayoutMetrics();

    window.addEventListener('resize', handleResizeOrScroll);
    window.addEventListener('scroll', handleResizeOrScroll, true);

    return () => {
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll, true);
    };
  }, [isMobile, open, updateMobileLayoutMetrics]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    if (typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const triggerEl = triggerRef.current;
      const contentEl = popoverContentRef.current;
      const { target } = event;

      if (!(target instanceof Node)) {
        return;
      }

      if (triggerEl?.contains(target) || contentEl?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  const openCreateDialog = React.useCallback(() => {
    if (!canOfferCreate) return;
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    setPendingCategoryName(trimmed);
    setCreateError(null);
    const firstGroupId = categoryGroupsData?.[0]?.ID ?? null;
    setSelectedGroupIdForCreate((prev) => prev ?? firstGroupId);
    setCreateDialogOpen(true);
    setOpen(false);
  }, [canOfferCreate, searchTerm, categoryGroupsData]);

  React.useEffect(() => {
    if (!createDialogOpen) return;
    if (!selectedGroupIdForCreate && categoryGroupsData?.length) {
      setSelectedGroupIdForCreate(categoryGroupsData[0].ID);
    }
  }, [createDialogOpen, selectedGroupIdForCreate, categoryGroupsData]);

  const handleConfirmCreate = React.useCallback(async () => {
    const name = pendingCategoryName.trim();
    if (!name || !selectedGroupIdForCreate) {
      return;
    }
    setCreateError(null);
    try {
      const newCategoryId = await addCategoryMutation.mutateAsync({
        name,
        groupId: selectedGroupIdForCreate,
        budgetId,
        note: '',
      });
      onCategorySelect(newCategoryId);
      setCreateDialogOpen(false);
      setOpen(false);
      setSearchTerm('');
    } catch (err) {
      const fallback = 'Failed to create category.';
      // `|| fallback` also covers Error instances with an empty message.
      setCreateError(getErrorMessage(err, fallback) || fallback);
    }
  }, [
    addCategoryMutation,
    budgetId,
    onCategorySelect,
    pendingCategoryName,
    selectedGroupIdForCreate,
  ]);

  const handleCreateDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    setCreateDialogOpen(nextOpen);
    if (!nextOpen) {
      setCreateError(null);
    }
  }, []);

  const commandFilter = React.useCallback((value: string | null, search: string) => {
    if (!value) return 0;
    const normalizedValue = value.toLowerCase();
    const tokens = search
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) return 1;
    return tokens.every((token) => normalizedValue.includes(token)) ? 1 : 0;
  }, []);

  const { groupedCategories, currentSelectedCategoryName } = React.useMemo(() => {
    if (!categoriesData || !categoryGroupsData) {
      return { groupedCategories: [], currentSelectedCategoryName: '' };
    }

    const nameForSelectedId =
      selectedCategoryId === 0 && includeReadyToAssign
        ? readyToAssignLabel
        : categoriesData.find((c) => c.ID === selectedCategoryId)?.Name || '';

    const processedGroups = categoryGroupsData
      .map((group) => {
        const catsInGroup = categoriesData
          .filter((cat) => cat.CategoryGroupID === group.ID)
          .filter((cat) => (excludeCategoryId ? cat.ID !== excludeCategoryId : true))
          .filter((cat) =>
            onlyPositiveAvailable ? (availableByCategory.get(cat.ID) ?? 0) > 0 : true
          )
          .sort((a, b) => a.Name.localeCompare(b.Name));

        return catsInGroup.length > 0
          ? {
              id: group.ID,
              name: group.Name,
              categories: catsInGroup,
            }
          : null;
      })
      .filter(
        (group): group is { id: number; name: string; categories: Category[] } => group !== null
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      groupedCategories: processedGroups,
      currentSelectedCategoryName: nameForSelectedId,
    };
  }, [
    categoriesData,
    categoryGroupsData,
    selectedCategoryId,
    excludeCategoryId,
    includeReadyToAssign,
    readyToAssignLabel,
    onlyPositiveAvailable,
    availableByCategory,
  ]);

  if (isLoadingGroups || isLoadingCategories) {
    return (
      <Button
        variant="outline"
        className={cn('w-[200px] justify-start text-muted-foreground', triggerClassName)}
        disabled
      >
        {placeholder}...
      </Button>
    );
  }

  if (errorGroups || errorCategories) {
    console.error('Error fetching categories/groups:', errorGroups || errorCategories);
    return (
      <Button
        variant="outline"
        className={cn('w-[200px] justify-start text-destructive', triggerClassName)}
        disabled
      >
        Error loading data
      </Button>
    );
  }

  if (!categoryGroupsData || !categoriesData) {
    return (
      <Button
        variant="outline"
        className={cn('w-[200px] justify-start text-muted-foreground', triggerClassName)}
        disabled
      >
        No data available
      </Button>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal>
        {isMobile ? <PopoverAnchor virtualRef={headerAnchorRef} /> : null}
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-[200px] justify-between',
              !currentSelectedCategoryName && 'text-muted-foreground',
              triggerClassName
            )}
          >
            <span className="truncate">{currentSelectedCategoryName || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          ref={popoverContentRef}
          className={cn(
            'p-0 max-h-[50dvh] overflow-hidden',
            isMobile
              ? 'w-full max-w-[22.5rem] rounded-xl border shadow-lg'
              : 'w-[--radix-popover-trigger-width]',
            popoverContentClassName
          )}
          align="center"
          side={isMobile ? undefined : popoverSide}
          sideOffset={isMobile ? 8 : 6}
          avoidCollisions={!isMobile}
          collisionPadding={popoverCollisionPadding}
        >
          <Command className="h-full" filter={commandFilter}>
            <CommandInput
              placeholder="Search category..."
              value={searchTerm}
              onValueChange={setSearchTerm}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canOfferCreate) {
                  event.preventDefault();
                  openCreateDialog();
                }
              }}
            />
            <CommandList
              className={cn(
                'category-selector-scrollbar overflow-y-auto overscroll-contain touch-pan-y',
                isMobile ? 'max-h-[55dvh]' : 'max-h-[44dvh]'
              )}
            >
              <CommandEmpty>
                <div className="space-y-2">
                  <p>No category found.</p>
                  {canOfferCreate && (
                    <Button
                      size="sm"
                      className="w-full justify-center"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={openCreateDialog}
                    >
                      Create “{searchTerm.trim()}”
                    </Button>
                  )}
                </div>
              </CommandEmpty>
              {includeReadyToAssign && (!onlyPositiveAvailable || readyToAssignAmount > 0) && (
                <CommandGroup heading="General">
                  <CommandItem
                    value={readyToAssignLabel.toLowerCase()}
                    onSelect={() => {
                      onCategorySelect(0);
                      setOpen(false);
                      setSearchTerm('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedCategoryId === 0 ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="flex-1">{readyToAssignLabel}</span>
                    {showAvailableForMonth && (
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {formatMilli(globalLocalizer, asMilli(readyToAssignAmount))}
                      </span>
                    )}
                  </CommandItem>
                </CommandGroup>
              )}
              {groupedCategories.map((group) => (
                <CommandGroup key={group.id} heading={group.name}>
                  {group.categories.map((category) => (
                    <CommandItem
                      key={category.ID}
                      value={category.Name} // Used for search filtering
                      onSelect={() => {
                        onCategorySelect(category.ID);
                        setOpen(false);
                        setSearchTerm('');
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          selectedCategoryId === category.ID ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="flex-1">{category.Name}</span>
                      {showAvailableForMonth && (
                        <span
                          className={cn(
                            'ml-2 text-xs tabular-nums',
                            (availableByCategory.get(category.ID) ?? 0) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          {formatMilli(
                            globalLocalizer,
                            asMilli(availableByCategory.get(category.ID) ?? 0)
                          )}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {groupedCategories.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No categories available to select.
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <CreateCategoryDialog
        open={createDialogOpen}
        onOpenChange={handleCreateDialogOpenChange}
        categoryGroups={categoryGroupsData}
        pendingCategoryName={pendingCategoryName}
        onPendingCategoryNameChange={setPendingCategoryName}
        searchTerm={searchTerm}
        selectedGroupIdForCreate={selectedGroupIdForCreate}
        onSelectedGroupIdForCreateChange={setSelectedGroupIdForCreate}
        createError={createError}
        isPending={addCategoryMutation.isPending}
        onConfirm={handleConfirmCreate}
      />
    </>
  );
}
