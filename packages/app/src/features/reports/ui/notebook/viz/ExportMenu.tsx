import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type RefObject } from 'react';
import { Download, FileSpreadsheet, ImageDown } from 'lucide-react';
import { toast } from 'sonner';
import type { QuestionColumn, QuestionSource } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { getErrorMessage } from '@shared/lib/errors';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { downloadChartPng, downloadCsv, hasExportableChart, questionResultCsv } from './export';

interface ExportMenuProps {
  /** Title for file names and the PNG heading. */
  name: string;
  result: QueryResult | null;
  /** Question columns (friendly CSV headers); omit for plain SQL results. */
  columns?: QuestionColumn[];
  source?: QuestionSource;
  /** Element holding the rendered chart. */
  chartRef: RefObject<HTMLElement | null>;
  className?: string;
}

/** Download menu: result CSV and chart PNG. */
export function ExportMenu({
  name,
  result,
  columns,
  source,
  chartRef,
  className,
}: ExportMenuProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const [canPng, setCanPng] = useState(false);

  const exportCsv = () => {
    if (!result) return;
    const csv =
      columns && source
        ? questionResultCsv(result, columns, source)
        : questionResultCsv(result, [], 'transactions');
    downloadCsv(csv, name);
  };
  const exportPng = async () => {
    try {
      const saved = await downloadChartPng(chartRef.current, name, {
        background: palette.chrome.surface,
        ink: palette.chrome.inkPrimary,
      });
      if (!saved) toast.error(t`There is no chart to save as an image.`);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not save the chart image`));
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && setCanPng(hasExportableChart(chartRef.current))}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className ?? 'h-8 w-8'}
          disabled={!result}
          aria-label={t`Download`}
          title={t`Download`}
        >
          <Download className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportCsv}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          <Trans>Download CSV</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canPng} onSelect={() => void exportPng()}>
          <ImageDown className="h-4 w-4" aria-hidden />
          <Trans>Download PNG</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
