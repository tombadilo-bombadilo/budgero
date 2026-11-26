import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { ExternalLink, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { docsUrl } from '@shared/lib/docs-url';

/** Example searches; keywords stay English in every language. */
const EXAMPLES = [
  'groceries last month',
  'outflows over 100',
  '> 50 this week',
  'between 20 and 50',
  'uncleared',
  'uncategorized last 30 days',
  'label:trip',
  '-payee:amazon',
  '-category:"Dining Out"',
  'no:memo',
  'split since 2026-01-01',
  '"coffee shop" since march',
  'transfers 2025',
] as const;

interface SearchHelpPopoverProps {
  /** Puts an example in the search box. */
  onPickExample: (query: string) => void;
}

/**
 * The (i) button in the register search box: what the search understands, a few
 * examples to try, and a link to the full docs. A popover (not a hover tooltip)
 * so it opens with a tap on phones and with Enter/Space from the keyboard.
 */
export function SearchHelpPopover({ onPickExample }: SearchHelpPopoverProps) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t`How search works`}
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        <p className="font-medium">
          <Trans>Search in plain words</Trans>
        </p>
        <p className="text-muted-foreground">
          <Trans>
            Dates, amounts, categories, labels and words like outflows or uncleared become filters.
            Other words must all appear in the payee, memo, category, label or account. Use quotes
            for an exact phrase, a minus to leave something out, and payee:, memo:, account:,
            category: or label: to search one field.
          </Trans>
        </p>
        <p className="text-muted-foreground">
          <Trans>
            Start typing a category, label, payee or account name, also after a minus, and pick it
            from the list. Budgero adds the field and the quotes for you.
          </Trans>
        </p>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            <Trans>Try one:</Trans>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onPickExample(example);
                  setOpen(false);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <Trans>Filter words are English in every language.</Trans>
        </p>
        <a
          href={docsUrl('semantic-search', i18n.locale)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Trans>Learn more</Trans>
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  );
}
