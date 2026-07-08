/**
 * Templates Tab
 *
 * "Templates" tab of the configure step: load a saved column-mapping/format
 * template, save the current settings as a new one, and manage saved ones.
 */

import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Separator } from '@shared/ui/separator';
import { Trash2 } from 'lucide-react';
import type { ImportTemplate } from '@features/import/model/types';

interface TemplatesTabProps {
  templates: ImportTemplate[];
  selectedTemplate: string;
  saveAsTemplate: boolean;
  templateName: string;
  onTemplateSelect: (id: string) => void;
  onApplyTemplate: () => void;
  onSaveAsTemplateChange: (save: boolean) => void;
  onTemplateNameChange: (name: string) => void;
  onDeleteTemplate: (id: string) => void;
}

export function TemplatesTab({
  templates,
  selectedTemplate,
  saveAsTemplate,
  templateName,
  onTemplateSelect,
  onApplyTemplate,
  onSaveAsTemplateChange,
  onTemplateNameChange,
  onDeleteTemplate,
}: TemplatesTabProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="template-select">Load from Template</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedTemplate} onValueChange={onTemplateSelect}>
            <SelectTrigger className="w-full min-w-0 sm:flex-1">
              <SelectValue placeholder="Select a saved template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={onApplyTemplate}
            disabled={!selectedTemplate}
            className="w-full sm:w-auto"
          >
            Apply
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="save-template"
            checked={saveAsTemplate}
            onChange={(e) => onSaveAsTemplateChange(e.target.checked)}
          />
          <Label htmlFor="save-template">Save current settings as template</Label>
        </div>
        {saveAsTemplate && (
          <Input
            placeholder="Template name"
            value={templateName}
            onChange={(e) => onTemplateNameChange(e.target.value)}
          />
        )}
      </div>

      {templates.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Saved Templates</Label>
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between gap-2 rounded border p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{template.name}</div>
                    <div className="text-sm text-muted-foreground break-words">
                      Thousand: {template.thousandSeparator || ','} | Decimal:{' '}
                      {template.decimalSeparator || '.'} | Date: {template.dateFormat}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => onDeleteTemplate(template.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
