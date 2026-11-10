'use client';

import { Trans } from '@lingui/react/macro';

import { useImportDialogState } from './useImportDialogState';
import { ImportStepHeader } from './ImportStepHeader';

import { UploadStep, ConfigureStep, PreviewStep, ImportProgressStep, CompleteStep } from '../steps';

export function CSVPDFImportDialog() {
  const state = useImportDialogState();

  return (
    <div className="space-y-6">
      <ImportStepHeader currentStep={state.currentStep} />
      {state.error && state.currentStep !== 'import' && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      {state.isChecking && (
        <p role="status">
          <Trans>Checking for duplicates…</Trans>
        </p>
      )}

      {state.currentStep === 'upload' && (
        <UploadStep
          fileInputRef={state.fileInputRef}
          onFileChange={state.handleFileChange}
          error={state.error}
          hasBudgetSelected={state.hasBudgetSelected}
        />
      )}

      {state.currentStep === 'configure' && (
        <ConfigureStep
          parsedData={state.parsedData}
          columnMapping={state.columnMapping}
          importConfig={state.importConfig}
          templates={state.templates}
          selectedTemplate={state.selectedTemplate}
          saveAsTemplate={state.saveAsTemplate}
          templateName={state.templateName}
          rawTableData={state.rawTableData}
          selectedHeaderIndex={state.selectedHeaderIndex}
          skippedRowIndices={state.skippedRowIndices}
          onToggleSkippedRow={state.toggleSkippedRow}
          onSetSkippedRowsInRange={state.setSkippedRowsInRange}
          accounts={state.accounts}
          hasBudgetSelected={state.hasBudgetSelected}
          budgetId={state.budgetId}
          newAccountCurrency={state.newAccountCurrency}
          onColumnMappingChange={state.setColumnMapping}
          onImportConfigChange={state.setImportConfig}
          onTemplateSelect={state.setSelectedTemplate}
          onApplyTemplate={state.applyTemplate}
          onSaveAsTemplateChange={state.setSaveAsTemplate}
          onTemplateNameChange={state.setTemplateName}
          onDeleteTemplate={state.deleteTemplate}
          onHeaderSelect={state.handleHeaderSelect}
          onBack={() => state.setCurrentStep('upload')}
          onNext={state.generatePreview}
        />
      )}

      {state.currentStep === 'preview' && (
        <PreviewStep
          busy={state.isChecking}
          onDecision={state.setRowDecision}
          onResolveAll={state.resolveAll}
          previewData={state.previewData}
          previewTotalCount={state.previewTotalCount}
          previewImportableCount={state.previewImportableCount}
          previewSkippedCount={state.previewSkippedCount}
          columnMapping={state.columnMapping}
          importConfig={state.importConfig}
          hasBudgetSelected={state.hasBudgetSelected}
          onBack={() => state.setCurrentStep('configure')}
          onStartImport={state.handleImport}
        />
      )}

      {state.currentStep === 'import' && (
        <ImportProgressStep progress={state.progress} error={state.error} />
      )}

      {state.currentStep === 'complete' && (
        <CompleteStep importSummary={state.importSummary} onReset={state.resetForm} />
      )}
    </div>
  );
}
