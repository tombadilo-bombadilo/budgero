import { Trans, useLingui } from '@lingui/react/macro';
import { Check, Plus } from 'lucide-react';
import React from 'react';
import { cn } from '@shared/lib/utils';
import { CATEGORY_PRESETS, CATEGORY_ITEM_LABELS } from '../onboarding-data';
import { Title, type StepProps } from './shared';

export const CategoriesStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const { t } = useLingui();
  const toggleCat = (cat: string) => {
    const has = state.selectedCats.includes(cat);
    set({
      selectedCats: has
        ? state.selectedCats.filter((c) => c !== cat)
        : [...state.selectedCats, cat],
    });
  };
  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />
      <div className="grid gap-4 md:grid-cols-3 md:gap-5">
        {Object.entries(CATEGORY_PRESETS).map(([key, group]) => (
          <div key={key}>
            <div className="mb-2 flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: group.color }}
              />
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground">
                {t(group.label)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const on = state.selectedCats.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCat(item)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-muted/60'
                    )}
                  >
                    {on ? (
                      <Check aria-hidden className="size-3.5" />
                    ) : (
                      <Plus aria-hidden className="size-3.5 text-muted-foreground" />
                    )}
                    {CATEGORY_ITEM_LABELS[item] ? t(CATEGORY_ITEM_LABELS[item]) : item}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-muted-foreground">
        <Trans>
          {state.selectedCats.length} envelopes selected. You can always add more later.
        </Trans>
      </div>
    </div>
  );
};
