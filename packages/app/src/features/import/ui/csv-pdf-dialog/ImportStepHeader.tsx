'use client';

import React from 'react';
import type { ImportStep } from '@features/import/model/types';
import { STEPS } from './useImportDialogState';

export interface ImportStepHeaderProps {
  currentStep: ImportStep;
}

function ImportStepHeaderComponent({ currentStep }: ImportStepHeaderProps) {
  return (
    <div className="flex items-center justify-center mb-6 sm:mb-8 px-2">
      {STEPS.map((step, index) => (
        <div key={step} className="flex items-center">
          <div
            className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium flex-shrink-0
              ${
                currentStep === step
                  ? 'bg-primary text-primary-foreground'
                  : STEPS.indexOf(currentStep) > index
                    ? 'bg-green-600 text-white'
                    : 'bg-muted text-muted-foreground'
              }`}
          >
            {index + 1}
          </div>
          {index < STEPS.length - 1 && (
            <div
              className={`w-6 sm:w-12 h-0.5 mx-1 sm:mx-2
                ${STEPS.indexOf(currentStep) > index ? 'bg-green-600' : 'bg-muted'}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export const ImportStepHeader = React.memo(ImportStepHeaderComponent);
