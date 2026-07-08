import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, PartyPopper } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { useMonthlyBudget } from '@entities/budget/api/useMonthlyBudget';
import { useUiStore } from '@shared/store/useUiStore';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { focusCategoryNavState } from '@shared/hooks/useFocusCategoryFromNavState';

interface OverspentCategory {
  id: number;
  name: string;
  available: number;
}

export function OverspentCategoriesCard() {
  const navigate = useNavigate();
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const currentMonth = useUiStore((state) => state.currentMonth);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const budgetId = selectedBudget?.ID || 0;
  const { data: budgetRows = [] } = useMonthlyBudget(currentMonth, budgetId);

  const overspent = useMemo((): OverspentCategory[] => {
    return budgetRows
      .filter((row: GetMonthlyBudgetRow) => (row.Available || 0) < 0 && (row.CategoryID || 0) > 0)
      .map((row: GetMonthlyBudgetRow) => ({
        id: row.CategoryID,
        name: row.Category,
        available: row.Available,
      }))
      .sort((a, b) => a.available - b.available)
      .slice(0, 6);
  }, [budgetRows]);

  const goToCategory = (categoryId?: number) => {
    void navigate('/budgeting', { state: focusCategoryNavState(categoryId) });
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Overspent categories
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {overspent.length === 0 ? (
          <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success shadow-sm">
            <div className="flex items-center gap-2">
              <PartyPopper className="h-4 w-4 text-success" />
              <span>No overspending — nice work!</span>
            </div>
            <Badge variant="secondary" className="border-success/30 bg-success/20 text-success">
              ✓
            </Badge>
          </div>
        ) : (
          <div className="space-y-2">
            {overspent.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => goToCategory(category.id)}
                className="flex w-full items-center justify-between rounded-lg border border-destructive/20 border-l-4 border-l-destructive bg-destructive/5 px-4 py-2.5 text-left transition-colors hover:bg-destructive/10"
              >
                <span className="text-sm font-medium text-destructive">{category.name}</span>
                <span className="text-sm font-semibold text-destructive">
                  {formatMaskedMilli(
                    globalLocalizer,
                    Math.abs(category.available || 0),
                    privacyMaskNumbers
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end pt-0">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => goToCategory(overspent[0]?.id)}
          disabled={overspent.length === 0}
        >
          Review budget
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
