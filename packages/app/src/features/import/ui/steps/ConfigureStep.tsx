/**
 * Configure Step Component
 *
 * Second step of the import wizard - column mapping, formatting, and templates.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { FileSpreadsheet, ArrowRight } from 'lucide-react';
import {
  type ParsedData,
  type ColumnMapping,
  type ImportConfig,
  type ImportTemplate,
  type RawTableData,
} from '@features/import/model/types';
import { MappingTab } from './configure/MappingTab';
import { FormattingTab } from './configure/FormattingTab';
import { TemplatesTab } from './configure/TemplatesTab';

interface Account {
  ID: number;
  Name: string;
  Currency: string;
}

interface DefaultAccountSelectProps {
  accounts: Account[] | undefined;
  importConfig: ImportConfig;
  onImportConfigChange: (config: ImportConfig) => void;
  placeholder: string;
  triggerClassName?: string;
}

function DefaultAccountSelect({
  accounts,
  importConfig,
  onImportConfigChange,
  placeholder,
  triggerClassName = 'w-full min-w-0',
}: DefaultAccountSelectProps) {
  return (
    <Select
      value={importConfig.defaultAccountId?.toString() || ''}
      onValueChange={(value) =>
        onImportConfigChange({ ...importConfig, defaultAccountId: parseInt(value, 10) })
      }
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {accounts?.map((account) => (
          <SelectItem key={account.ID} value={account.ID.toString()}>
            {account.Name} ({account.Currency})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ConfigureStepProps {
  parsedData: ParsedData | null;
  columnMapping: ColumnMapping;
  importConfig: ImportConfig;
  templates: ImportTemplate[];
  selectedTemplate: string;
  saveAsTemplate: boolean;
  templateName: string;
  rawTableData: RawTableData | null;
  selectedHeaderIndex: number | null;
  skippedRowIndices: Set<number>;
  onToggleSkippedRow: (parsedRowIndex: number) => void;
  onSetSkippedRowsInRange: (indices: number[], shouldSkip: boolean) => void;
  accounts: Account[] | undefined;
  hasBudgetSelected: boolean;
  onColumnMappingChange: (mapping: ColumnMapping) => void;
  onImportConfigChange: (config: ImportConfig) => void;
  onTemplateSelect: (id: string) => void;
  onApplyTemplate: () => void;
  onSaveAsTemplateChange: (save: boolean) => void;
  onTemplateNameChange: (name: string) => void;
  onDeleteTemplate: (id: string) => void;
  onHeaderSelect: (index: number, headers: string[], rows: Record<string, string>[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export function ConfigureStep({
  parsedData,
  columnMapping,
  importConfig,
  templates,
  selectedTemplate,
  saveAsTemplate,
  templateName,
  rawTableData,
  selectedHeaderIndex,
  skippedRowIndices,
  onToggleSkippedRow,
  onSetSkippedRowsInRange,
  accounts,
  hasBudgetSelected,
  onColumnMappingChange,
  onImportConfigChange,
  onTemplateSelect,
  onApplyTemplate,
  onSaveAsTemplateChange,
  onTemplateNameChange,
  onDeleteTemplate,
  onHeaderSelect,
  onBack,
  onNext,
}: ConfigureStepProps) {
  const canProceed =
    columnMapping.date &&
    (columnMapping.amount || columnMapping.inflow || columnMapping.outflow) &&
    hasBudgetSelected &&
    (columnMapping.account || importConfig.defaultAccountId);

  return (
    <Card className="mx-auto w-full max-w-4xl overflow-x-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Configure Import Settings
        </CardTitle>
        <CardDescription>
          Map your file columns to transaction fields and set formatting options
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 overflow-x-hidden">
        <Tabs defaultValue="mapping" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger
              value="mapping"
              className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm"
            >
              <span className="sm:hidden">Mapping</span>
              <span className="hidden sm:inline">Column Mapping</span>
            </TabsTrigger>
            <TabsTrigger
              value="formatting"
              className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm"
            >
              Formatting
            </TabsTrigger>
            <TabsTrigger
              value="templates"
              className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm"
            >
              Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mapping" className="space-y-4">
            <MappingTab
              parsedData={parsedData}
              columnMapping={columnMapping}
              importConfig={importConfig}
              rawTableData={rawTableData}
              selectedHeaderIndex={selectedHeaderIndex}
              skippedRowIndices={skippedRowIndices}
              onColumnMappingChange={onColumnMappingChange}
              onImportConfigChange={onImportConfigChange}
              onToggleSkippedRow={onToggleSkippedRow}
              onSetSkippedRowsInRange={onSetSkippedRowsInRange}
              onHeaderSelect={onHeaderSelect}
            />
          </TabsContent>

          <TabsContent value="formatting" className="space-y-4">
            <FormattingTab
              importConfig={importConfig}
              onImportConfigChange={onImportConfigChange}
            />
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <TemplatesTab
              templates={templates}
              selectedTemplate={selectedTemplate}
              saveAsTemplate={saveAsTemplate}
              templateName={templateName}
              onTemplateSelect={onTemplateSelect}
              onApplyTemplate={onApplyTemplate}
              onSaveAsTemplateChange={onSaveAsTemplateChange}
              onTemplateNameChange={onTemplateNameChange}
              onDeleteTemplate={onDeleteTemplate}
            />
          </TabsContent>
        </Tabs>

        {/* Account Selection for Unmapped Transactions */}
        {!columnMapping.account && hasBudgetSelected && (
          <div className="p-4 border rounded-lg bg-muted/50">
            <Label className="text-sm font-medium">Default Account for Import</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Since no account column is mapped, transactions will be imported into the selected
              account:
            </p>
            <DefaultAccountSelect
              accounts={accounts}
              importConfig={importConfig}
              onImportConfigChange={onImportConfigChange}
              placeholder="Select account"
            />
          </div>
        )}

        {columnMapping.account && hasBudgetSelected && (
          <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/30">
            <Label className="text-sm font-medium">Account Column Mapped</Label>
            <p className="text-xs text-muted-foreground">
              Transactions will use accounts from the "{columnMapping.account}" column. If an
              account name doesn't match any existing account, you'll need to select a default
              account below:
            </p>
            <div className="mt-3">
              <Label className="text-xs">Fallback Account (for unmatched account names)</Label>
              <DefaultAccountSelect
                accounts={accounts}
                importConfig={importConfig}
                onImportConfigChange={onImportConfigChange}
                placeholder="Select fallback account"
                triggerClassName="mt-1 w-full min-w-0"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
            Back
          </Button>
          <Button onClick={onNext} disabled={!canProceed} className="w-full sm:w-auto">
            Preview Import
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
