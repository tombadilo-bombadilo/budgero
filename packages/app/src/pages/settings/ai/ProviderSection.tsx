import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import type { LLMProvider } from '@budgero/core/browser';
import { PROVIDER_OPTIONS } from './ai-settings.constants';

interface ProviderSectionProps {
  provider: LLMProvider;
  onProviderChange: (value: LLMProvider) => void;
}

export function ProviderSection({ provider, onProviderChange }: ProviderSectionProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5">
        <Label htmlFor="provider">Provider</Label>
        <p className="text-sm text-muted-foreground">Select your local LLM server type</p>
      </div>
      <Select value={provider} onValueChange={onProviderChange}>
        <SelectTrigger id="provider" className="w-full sm:w-56">
          <SelectValue placeholder="Select provider" />
        </SelectTrigger>
        <SelectContent>
          {PROVIDER_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
