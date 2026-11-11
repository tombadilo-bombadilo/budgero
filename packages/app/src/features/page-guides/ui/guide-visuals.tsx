import type { LucideIcon } from 'lucide-react';

/** A goal type tile in the goals card. */
export function GoalKind({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 leading-tight">{label}</span>
    </span>
  );
}

/** A prebuilt report tile in the reports card. */
export function ReportTile({
  icon: Icon,
  label,
  question,
}: {
  icon: LucideIcon;
  label: string;
  question: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        {label}
      </span>
      <span className="text-[11px] leading-tight text-muted-foreground">{question}</span>
    </span>
  );
}
