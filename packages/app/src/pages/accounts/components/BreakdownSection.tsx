interface BreakdownCategory {
  label: string;
  color: string;
  value: number;
}

interface BreakdownSectionProps {
  title: string;
  total: number;
  categories: BreakdownCategory[];
  showPercent: boolean;
  formatCurrency: (value: number) => string;
  formatValue: (value: number, total: number) => string;
}

/**
 * Asset/Liability breakdown block for the accounts sidebar: header total,
 * segmented progress bar, and a per-category legend list.
 */
export function BreakdownSection({
  title,
  total,
  categories,
  showPercent,
  formatCurrency,
  formatValue,
}: BreakdownSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <span className="text-xs sm:text-sm font-medium">{title}</span>
        <span className="text-sm sm:text-lg font-bold tabular-nums">
          {showPercent ? '100%' : formatCurrency(total)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted rounded-full h-2.5 sm:h-3 mb-3 sm:mb-4 overflow-hidden">
        <div className="h-full flex">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className="h-full"
              style={{
                width: `${total > 0 ? (cat.value / total) * 100 : 0}%`,
                backgroundColor: cat.color,
              }}
            />
          ))}
        </div>
      </div>

      {/* Categories list */}
      <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
        {categories.map((cat) => (
          <div key={cat.label} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div
                className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-muted-foreground">{cat.label}</span>
            </div>
            <span className="font-medium tabular-nums">{formatValue(cat.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
