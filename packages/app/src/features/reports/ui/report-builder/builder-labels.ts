import { t } from '@lingui/core/macro';
import type {
  BuilderChartType,
  BuilderDatePreset,
  BuilderDimension,
  BuilderMeasure,
  BuilderSort,
  BuilderTemplateId,
  ReportBuilderLabels,
} from '../../lib/report-builder';

export function measureLabel(measure: BuilderMeasure): string {
  switch (measure) {
    case 'spending':
      return t`Spending`;
    case 'income':
      return t`Income`;
    case 'net':
      return t`Net (income − spending)`;
    case 'incomeVsSpending':
      return t`Income vs spending`;
    case 'count':
      return t`Number of transactions`;
    case 'average':
      return t`Average transaction (spending)`;
  }
}

export function dimensionLabel(dimension: BuilderDimension): string {
  switch (dimension) {
    case 'month':
      return t`Month`;
    case 'week':
      return t`Week`;
    case 'quarter':
      return t`Quarter`;
    case 'year':
      return t`Year`;
    case 'category':
      return t`Category`;
    case 'categoryGroup':
      return t`Category group`;
    case 'payee':
      return t`Payee`;
    case 'account':
      return t`Account`;
    case 'label':
      return t`Label`;
  }
}

export function datePresetLabel(preset: BuilderDatePreset): string {
  switch (preset) {
    case 'thisMonth':
      return t`This month`;
    case 'last3Months':
      return t`Last 3 months`;
    case 'last6Months':
      return t`Last 6 months`;
    case 'last12Months':
      return t`Last 12 months`;
    case 'yearToDate':
      return t`Year to date`;
    case 'allTime':
      return t`All time`;
    case 'custom':
      return t`Custom range`;
  }
}

export function chartTypeLabel(chartType: BuilderChartType): string {
  switch (chartType) {
    case 'bar':
      return t`Bar`;
    case 'line':
      return t`Line`;
    case 'area':
      return t`Area`;
    case 'pie':
      return t`Pie`;
    case 'table':
      return t`Table`;
    case 'stat':
      return t`Single number`;
  }
}

export function sortLabel(sort: BuilderSort): string {
  switch (sort) {
    case 'valueDesc':
      return t`Largest first`;
    case 'valueAsc':
      return t`Smallest first`;
    case 'label':
      return t`Alphabetical`;
  }
}

export function templateLabel(id: BuilderTemplateId): string {
  switch (id) {
    case 'spendingByCategory':
      return t`Spending by category (last 12 months)`;
    case 'incomeVsSpending':
      return t`Income vs spending by month`;
    case 'netByMonth':
      return t`Net cash flow by month`;
    case 'topPayees':
      return t`Top payees`;
    case 'spendingByLabel':
      return t`Spending by label`;
    case 'spendingByGroupOverTime':
      return t`Category groups over time`;
  }
}

/** Labels baked into the generated SQL for empty values and flow series. */
export function getBuilderSqlLabels(): ReportBuilderLabels {
  return {
    uncategorized: t`Uncategorized`,
    noPayee: t`No payee`,
    noLabel: t`No label`,
    noAccount: t`No account`,
    income: t`Income`,
    spending: t`Spending`,
  };
}

/** Default report title for a spec, e.g. "Spending by category". */
export function describeSpec(spec: {
  measure: BuilderMeasure;
  groupBy: BuilderDimension;
  chartType: BuilderChartType;
}): string {
  const measure = measureLabel(spec.measure);
  if (spec.chartType === 'stat') return measure;
  const dimension = dimensionLabel(spec.groupBy);
  return t`${measure} by ${dimension}`;
}
