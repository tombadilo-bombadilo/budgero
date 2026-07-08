import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  SpendingDonutChart,
  type SpendingDonutDatum,
} from '@features/analytics/ui/SpendingDonutChart';

interface PrebuiltDonutCardProps {
  title: string;
  description: string;
  data: SpendingDonutDatum[];
  isLoading: boolean;
}

/** Card scaffold shared by the prebuilt spending-donut reports (payee, label). */
export function PrebuiltDonutCard({ title, description, data, isLoading }: PrebuiltDonutCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-1 sm:pb-2">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-2">
        <SpendingDonutChart
          data={data}
          isLoading={isLoading}
          emptyHint="No transactions found for the selected period"
        />
      </CardContent>
    </Card>
  );
}
