import { useLingui } from '@lingui/react/macro';
import { Ban, Filter, ListTree, Rows3, ZoomIn } from 'lucide-react';
import {
  applyDrill,
  drillOptions,
  type DateBucket,
  type DrillAction,
  type DrillValue,
  type QuestionSpec,
} from '@features/reports/lib/question';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { FieldIcon } from './FieldIcon';
import { specFieldLabel } from './question-labels';
import { useQuestionFormatters } from './useQuestionFormatters';

function useZoomLabel() {
  const { t } = useLingui();
  return (bucket: DateBucket): string => {
    switch (bucket) {
      case 'day':
        return t`Zoom in: by day`;
      case 'week':
        return t`Zoom in: by week`;
      case 'month':
        return t`Zoom in: by month`;
      case 'quarter':
        return t`Zoom in: by quarter`;
      case 'year':
        return t`Zoom in: by year`;
    }
  };
}

/** A click on a chart mark or a summarized table cell. */
export interface DrillRequest {
  values: DrillValue[];
  /** Viewport point the menu opens at. */
  anchor: { x: number; y: number };
}

interface DrillMenuProps {
  /** The question the clicked result belongs to. */
  spec: QuestionSpec;
  request: DrillRequest | null;
  onClose: () => void;
  /** Called with the drilled question. */
  onDrill: (spec: QuestionSpec) => void;
}

/**
 * "What do you want to see?" menu for a clicked value: the rows behind it,
 * a break-out by another field, a finer date bucket, or keep / drop the value.
 */
export function DrillMenu({ spec, request, onClose, onDrill }: DrillMenuProps) {
  const { t } = useLingui();
  const format = useQuestionFormatters(spec.source);
  const zoomLabel = useZoomLabel();
  if (!request) return null;
  const context = { spec, values: request.values };
  const options = drillOptions(context);
  const run = (action: DrillAction) => {
    onDrill(applyDrill(context, action));
    onClose();
  };
  const valueText = (value: DrillValue) => format.cell(value.column, value.value, 'long');
  const heading = request.values.map(valueText).join(' · ');
  const recordsLabel =
    spec.source === 'transactions'
      ? t`See these transactions`
      : spec.source === 'accounts'
        ? t`See these accounts`
        : t`See these rows`;
  const nothing =
    !options.records &&
    options.breakoutFields.length === 0 &&
    !options.zoom &&
    options.categorical.length === 0;

  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed h-px w-px"
          style={{ left: request.anchor.x, top: request.anchor.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 max-w-[calc(100vw-1rem)]"
        aria-label={t`Explore ${heading}`}
      >
        {heading && (
          <DropdownMenuLabel className="truncate text-xs font-medium text-muted-foreground">
            {heading}
          </DropdownMenuLabel>
        )}
        {options.records && (
          <DropdownMenuItem onSelect={() => run({ kind: 'records' })}>
            <Rows3 className="h-4 w-4" aria-hidden />
            {recordsLabel}
          </DropdownMenuItem>
        )}
        {options.zoom && (
          <DropdownMenuItem onSelect={() => run({ kind: 'zoom', key: options.zoom!.key })}>
            <ZoomIn className="h-4 w-4" aria-hidden />
            {zoomLabel(options.zoom.bucket)}
          </DropdownMenuItem>
        )}
        {options.breakoutFields.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2 [&_svg:not([class*='text-'])]:text-muted-foreground">
              <ListTree className="h-4 w-4" aria-hidden />
              {t`Break out by…`}
            </DropdownMenuSubTrigger>
            {/* Portaled: the menu scrolls, which would clip an inline submenu. */}
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                {options.breakoutFields.map((field) => (
                  <DropdownMenuItem
                    key={field.id}
                    onSelect={() => run({ kind: 'breakout', field: field.id })}
                  >
                    <FieldIcon type={field.type} />
                    {specFieldLabel(spec, field.id)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        )}
        {options.categorical.length > 0 && <DropdownMenuSeparator />}
        {options.categorical.map((value) => {
          const text = valueText(value);
          return [
            <DropdownMenuItem
              key={`${value.column.key}-only`}
              onSelect={() => run({ kind: 'filter', key: value.column.key })}
            >
              <Filter className="h-4 w-4" aria-hidden />
              <span className="truncate">{t`Only ${text}`}</span>
            </DropdownMenuItem>,
            <DropdownMenuItem
              key={`${value.column.key}-exclude`}
              onSelect={() => run({ kind: 'filter', key: value.column.key, exclude: true })}
            >
              <Ban className="h-4 w-4" aria-hidden />
              <span className="truncate">{t`Exclude ${text}`}</span>
            </DropdownMenuItem>,
          ];
        })}
        {nothing && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t`Nothing to explore for this value.`}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
