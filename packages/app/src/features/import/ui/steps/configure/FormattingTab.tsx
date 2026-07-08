/**
 * Formatting Tab
 *
 * "Formatting" tab of the configure step: thousand/decimal separators, date
 * format, and a live preview of how a sample amount parses.
 */

import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  SUPPORTED_NUMBER_FORMATS,
  SUPPORTED_DATE_FORMATS,
  type ImportConfig,
} from '@features/import/model/types';
import { parseAmount, getSeparatorsFromFormat } from '@budgero/core/browser';

interface FormattingTabProps {
  importConfig: ImportConfig;
  onImportConfigChange: (config: ImportConfig) => void;
}

export function FormattingTab({ importConfig, onImportConfigChange }: FormattingTabProps) {
  const handleNumberFormatChange = (format: string) => {
    const { thousandSeparator, decimalSeparator } = getSeparatorsFromFormat(format);
    onImportConfigChange({
      ...importConfig,
      numberFormat: format,
      thousandSeparator,
      decimalSeparator,
    });
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label htmlFor="thousand-separator">Thousand Separator</Label>
          <Select
            value={importConfig.thousandSeparator}
            onValueChange={(value) =>
              onImportConfigChange({ ...importConfig, thousandSeparator: value })
            }
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">Comma (,)</SelectItem>
              <SelectItem value=".">Dot (.)</SelectItem>
              <SelectItem value=" ">Space ( )</SelectItem>
              <SelectItem value="'">Apostrophe (')</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="decimal-separator">Decimal Separator</Label>
          <Select
            value={importConfig.decimalSeparator}
            onValueChange={(value) =>
              onImportConfigChange({ ...importConfig, decimalSeparator: value })
            }
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=".">Dot (.)</SelectItem>
              <SelectItem value=",">Comma (,)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="number-format">Quick Presets</Label>
          <Select value={importConfig.numberFormat} onValueChange={handleNumberFormatChange}>
            <SelectTrigger className="w-full min-w-0">
              <SelectValue placeholder="Select preset" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_NUMBER_FORMATS.map((format) => (
                <SelectItem key={format.value} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="date-format">Date Format</Label>
          <Select
            value={importConfig.dateFormat}
            onValueChange={(value) => onImportConfigChange({ ...importConfig, dateFormat: value })}
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_DATE_FORMATS.map((format) => (
                <SelectItem key={format.value} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-muted/50 p-4">
        <Label className="text-sm font-medium">Number Format Preview</Label>
        <div className="mt-2 break-words text-sm text-muted-foreground">
          <p>With your current settings:</p>
          <p>
            • Thousand separator:{' '}
            <code>
              {importConfig.thousandSeparator === 'none' ? 'None' : importConfig.thousandSeparator}
            </code>
          </p>
          <p>
            • Decimal separator: <code>{importConfig.decimalSeparator}</code>
          </p>
          <p className="mt-2">Examples:</p>
          <p>
            • "123
            {importConfig.thousandSeparator === 'none' ? '' : importConfig.thousandSeparator}
            456{importConfig.decimalSeparator}78" →{' '}
            {parseAmount(
              `123${importConfig.thousandSeparator === 'none' ? '' : importConfig.thousandSeparator}456${importConfig.decimalSeparator}78`,
              importConfig
            )}
          </p>
          <p>
            • "RSD 123
            {importConfig.thousandSeparator === 'none' ? '' : importConfig.thousandSeparator}
            123" →{' '}
            {parseAmount(
              `RSD 123${importConfig.thousandSeparator === 'none' ? '' : importConfig.thousandSeparator}123`,
              importConfig
            )}
          </p>
        </div>
      </div>
    </>
  );
}
