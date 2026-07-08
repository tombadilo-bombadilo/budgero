/**
 * "YNAB" tab of CreateBudgetForm: import a YNAB ZIP export as a new budget.
 */

import type { ChangeEvent, RefObject } from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Field } from '@shared/ui/field';
import { Loader2, Upload } from 'lucide-react';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { IconPicker } from '@features/budget-management/ui/IconPicker';
import { FormatSelector } from '@features/budget-management/ui/FormatSelector';
import { YnabExportGuide } from './YnabExportGuide';

interface YnabImportTabProps {
  budgetName: string;
  onBudgetNameChange: (value: string) => void;
  currency: string;
  onCurrencyChange: (value: string) => void;
  numberFormat: string;
  onNumberFormatChange: (value: string) => void;
  importBadgeIcon: string;
  onImportBadgeIconChange: (value: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  file: File | null;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  isImporting: boolean;
  onReset: () => void;
  onImport: () => void;
}

export function YnabImportTab({
  budgetName,
  onBudgetNameChange,
  currency,
  onCurrencyChange,
  numberFormat,
  onNumberFormatChange,
  importBadgeIcon,
  onImportBadgeIconChange,
  fileInputRef,
  file,
  onFileChange,
  isImporting,
  onReset,
  onImport,
}: YnabImportTabProps) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <Field label={<span className="text-xs sm:text-sm">Budget Name</span>} htmlFor="importName">
        <Input
          id="importName"
          value={budgetName}
          onChange={(e) => onBudgetNameChange(e.target.value)}
          placeholder="Enter a name for your imported budget"
          disabled={isImporting}
          className="h-8 sm:h-9"
        />
      </Field>

      <div className="space-y-3 sm:space-y-4">
        <div className="space-y-1.5">
          <CurrencySelector value={currency} onValueChange={onCurrencyChange} label="Currency" />
          <p className="text-xs text-muted-foreground">
            The currency shown on amounts. This is for display only and can be changed anytime.
          </p>
        </div>

        <div className="space-y-1.5">
          <FormatSelector
            value={numberFormat}
            currency={currency}
            onValueChange={onNumberFormatChange}
            label="Number Format"
          />
          <p className="text-xs text-muted-foreground">
            How numbers and decimals are displayed throughout the app.
          </p>
        </div>

        <div className="space-y-1.5">
          <IconPicker
            value={importBadgeIcon}
            onValueChange={onImportBadgeIconChange}
            label="Budget Icon"
          />
          <p className="text-xs text-muted-foreground">
            A small icon shown next to your budget name. Handy when you have multiple budgets.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="importFile" className="text-xs sm:text-sm">
          YNAB Export File (ZIP)
        </Label>
        {/* Native file input is visually hidden and driven by the button
            below so we can show an Upload icon and the chosen filename. */}
        <Input
          id="importFile"
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={onFileChange}
          disabled={isImporting}
          className="sr-only"
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            className="h-8 sm:h-9 text-xs sm:text-sm"
          >
            <Upload className="h-4 w-4" />
            Choose file
          </Button>
          <span className="truncate text-xs sm:text-sm text-muted-foreground">
            {file ? file.name : 'No file chosen'}
          </span>
        </div>
        <YnabExportGuide />
      </div>

      <div className="pt-2">
        <div className="flex gap-2 w-full">
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            disabled={isImporting}
            className="flex-1 h-8 sm:h-9"
          >
            Reset
          </Button>

          <Button
            type="button"
            onClick={onImport}
            disabled={!file || !budgetName.trim() || isImporting}
            className="flex-1 h-8 sm:h-9"
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                <span className="text-xs sm:text-sm">Importing...</span>
              </>
            ) : (
              <>
                <Upload className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="text-xs sm:text-sm">Import</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
