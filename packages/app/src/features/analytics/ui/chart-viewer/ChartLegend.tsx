import { useId, useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import { Input } from '@shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { useUiStore } from '@shared/store/useUiStore';
import { CHART_COLORS } from './chart-viewer.utils';

interface ChartLegendProps {
  legendItems: string[];
  hiddenGroups: Set<string>;
  onToggleGroup: (group: string) => void;
  getColorIndex: (item: string) => number;
  compact?: boolean;
  showSummary?: boolean;
}

export function ChartLegend({
  legendItems,
  hiddenGroups,
  onToggleGroup,
  getColorIndex,
  compact = false,
  showSummary = true,
}: ChartLegendProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const [searchTerm, setSearchTerm] = useState('');
  const legendItemIdBase = useId();

  const hiddenInLegendCount = legendItems.filter((item) => hiddenGroups.has(item)).length;
  const visibleCount = legendItems.length - hiddenInLegendCount;
  const toggleItem = (item: string) => {
    const isHidden = hiddenGroups.has(item);
    if (!isHidden && visibleCount <= 1) {
      return;
    }
    onToggleGroup(item);
  };
  const filteredItems = useMemo(
    () =>
      legendItems.filter((item) => item.toLowerCase().includes(searchTerm.trim().toLowerCase())),
    [legendItems, searchTerm]
  );

  if (legendItems.length === 0) return null;

  const showAll = () => {
    legendItems.forEach((item) => {
      if (hiddenGroups.has(item)) {
        onToggleGroup(item);
      }
    });
  };

  const hideAll = () => {
    const keepVisible = legendItems.find((item) => !hiddenGroups.has(item)) ?? legendItems[0];
    legendItems.forEach((item) => {
      if (item !== keepVisible && !hiddenGroups.has(item)) {
        onToggleGroup(item);
      }
    });
  };

  const summaryText =
    visibleCount === legendItems.length
      ? `All ${legendItems.length} series visible`
      : `${visibleCount}/${legendItems.length} series visible`;

  return (
    <div
      className={
        compact
          ? 'flex items-center gap-2 shrink-0'
          : 'w-full mb-3 flex items-center justify-between gap-2'
      }
    >
      {showSummary && (
        <p
          className={
            compact ? 'text-xs text-muted-foreground' : 'text-xs text-muted-foreground truncate'
          }
        >
          {maskFormattedIfEnabled(summaryText, privacyMaskNumbers)}
        </p>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={compact ? 'shrink-0' : 'h-7 px-2 text-xs shrink-0'}
          >
            <ListFilter className="h-3.5 w-3.5 mr-1.5" />
            Series
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="w-[min(24rem,calc(100vw-2rem))] max-h-[min(70dvh,32rem)] p-3"
        >
          <div className="flex flex-col gap-3">
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Filter series..."
              className="h-8 text-xs"
            />

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={showAll}
                disabled={hiddenInLegendCount === 0}
              >
                Show all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={hideAll}
                disabled={visibleCount <= 1}
              >
                Hide all
              </Button>
            </div>

            <div className="max-h-[58dvh] overflow-y-auto pr-1">
              <div className="space-y-1">
                {filteredItems.map((item, index) => {
                  const isHidden = hiddenGroups.has(item);
                  const colorIndex = getColorIndex(item);
                  const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
                  const checkboxId = `${legendItemIdBase}-${index}`;
                  return (
                    <label
                      key={item}
                      htmlFor={checkboxId}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer ${
                        isHidden ? 'opacity-60' : ''
                      }`}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={!isHidden}
                        onCheckedChange={() => toggleItem(item)}
                        disabled={!isHidden && visibleCount <= 1}
                      />
                      <span
                        className="h-3 w-3 rounded-sm border shrink-0"
                        style={{
                          backgroundColor: isHidden ? 'transparent' : color,
                          borderColor: color,
                        }}
                      />
                      <span className="text-xs truncate">
                        {maskFormattedIfEnabled(item, privacyMaskNumbers)}
                      </span>
                    </label>
                  );
                })}
                {filteredItems.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">No matching series.</p>
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
