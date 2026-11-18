import { Trans, useLingui } from '@lingui/react/macro';
import * as React from 'react';
import { Check, ChevronsUpDown, Tag, X } from 'lucide-react';
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
import { cn } from '@shared/lib/utils';
import { hexToRgba } from '@shared/lib/color/hex';
import { useLabels } from '@entities/label/api/useLabels';
import type { LabelListItem } from '@budgero/core/browser';

export interface LabelComboboxProps {
  budgetId: number;
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  placeholder?: string;
  triggerClassName?: string;
  popoverContentClassName?: string;
  disabled?: boolean;
  allowClear?: boolean;
  labels?: LabelListItem[];
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LabelCombobox({
  budgetId,
  value,
  onChange,
  placeholder: placeholderProp,
  triggerClassName,
  popoverContentClassName,
  disabled = false,
  allowClear = true,
  labels: providedLabels,
  defaultOpen = false,
  onOpenChange,
}: LabelComboboxProps) {
  const { t } = useLingui();
  const placeholder = placeholderProp ?? t`No label`;
  const [open, setOpen] = React.useState(defaultOpen);
  const [search, setSearch] = React.useState('');
  const labelsQuery = useLabels(budgetId, providedLabels === undefined);
  const labels = providedLabels ?? labelsQuery.labels;
  const isFetching = providedLabels === undefined && labelsQuery.isFetching;

  React.useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const selectedId =
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  const selectedLabel = React.useMemo(
    () => labels.find((label) => label.ID === selectedId) ?? null,
    [labels, selectedId]
  );

  const normalizedSearch = search.trim().toLowerCase();
  const filteredLabels = React.useMemo(() => {
    if (!normalizedSearch) return labels;
    return labels.filter((label) => label.Name.toLowerCase().includes(normalizedSearch));
  }, [labels, normalizedSearch]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch('');
    }
  }, []);

  const handleSelect = React.useCallback(
    (nextLabelId: number | null) => {
      if ((selectedId ?? null) !== nextLabelId) {
        onChange(nextLabelId);
      }
      setOpen(false);
      setSearch('');
    },
    [onChange, selectedId]
  );

  const triggerStyle = selectedLabel
    ? {
        backgroundColor: hexToRgba(selectedLabel.Color, 0.1),
        borderColor: hexToRgba(selectedLabel.Color, 0.42),
      }
    : undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isFetching}
          className={cn(
            'w-full justify-between text-left font-normal hover:text-foreground focus-visible:text-foreground',
            selectedLabel ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            triggerClassName
          )}
          style={triggerStyle}
        >
          <span className="flex items-center gap-2 min-w-0">
            {selectedLabel ? (
              <span
                className="h-2.5 w-2.5 rounded-full border border-white/60 shrink-0"
                style={{ backgroundColor: selectedLabel.Color }}
                aria-hidden
              />
            ) : (
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="truncate">{selectedLabel?.Name ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className={cn('w-[300px] p-0', popoverContentClassName)} align="start">
        <Command loop>
          <CommandInput
            placeholder={t`Search labels...`}
            value={search}
            onValueChange={setSearch}
            disabled={disabled || isFetching}
          />
          <CommandList>
            <CommandEmpty>
              {normalizedSearch
                ? t`No matching labels.`
                : labels.length === 0
                  ? t`No labels yet.`
                  : t`Type to filter labels.`}
            </CommandEmpty>

            {allowClear && (
              <CommandGroup heading={t`Actions`}>
                <CommandItem
                  value="__clear_label__"
                  onSelect={() => handleSelect(null)}
                  className="flex items-center gap-2 text-foreground data-[selected=true]:bg-muted/80 data-[selected=true]:text-foreground"
                >
                  <X className="h-4 w-4" />
                  <span>
                    <Trans>Clear label</Trans>
                  </span>
                  <Check
                    className={cn(
                      'ml-auto h-4 w-4',
                      selectedId === null ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading={t`Labels`}>
              {filteredLabels.map((label) => (
                <CommandItem
                  key={label.ID}
                  value={`${label.Name} ${label.Color}`}
                  onSelect={() => handleSelect(label.ID)}
                  className="flex items-center gap-2 text-foreground data-[selected=true]:bg-muted/80 data-[selected=true]:text-foreground"
                  style={
                    selectedId === label.ID
                      ? {
                          backgroundColor: hexToRgba(label.Color, 0.12),
                          boxShadow: `inset 2px 0 0 ${hexToRgba(label.Color, 0.9)}`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-white/60 shrink-0"
                    style={{ backgroundColor: label.Color }}
                    aria-hidden
                  />
                  <span className="truncate flex-1">{label.Name}</span>
                  {label.UsageCount > 0 && (
                    <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                      {label.UsageCount}
                    </span>
                  )}
                  <Check
                    className={cn('h-4 w-4', selectedId === label.ID ? 'opacity-100' : 'opacity-0')}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
