import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
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

export interface BuilderOption<TValue extends string | number> {
  value: TValue;
  label: string;
  /** Optional group heading (e.g. the category group of a category). */
  group?: string;
}

interface BuilderMultiSelectProps<TValue extends string | number> {
  id: string;
  /** Accessible name; also shown in the summary when nothing is selected. */
  label: string;
  options: BuilderOption<TValue>[];
  selected: TValue[];
  onChange: (values: TValue[]) => void;
  disabled?: boolean;
}

/** Compact searchable multi-select; an empty selection means "all". */
export function BuilderMultiSelect<TValue extends string | number>({
  id,
  label,
  options,
  selected,
  onChange,
  disabled,
}: BuilderMultiSelectProps<TValue>) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const selectedSet = new Set<TValue>(selected);

  const selectedLabels = options
    .filter((option) => selectedSet.has(option.value))
    .map((option) => option.label);
  let summary: string;
  if (selected.length === 0) summary = t`All`;
  else if (selectedLabels.length === 1) [summary] = selectedLabels;
  else summary = t`${selected.length} selected`;

  const groups = new Map<string, BuilderOption<TValue>[]>();
  for (const option of options) {
    const key = option.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(option);
    groups.set(key, list);
  }

  const toggle = (value: TValue) => {
    onChange(
      selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]
    );
  };

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={`${label}: ${summary}`}
            className="w-full min-w-0 justify-between gap-2 font-normal"
            disabled={disabled || options.length === 0}
          >
            <span
              className={cn('truncate text-left', selected.length === 0 && 'text-muted-foreground')}
            >
              {summary}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder={t`Search…`} aria-label={label} />
            <CommandList className="max-h-72">
              <CommandEmpty>
                <Trans>No matches.</Trans>
              </CommandEmpty>
              {Array.from(groups.entries()).map(([heading, items]) => (
                <CommandGroup key={heading || '__all__'} heading={heading || undefined}>
                  {items.map((option) => {
                    const isSelected = selectedSet.has(option.value);
                    return (
                      <CommandItem
                        key={String(option.value)}
                        value={`${option.label} ${heading} ${String(option.value)}`}
                        onSelect={() => toggle(option.value)}
                        className="cursor-pointer"
                      >
                        <Check
                          aria-hidden
                          className={cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                        />
                        <span className="truncate">{option.label}</span>
                        {isSelected && (
                          <span className="sr-only">
                            <Trans>(selected)</Trans>
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onChange([])}
          aria-label={t`Clear ${label} filter`}
          disabled={disabled}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
