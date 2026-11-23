import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
/**
 * "YNAB" tab of CreateBudgetForm: import a YNAB ZIP export as a new budget.
 */

import type { ChangeEvent, RefObject } from 'react';
import type {
  YNABApiPlanSummary,
  YNABImportConfig,
  YNABImportPreview,
} from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Field } from '@shared/ui/field';
import { AlertTriangle, KeyRound, Loader2, Upload } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { IconPicker } from '@features/budget-management/ui/IconPicker';
import { FormatSelector } from '@features/budget-management/ui/FormatSelector';
import { YnabExportGuide } from './YnabExportGuide';
import { YnabPatHelpPopover } from './YnabPatHelpPopover';
import { YnabDateOrderChoice } from './YnabDateOrderChoice';
import { YnabCreditPaymentMatching } from './YnabCreditPaymentMatching';
import {
  hasCompleteCreditPaymentMappings,
  type CreditPaymentMappings,
} from './ynab-credit-payment-matching';

interface YnabImportTabProps {
  sourceMode: 'api' | 'zip';
  onSourceModeChange: (value: 'api' | 'zip') => void;
  personalAccessToken: string;
  onPersonalAccessTokenChange: (value: string) => void;
  plans: YNABApiPlanSummary[];
  selectedPlanId: string;
  onSelectedPlanChange: (value: string) => void;
  isConnecting: boolean;
  onConnect: () => void;
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
  preview: YNABImportPreview | null;
  dateOrder?: YNABImportConfig['dateOrder'];
  onDateOrderChange: (value: NonNullable<YNABImportConfig['dateOrder']>) => void;
  creditPaymentMappings?: CreditPaymentMappings;
  onCreditPaymentMappingsChange: (value: CreditPaymentMappings) => void;
  isInspecting: boolean;
  isImporting: boolean;
  onReset: () => void;
  onImport: () => void;
}

export function YnabImportTab({
  sourceMode,
  onSourceModeChange,
  personalAccessToken,
  onPersonalAccessTokenChange,
  plans,
  selectedPlanId,
  onSelectedPlanChange,
  isConnecting,
  onConnect,
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
  preview,
  dateOrder,
  onDateOrderChange,
  creditPaymentMappings,
  onCreditPaymentMappingsChange,
  isInspecting,
  isImporting,
  onReset,
  onImport,
}: YnabImportTabProps) {
  const { t } = useLingui();

  const canImport =
    Boolean(budgetName.trim()) &&
    Boolean(preview) &&
    (sourceMode !== 'api' ||
      hasCompleteCreditPaymentMappings(preview?.creditPaymentMatching, creditPaymentMappings)) &&
    (sourceMode !== 'zip' || !preview?.dateOrderAmbiguous || Boolean(dateOrder)) &&
    (sourceMode === 'api' ? Boolean(selectedPlanId) : Boolean(file));

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
        <Button
          type="button"
          size="sm"
          variant={sourceMode === 'api' ? 'default' : 'ghost'}
          onClick={() => onSourceModeChange('api')}
          disabled={isImporting || isConnecting}
        >
          <Trans>
            <KeyRound className="h-3.5 w-3.5" />
            Connect directly
          </Trans>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sourceMode === 'zip' ? 'default' : 'ghost'}
          onClick={() => onSourceModeChange('zip')}
          disabled={isImporting || isConnecting}
        >
          <Trans>
            <Upload className="h-3.5 w-3.5" />
            Export ZIP
          </Trans>
        </Button>
      </div>

      {sourceMode === 'api' && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="ynabPersonalAccessToken" className="text-xs sm:text-sm">
                <Trans>YNAB personal access token</Trans>
              </Label>
              <YnabPatHelpPopover />
            </div>
            <div className="flex gap-2">
              <Input
                id="ynabPersonalAccessToken"
                type="password"
                autoComplete="off"
                value={personalAccessToken}
                onChange={(event) => onPersonalAccessTokenChange(event.target.value)}
                placeholder={t`Paste token for this import only`}
                disabled={isImporting || isConnecting}
                className="h-8 sm:h-9"
              />
              <Button
                type="button"
                variant="outline"
                onClick={onConnect}
                disabled={!personalAccessToken.trim() || isImporting || isConnecting}
                className="h-8 sm:h-9"
              >
                {isConnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isConnecting ? t`Connecting…` : t`Connect`}
              </Button>
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">
              <Trans>
                Used in memory for this import and never saved to Budgero or browser storage.
              </Trans>
            </p>
          </div>

          {plans.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="ynabPlan" className="text-xs sm:text-sm">
                <Trans>YNAB plan</Trans>
              </Label>
              <Select
                value={selectedPlanId}
                onValueChange={onSelectedPlanChange}
                disabled={isImporting || isConnecting}
              >
                <SelectTrigger id="ynabPlan" size="sm" className="w-full min-w-0">
                  <SelectValue placeholder="Select a YNAB plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <Field
        label={
          <span className="text-xs sm:text-sm">
            <Trans>Budget Name</Trans>
          </span>
        }
        htmlFor="importName"
      >
        <Input
          id="importName"
          value={budgetName}
          onChange={(e) => onBudgetNameChange(e.target.value)}
          placeholder={t`Enter a name for your imported budget`}
          disabled={isImporting}
          className="h-8 sm:h-9"
        />
      </Field>

      <div className="space-y-3 sm:space-y-4">
        <div className="space-y-1.5">
          <CurrencySelector
            value={currency}
            onValueChange={onCurrencyChange}
            label={t`Budget Currency`}
          />
          <p className="text-xs text-muted-foreground">
            <Trans>
              The base currency used for categories, assignments, reports, and converted account
              values.
            </Trans>
          </p>
        </div>

        <div className="space-y-1.5">
          <FormatSelector
            value={numberFormat}
            currency={currency}
            onValueChange={onNumberFormatChange}
            label={t`Number Format`}
          />
          <p className="text-xs text-muted-foreground">
            <Trans>How numbers and decimals are displayed throughout the app.</Trans>
          </p>
        </div>

        <div className="space-y-1.5">
          <IconPicker
            value={importBadgeIcon}
            onValueChange={onImportBadgeIconChange}
            label={t`Budget Icon`}
          />
        </div>
      </div>

      {sourceMode === 'zip' && (
        <div className="space-y-1.5">
          <Label htmlFor="importFile" className="text-xs sm:text-sm">
            <Trans>YNAB Export File (ZIP)</Trans>
          </Label>
          {/* Native file input is visually hidden and driven by the button
            below so we can show an Upload icon and the chosen filename. */}
          <Input
            id="importFile"
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={onFileChange}
            disabled={isImporting || isInspecting}
            className="sr-only"
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isImporting || isInspecting}
              onClick={() => fileInputRef.current?.click()}
              className="h-8 sm:h-9 shrink-0 text-xs sm:text-sm"
            >
              <Trans>
                <Upload className="h-4 w-4" />
                Choose file
              </Trans>
            </Button>
            <span className="min-w-0 break-words text-xs sm:text-sm text-muted-foreground">
              {file ? file.name : t`No file chosen`}
            </span>
          </div>
          {isInspecting && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Trans>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Inspecting accounts, categories, and split transactions…
              </Trans>
            </div>
          )}
          {preview && (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3 text-xs">
              <p className="font-medium text-foreground">
                <Trans>Detected in this export</Trans>
              </p>
              <p className="text-muted-foreground">
                {plural(preview.accountCount, { one: '# account', other: '# accounts' })}
                {' · '}
                {plural(preview.categoryCount, { one: '# category', other: '# categories' })}
                {' · '}
                {plural(preview.registerRowCount, {
                  one: '# register row',
                  other: '# register rows',
                })}
              </p>

              {preview.dateOrderAmbiguous && (
                <YnabDateOrderChoice
                  value={dateOrder}
                  onChange={onDateOrderChange}
                  disabled={isImporting || isInspecting}
                />
              )}

              <div className="flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50 p-2.5 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <p className="font-medium">
                    <Trans>Review account types after import</Trans>
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] opacity-90">
                    <Trans>
                      YNAB does not reliably export account types. Budgero recognizes credit cards
                      where possible and imports other accounts as Checking, so verify every account
                      before budgeting.
                    </Trans>
                  </p>
                </div>
              </div>

              {preview.missingCategories.length > 0 && (
                <div className="rounded-md border border-amber-300/70 bg-amber-50 p-2.5 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                  <p className="font-medium">
                    {plural(preview.missingCategories.length, {
                      one: '# register category is missing from Plan.csv',
                      other: '# register categories are missing from Plan.csv',
                    })}
                  </p>
                  <p className="mt-1 text-[0.6875rem] opacity-90">
                    <Trans>
                      Budgero will create{' '}
                      {preview.missingCategories
                        .map((category) => `${category.categoryGroup} › ${category.category}`)
                        .join(', ')}
                      .
                    </Trans>
                  </p>
                </div>
              )}

              {preview.splitTransactions.length > 0 && (
                <div className="rounded-md border p-2.5">
                  <p className="font-medium text-foreground">
                    {plural(preview.splitTransactions.length, {
                      one: '# split transaction detected',
                      other: '# split transactions detected',
                    })}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                    <Trans>
                      Budgero will import complete Split (1/n)…Split (n/n) sequences as split
                      transactions automatically.
                    </Trans>
                  </p>
                </div>
              )}
            </div>
          )}
          <YnabExportGuide />
        </div>
      )}

      {sourceMode === 'api' && (isConnecting || preview) && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3 text-xs">
          {isConnecting && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Trans>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reading the selected YNAB plan…
              </Trans>
            </div>
          )}
          {preview && !isConnecting && (
            <>
              <p className="font-medium text-foreground">
                <Trans>Detected through the YNAB API</Trans>
              </p>
              <p className="text-muted-foreground">
                {plural(preview.accountCount, { one: '# account', other: '# accounts' })}
                {' · '}
                {plural(preview.categoryCount, { one: '# category', other: '# categories' })}
                {' · '}
                {plural(preview.registerRowCount, {
                  one: '# register row',
                  other: '# register rows',
                })}
              </p>
              {preview.creditPaymentMatching && (
                <YnabCreditPaymentMatching
                  matching={preview.creditPaymentMatching}
                  value={creditPaymentMappings}
                  onChange={onCreditPaymentMappingsChange}
                  currency={currency}
                  disabled={isImporting || isConnecting}
                />
              )}
              <p className="text-[0.6875rem] text-muted-foreground">
                <Trans>Account types and on-budget status will be preserved from YNAB.</Trans>
              </p>
            </>
          )}
        </div>
      )}

      <div className="pt-2">
        <div className="flex gap-2 w-full">
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            disabled={isImporting || isInspecting}
            className="flex-1 h-8 sm:h-9"
          >
            <Trans>Reset</Trans>
          </Button>

          <Button
            type="button"
            onClick={onImport}
            disabled={!canImport || isImporting || isInspecting || isConnecting}
            className="flex-1 h-8 sm:h-9"
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                <span className="text-xs sm:text-sm">
                  <Trans>Importing...</Trans>
                </span>
              </>
            ) : (
              <>
                <Upload className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="text-xs sm:text-sm">
                  <Trans>Import</Trans>
                </span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
