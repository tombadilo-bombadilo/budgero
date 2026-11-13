import { Trans, useLingui } from '@lingui/react/macro';
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
  /** Saving and deleting would be written (false in the demo): hide those controls. */
  canEdit: boolean;
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
  canEdit,
  selectedTemplate,
  saveAsTemplate,
  templateName,
  onTemplateSelect,
  onApplyTemplate,
  onSaveAsTemplateChange,
  onTemplateNameChange,
  onDeleteTemplate,
}: TemplatesTabProps) {
  const { t } = useLingui();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="template-select">
          <Trans>Load from Template</Trans>
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedTemplate} onValueChange={onTemplateSelect}>
            <SelectTrigger className="w-full min-w-0 sm:flex-1">
              <SelectValue placeholder={t`Select a saved template`} />
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
            <Trans>Apply</Trans>
          </Button>
        </div>
      </div>

      {canEdit && <Separator />}

      {canEdit && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="save-template"
              checked={saveAsTemplate}
              onChange={(e) => onSaveAsTemplateChange(e.target.checked)}
            />
            <Label htmlFor="save-template">
              <Trans>Save current settings as template</Trans>
            </Label>
          </div>
          {saveAsTemplate && (
            <Input
              placeholder={t`Template name`}
              value={templateName}
              onChange={(e) => onTemplateNameChange(e.target.value)}
            />
          )}
        </div>
      )}

      {templates.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>
              <Trans>Saved Templates</Trans>
            </Label>
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between gap-2 rounded border p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{template.name}</div>
                    <div className="text-sm text-muted-foreground break-words">
                      <Trans>
                        Thousand: {template.thousandSeparator || ','} | Decimal:{' '}
                        {template.decimalSeparator || '.'} | Date: {template.dateFormat}
                      </Trans>
                    </div>
                  </div>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => onDeleteTemplate(template.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
