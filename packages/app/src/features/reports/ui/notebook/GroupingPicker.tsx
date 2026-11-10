import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  DATE_BUCKETS,
  NUMERIC_BIN_WIDTHS,
  customFields,
  datePartsFor,
  groupableFields,
  numericFields,
  questionField,
  type FieldDef,
  type QuestionBreakout,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { getLocaleTag } from '@shared/i18n';
import { cn } from '@shared/lib/utils';
import { FieldList } from './FilterEditor';
import { bucketLabel, datePartLabel, specFieldLabel } from './question-labels';

interface GroupingPickerProps {
  spec: QuestionSpec;
  /** The grouping being changed; omitted when adding one. */
  initial?: QuestionBreakout;
  onPick: (breakout: QuestionBreakout) => void;
}

/** Fields a question can group by: categories, dates, and numbers (as ranges). */
function groupingFields(spec: QuestionSpec): FieldDef[] {
  const custom = Array.from(customFields(spec.source, spec.customColumns).values()).map(
    (entry) => entry.field
  );
  const groupable = groupableFields(spec.source);
  const numbers = numericFields(spec.source);
  return [...groupable, ...numbers, ...custom];
}

/**
 * "Group by" picker: a field, then for dates the period (day … year) or a
 * part of the date (weekday, month of year, …), for numbers the range width.
 */
export function GroupingPicker({ spec, initial, onPick }: GroupingPickerProps) {
  const { t } = useLingui();
  const [fieldId, setFieldId] = useState<string | null>(initial?.field ?? null);
  const field = fieldId ? questionField(spec, fieldId) : undefined;
  const labelOf = (id: string) => specFieldLabel(spec, id);

  const pickField = (id: string) => {
    const next = questionField(spec, id);
    if (!next) return;
    if (next.type === 'date' || next.type === 'number') setFieldId(id);
    else onPick({ field: next.id });
  };

  if (!field || (field.type !== 'date' && field.type !== 'number')) {
    return (
      <FieldList
        source={spec.source}
        fields={groupingFields(spec)}
        onPick={pickField}
        placeholder={t`Group by…`}
        labelOf={labelOf}
      />
    );
  }

  const same = initial?.field === field.id ? initial : undefined;
  const option = (key: string, label: string, selected: boolean, breakout: QuestionBreakout) => (
    <button
      key={key}
      type="button"
      aria-pressed={selected}
      onClick={() => onPick(breakout)}
      className={cn(
        'min-h-9 rounded-md border px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/10 font-medium text-foreground'
          : 'border-border hover:bg-muted'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setFieldId(null)}
          aria-label={t`Choose another field`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="text-sm font-semibold">{labelOf(field.id)}</span>
      </div>
      {field.type === 'date' ? (
        <>
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">
              <Trans>By period</Trans>
            </h4>
            <div className="grid grid-cols-3 gap-1.5">
              {DATE_BUCKETS.filter((bucket) => field.buckets?.includes(bucket)).map((bucket) =>
                option(bucket, bucketLabel(bucket), same?.bucket === bucket, {
                  field: field.id,
                  bucket,
                })
              )}
            </div>
          </section>
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">
              <Trans>By part of the date</Trans>
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {datePartsFor(field).map((part) =>
                option(part, datePartLabel(part), same?.part === part, { field: field.id, part })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans>Compares like with like, e.g. every Monday or every March together.</Trans>
            </p>
          </section>
        </>
      ) : (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Trans>In ranges of</Trans>
          </h4>
          <div className="grid grid-cols-3 gap-1.5">
            {option('auto', t`Auto`, same?.bin === 'auto', { field: field.id, bin: 'auto' })}
            {NUMERIC_BIN_WIDTHS.map((width) =>
              option(String(width), width.toLocaleString(getLocaleTag()), same?.bin === width, {
                field: field.id,
                bin: width,
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
