import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
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
import { FileSpreadsheet, ArrowRight, Info } from 'lucide-react';
import { looksLikeYnabRegister } from '@budgero/core/browser';
import { Alert, AlertDescription } from '@shared/ui/alert';
import {
  type ParsedData,
  type ColumnMapping,
  type ImportConfig,
  type ImportTemplate,
  type RawTableData,
} from '@features/import/model/types';
import { planAccountRoutes } from '@features/import/lib/account-routes';
import { MappingTab } from './configure/MappingTab';
import { FormattingTab } from './configure/FormattingTab';
import { TemplatesTab } from './configure/TemplatesTab';
import { AccountsInFilePanel } from './configure/AccountsInFilePanel';

interface Account {
  ID: number;
  Name: string;
  Currency: string;
  Archived?: boolean;
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
        <SelectItem value="-1">
          <Trans>Create Import Account</Trans>
        </SelectItem>
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
  canEditTemplates: boolean;
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
  /** Account choices of earlier imports; null while they load (routes wait for them). */
  rememberedRoutes: Record<string, number> | null;
  /** Currency of accounts the import creates when the file states none. */
  newAccountCurrency?: string;
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
  canEditTemplates,
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
  rememberedRoutes,
  newAccountCurrency,
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
  const { t } = useLingui();

  const isYnabRegister =
    parsedData?.source.type === 'csv' && looksLikeYnabRegister(parsedData.headers);
  const rowsWithoutAccount = columnMapping.account
    ? (parsedData?.rows.filter((row) => !row[columnMapping.account!]?.trim()).length ?? 0)
    : 0;
  const rows = parsedData?.rows;
  const routePlan = useMemo(
    () =>
      planAccountRoutes({
        rows: rows ?? [],
        column: columnMapping.account,
        accounts: accounts ?? [],
        remembered: rememberedRoutes ?? {},
        chosen: importConfig.accountRoutes,
        newAccountCurrency: newAccountCurrency ?? importConfig.accountCurrency,
        fallbackAccountId: importConfig.defaultAccountId,
      }),
    [
      rows,
      columnMapping.account,
      accounts,
      rememberedRoutes,
      importConfig.accountRoutes,
      importConfig.accountCurrency,
      importConfig.defaultAccountId,
      newAccountCurrency,
    ]
  );
  const canProceed =
    columnMapping.date &&
    (columnMapping.amount || columnMapping.inflow || columnMapping.outflow) &&
    hasBudgetSelected &&
    rememberedRoutes !== null &&
    routePlan.problems.size === 0 &&
    (columnMapping.account
      ? rowsWithoutAccount === 0 || importConfig.defaultAccountId
      : importConfig.defaultAccountId);

  return (
    <Card className="mx-auto w-full max-w-4xl overflow-x-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <FileSpreadsheet className="h-5 w-5" />
            Configure Import Settings
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Map your file columns to transaction fields and set formatting options</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 overflow-x-hidden">
        <Tabs defaultValue="mapping" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger
              value="mapping"
              className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm"
            >
              <span className="sm:hidden">
                <Trans>Mapping</Trans>
              </span>
              <span className="hidden sm:inline">
                <Trans>Column Mapping</Trans>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="formatting"
              className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm"
            >
              <Trans>Formatting</Trans>
            </TabsTrigger>
            <TabsTrigger
              value="templates"
              className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm"
            >
              <Trans>Templates</Trans>
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
              canEdit={canEditTemplates}
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

        {isYnabRegister && (
          <Alert data-testid="ynab-register-hint">
            <Info className="h-4 w-4" />
            <AlertDescription>
              <Trans>
                <strong>This looks like a YNAB register.</strong> Imported here, your transactions
                and categories come in, but not your category groups or what you assigned each
                month. To bring your whole YNAB budget, import the YNAB export ZIP instead: open the
                budget switcher, choose Create New Budget, then the YNAB tab.
              </Trans>
            </AlertDescription>
          </Alert>
        )}

        {/* Account Selection for Unmapped Transactions */}
        {!columnMapping.account && hasBudgetSelected && (
          <div className="p-4 border rounded-lg bg-muted/50">
            <Label className="text-sm font-medium">
              <Trans>Default Account for Import</Trans>
            </Label>
            <p className="text-xs text-muted-foreground mb-3">
              <Trans>
                Since no account column is mapped, transactions will be imported into the selected
                account:
              </Trans>
            </p>
            <DefaultAccountSelect
              accounts={accounts}
              importConfig={importConfig}
              onImportConfigChange={onImportConfigChange}
              placeholder={t`Select account`}
            />
          </div>
        )}

        {columnMapping.account && hasBudgetSelected && parsedData && (
          <AccountsInFilePanel
            plan={routePlan}
            column={columnMapping.account}
            accounts={accounts ?? []}
            importConfig={importConfig}
            onImportConfigChange={onImportConfigChange}
          />
        )}

        {columnMapping.account && hasBudgetSelected && rowsWithoutAccount > 0 && (
          <div className="p-4 border rounded-lg bg-muted/50">
            <Label className="text-sm font-medium">
              <Trans>Rows without an account</Trans>
            </Label>
            <p className="text-xs text-muted-foreground mb-3">
              {plural(rowsWithoutAccount, {
                one: `One row has an empty "${columnMapping.account}" value. It goes into this account:`,
                other: `# rows have an empty "${columnMapping.account}" value. They go into this account:`,
              })}
            </p>
            <DefaultAccountSelect
              accounts={accounts}
              importConfig={importConfig}
              onImportConfigChange={onImportConfigChange}
              placeholder={t`Select account`}
            />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
            <Trans>Back</Trans>
          </Button>
          <Button onClick={onNext} disabled={!canProceed} className="w-full sm:w-auto">
            <Trans>
              Preview Import
              <ArrowRight className="ml-2 h-4 w-4" />
            </Trans>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
