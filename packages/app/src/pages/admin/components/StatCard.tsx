import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  helper?: ReactNode;
}

export function StatCard({ icon: Icon, label, value, helper }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {helper !== undefined && <p className="text-xs text-muted-foreground">{helper}</p>}
      </CardContent>
    </Card>
  );
}
