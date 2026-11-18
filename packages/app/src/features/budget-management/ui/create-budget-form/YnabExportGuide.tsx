import { Trans } from '@lingui/react/macro';
/**
 * Static "How to export from YNAB" + limitations accordion shown under the
 * YNAB import file picker. Self-contained (no props) since its content never
 * varies with form state.
 */

import type { ReactNode } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';

const YNAB_WEB_APP_LINK = (
  <a
    href="https://app.ynab.com"
    target="_blank"
    rel="noopener noreferrer"
    className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
  >
    <Trans>YNAB web app</Trans>
  </a>
);

// Rendered as the numbered steps in the "How to export from YNAB" guide.
const YNAB_GUIDE_STEPS: ReactNode[] = [
  <Trans>
    Open your budget in the {YNAB_WEB_APP_LINK} and go to{' '}
    <span className="font-medium text-foreground">
      <Trans>Plan Settings</Trans>
    </span>
  </Trans>,
  <Trans>
    Set{' '}
    <span className="font-medium text-foreground">
      <Trans>Number Format</Trans>
    </span>{' '}
    to <span className="font-mono text-foreground">123,456.78</span>
  </Trans>,
  <Trans>
    Set{' '}
    <span className="font-medium text-foreground">
      <Trans>Date Format</Trans>
    </span>{' '}
    to <span className="font-mono text-foreground">2025-12-30</span>
  </Trans>,
  <Trans>
    Set{' '}
    <span className="font-medium text-foreground">
      <Trans>Currency Placement</Trans>
    </span>{' '}
    to{' '}
    <span className="font-medium text-foreground">
      <Trans>"Don't Show"</Trans>
    </span>
  </Trans>,
  <Trans>
    Click your budget name in the top-left corner and select{' '}
    <span className="font-medium text-foreground">
      <Trans>Export Budget</Trans>
    </span>
    , then save the ZIP file
  </Trans>,
  <Trans>Upload the ZIP file above</Trans>,
];

const FULL_GUIDE_LINK = (
  <a
    href="https://budgero.app/docs/ynab-import"
    target="_blank"
    rel="noopener noreferrer"
    className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
  >
    <Trans>full import guide</Trans>
  </a>
);

export function YnabExportGuide() {
  return (
    <Accordion
      type="single"
      collapsible
      className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-4"
    >
      <AccordionItem value="guide">
        <AccordionTrigger className="text-xs sm:text-sm">
          <Trans>How to export from YNAB</Trans>
        </AccordionTrigger>
        <AccordionContent className="text-xs sm:text-sm">
          <p className="mb-3 text-xs text-muted-foreground">
            <Trans>
              Export is only available on the {YNAB_WEB_APP_LINK} (not the mobile app). Please
              follow these steps — the format settings decide whether your dates and amounts import
              correctly. See the {FULL_GUIDE_LINK}for details on what is and isn't imported.
            </Trans>
          </p>
          <ol className="list-none space-y-2.5 text-muted-foreground">
            {YNAB_GUIDE_STEPS.map((step, index) => (
              <li key={index} className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.625rem] font-bold text-primary">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[0.6875rem] text-muted-foreground/70">
            <Trans>
              Budgero tries to detect other format settings, but exports made with the settings
              above are the only ones that import losslessly.
            </Trans>
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="limitations">
        <AccordionTrigger className="text-xs sm:text-sm">
          <Trans>Import limitations</Trans>
        </AccordionTrigger>
        <AccordionContent className="text-xs sm:text-sm text-muted-foreground">
          <Trans>
            YNAB exports do not include goals and do not reliably include account types. Budgero
            recognizes credit cards where possible and imports other accounts as on-budget Checking.
            After the import, verify every account type and set up goals manually. See the{' '}
            {FULL_GUIDE_LINK} for the complete post-import checklist.
          </Trans>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
