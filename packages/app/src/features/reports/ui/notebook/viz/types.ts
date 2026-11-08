import type {
  QuestionColumn,
  QuestionDisplay,
  QuestionSource,
  QuestionSpec,
  ResolvedStacking,
} from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';

/** Props every notebook visualization view takes. */
export interface VizViewProps {
  result: QueryResult;
  columns: QuestionColumn[];
  source: QuestionSource;
  display?: QuestionDisplay;
  stacking?: ResolvedStacking;
  /** The question (number with trend re-runs it for the previous period). */
  spec?: QuestionSpec;
  fitHeight?: boolean;
  className?: string;
}
