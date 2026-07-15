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
    YNAB web app
  </a>
);

// Rendered as the numbered steps in the "How to export from YNAB" guide.
const YNAB_GUIDE_STEPS: ReactNode[] = [
  <>
    Open your budget in the {YNAB_WEB_APP_LINK} and go to{' '}
    <span className="font-medium text-foreground">Plan Settings</span>
  </>,
  <>
    Set <span className="font-medium text-foreground">Number Format</span> to{' '}
    <span className="font-mono text-foreground">123,456.78</span>
  </>,
  <>
    Set <span className="font-medium text-foreground">Date Format</span> to{' '}
    <span className="font-mono text-foreground">2025-12-30</span>
  </>,
  <>
    Set <span className="font-medium text-foreground">Currency Placement</span> to{' '}
    <span className="font-medium text-foreground">&quot;Don&apos;t Show&quot;</span>
  </>,
  <>
    Click your budget name in the top-left corner and select{' '}
    <span className="font-medium text-foreground">Export Budget</span>, then save the ZIP file
  </>,
  <>Upload the ZIP file above</>,
];

const FULL_GUIDE_LINK = (
  <a
    href="https://budgero.app/docs/ynab-import"
    target="_blank"
    rel="noopener noreferrer"
    className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
  >
    full import guide
  </a>
);

export function YnabExportGuide() {
  return (
    // The guide item ships open on purpose: users who skipped it exported
    // with locale date/number formats and got silently shifted dates and
    // wrong amounts.
    <Accordion
      type="single"
      collapsible
      defaultValue="guide"
      className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-4"
    >
      <AccordionItem value="guide">
        <AccordionTrigger className="text-xs sm:text-sm">How to export from YNAB</AccordionTrigger>
        <AccordionContent className="text-xs sm:text-sm">
          <p className="mb-3 text-xs text-muted-foreground">
            Export is only available on the {YNAB_WEB_APP_LINK} (not the mobile app). Please follow
            these steps — the format settings decide whether your dates and amounts import
            correctly. See the {FULL_GUIDE_LINK} for details on what is and isn&apos;t imported.
          </p>
          <ol className="list-none space-y-2.5 text-muted-foreground">
            {YNAB_GUIDE_STEPS.map((step, index) => (
              <li key={index} className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-muted-foreground/70">
            Budgero tries to detect other format settings, but exports made with the settings above
            are the only ones that import losslessly.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="limitations">
        <AccordionTrigger className="text-xs sm:text-sm">Import limitations</AccordionTrigger>
        <AccordionContent className="text-xs sm:text-sm text-muted-foreground">
          YNAB exports do not include goals or account types, so every account arrives as an
          on-budget Checking account. After the import, edit each account to set its real type
          (savings, credit card, …) and set up goals manually. See the {FULL_GUIDE_LINK} for the
          complete post-import checklist.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
