import { Label } from '@shared/ui/label';
import { Input } from '@shared/ui/input';
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
import { Cpu, Eye, ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@shared/lib/utils';

interface ModelSelectionSectionProps {
  textModel: string;
  visionModel: string;
  availableModels: string[];
  textModelOpen: boolean;
  visionModelOpen: boolean;
  onTextModelChange: (value: string) => void;
  onVisionModelChange: (value: string) => void;
  onTextModelOpenChange: (open: boolean) => void;
  onVisionModelOpenChange: (open: boolean) => void;
}

export function ModelSelectionSection({
  textModel,
  visionModel,
  availableModels,
  textModelOpen,
  visionModelOpen,
  onTextModelChange,
  onVisionModelChange,
  onTextModelOpenChange,
  onVisionModelOpenChange,
}: ModelSelectionSectionProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="textModel" className="flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          Text Model
        </Label>
        <p className="text-xs text-muted-foreground">For categorization and analysis</p>
        {availableModels.length > 0 ? (
          <Popover open={textModelOpen} onOpenChange={onTextModelOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={textModelOpen}
                className="w-full justify-between font-normal"
              >
                <span className="truncate">{textModel || 'Select model...'}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search models..." />
                <CommandList>
                  <CommandEmpty>No model found.</CommandEmpty>
                  <CommandGroup>
                    {availableModels.map((model) => (
                      <CommandItem
                        key={model}
                        value={model}
                        onSelect={() => {
                          onTextModelChange(model);
                          onTextModelOpenChange(false);
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            textModel === model ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className="truncate">{model}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <Input
            id="textModel"
            value={textModel}
            onChange={(e) => onTextModelChange(e.target.value)}
            placeholder="llama3.2"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="visionModel" className="flex items-center gap-2">
          <Eye className="h-4 w-4" />
          Vision Model
        </Label>
        <p className="text-xs text-muted-foreground">For receipt/image scanning</p>
        {availableModels.length > 0 ? (
          <Popover open={visionModelOpen} onOpenChange={onVisionModelOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={visionModelOpen}
                className="w-full justify-between font-normal"
              >
                <span className="truncate">{visionModel || 'Select model...'}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search models..." />
                <CommandList>
                  <CommandEmpty>No model found.</CommandEmpty>
                  <CommandGroup>
                    {availableModels.map((model) => (
                      <CommandItem
                        key={model}
                        value={model}
                        onSelect={() => {
                          onVisionModelChange(model);
                          onVisionModelOpenChange(false);
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            visionModel === model ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className="truncate">{model}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <Input
            id="visionModel"
            value={visionModel}
            onChange={(e) => onVisionModelChange(e.target.value)}
            placeholder="llava"
          />
        )}
      </div>
    </div>
  );
}
