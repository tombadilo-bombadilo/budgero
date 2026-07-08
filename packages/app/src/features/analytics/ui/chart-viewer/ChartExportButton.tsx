import { Button } from '@shared/ui/button';
import { Download } from 'lucide-react';

interface ChartExportButtonProps {
  onExport: () => void;
}

export function ChartExportButton({ onExport }: ChartExportButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onExport} className="flex-shrink-0">
      <Download className="h-3 w-3 mr-1" />
      <span className="hidden sm:inline">Export CSV</span>
      <span className="sm:hidden">CSV</span>
    </Button>
  );
}
