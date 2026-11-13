import { hasDateBreakout, type QuestionSpec } from '@features/reports/lib/question';

/** Whether "compare with last year" can be switched on in one tap. */
export function canCompareLastYear(spec: QuestionSpec): boolean {
  const [first] = spec.aggregations;
  return (
    spec.breakouts.length === 1 && hasDateBreakout(spec.breakouts) && !!first && !first.modifier
  );
}

export function comparesLastYear(spec: QuestionSpec): boolean {
  return spec.aggregations.some((item) => item.compare && item.compareTo === 'lastYear');
}

/** The first metric compared with the same period last year (or the comparison removed). */
export function withLastYear(spec: QuestionSpec, on: boolean): QuestionSpec {
  return {
    ...spec,
    aggregations: spec.aggregations.map((item, index) => {
      const { compare: _compare, compareTo: _compareTo, ...rest } = item;
      if (on) return index === 0 ? { ...rest, compare: true, compareTo: 'lastYear' } : item;
      return item.compareTo === 'lastYear' ? rest : item;
    }),
  };
}
